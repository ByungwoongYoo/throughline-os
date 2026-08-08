"""Workflow handlers.

Per §123 nothing here is stubbed to look implemented. A handler either does the
work or is absent.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from throughline_domain import corpus, objects, storage
from throughline_domain.db import connection
from throughline_ingestion import datasets as dataset_parser
from throughline_ingestion import documents as document_parser
from throughline_schemas.enums import IngestionStatus

from .runner import REGISTRY

SUPPORTED_SUFFIXES = (
    document_parser.SUPPORTED_DOCUMENT_SUFFIXES | dataset_parser.SUPPORTED_DATASET_SUFFIXES
)


class PermanentIngestionError(Exception):
    """A failure that retrying cannot fix — an unsupported format, an empty file.

    Distinguished from transient errors so the worker does not burn its retry
    budget re-attempting something that will fail identically every time.
    """


@REGISTRY.register("system.echo")
def echo(run: dict[str, Any], cur: Any) -> dict[str, Any]:
    """Return the payload. Used by tests and the dev script's smoke check."""
    return {"echo": run["input"]}


@REGISTRY.register("ingest.source")
def ingest_source(run: dict[str, Any], cur: Any) -> dict[str, Any]:
    """Walk a source through the §24 ingestion state machine.

    Each stage records its progress, so a failure partway through shows the
    researcher exactly how far it got (§104, §105) and leaves the stored file in
    place for a retry (§24).
    """
    source_id = run["input"]["source_id"]
    cur.execute(
        """
        SELECT s.id, s.project_id, s.title, s.content_hash,
               f.storage_key, f.filename, f.media_type
        FROM sources s LEFT JOIN files f ON f.id = s.file_id
        WHERE s.id = %s
        """,
        (source_id,),
    )
    source = cur.fetchone()
    if not source:
        raise ValueError(f"Source {source_id} no longer exists")

    project_id = source["project_id"]
    actor = "system:ingest"
    filename = source["filename"] or source["title"] or ""
    # Files are stored content-addressed, so the path on disk has no extension.
    # The format comes from the filename recorded at upload.
    suffix = Path(filename).suffix.lower()

    try:
        if not source["storage_key"]:
            raise PermanentIngestionError("No stored file is attached to this source.")
        if suffix not in SUPPORTED_SUFFIXES:
            raise PermanentIngestionError(
                f"{suffix or 'This file type'} is not supported. "
                f"Supported: {', '.join(sorted(SUPPORTED_SUFFIXES))}"
            )

        path = storage.path_for(source["storage_key"])
        objects.advance_ingestion(cur, source_id=source_id,
                                  to_status=IngestionStatus.VALIDATED,
                                  detail=f"Stored file located ({suffix})")
        # §99 lists malware scanning as architecture. It is not implemented here,
        # so this stage records that no scan ran rather than implying one did.
        objects.advance_ingestion(cur, source_id=source_id,
                                  to_status=IngestionStatus.SCANNED,
                                  detail="Local-first install: no malware scanner configured")
        objects.advance_ingestion(cur, source_id=source_id,
                                  to_status=IngestionStatus.EXTRACTING,
                                  detail="Reading file")

        if suffix in document_parser.SUPPORTED_DOCUMENT_SUFFIXES:
            result = _ingest_document(cur, project_id=project_id, source_id=source_id,
                                      path=path, suffix=suffix, actor=actor)
        else:
            result = _ingest_dataset(cur, project_id=project_id, source_id=source_id,
                                     path=path, suffix=suffix, name=filename,
                                     content_hash=source["content_hash"] or "",
                                     storage_key=source["storage_key"], actor=actor)

        objects.advance_ingestion(cur, source_id=source_id,
                                  to_status=IngestionStatus.READY, detail=result["summary"])
        return {"source_id": source_id, "status": "ready", **result}

    except PermanentIngestionError as exc:
        # Retrying cannot help. Record the failure in this transaction and return
        # normally so the run completes rather than looping through its retries.
        objects.advance_ingestion(cur, source_id=source_id,
                                  to_status=IngestionStatus.FAILED, detail=str(exc))
        return {"source_id": source_id, "status": "failed", "reason": str(exc)}

    except Exception as exc:
        # A transient failure should retry, but re-raising rolls this transaction
        # back — including the failure record. Write it on its own connection so
        # the researcher sees the state even though the work is rolled back.
        _record_failure(source_id, f"{type(exc).__name__}: {exc}")
        raise


def _record_failure(source_id: str, detail: str) -> None:
    try:
        with connection() as conn, conn.cursor() as cur:
            objects.advance_ingestion(cur, source_id=source_id,
                                      to_status=IngestionStatus.FAILED, detail=detail)
    except Exception:
        # Never let failure-recording mask the original error.
        pass


def _ingest_document(
    cur, *, project_id: str, source_id: str, path: Path, suffix: str, actor: str
) -> dict[str, Any]:
    try:
        parsed = document_parser.parse_document(path, suffix=suffix)
    except document_parser.UnsupportedFormat as exc:
        raise PermanentIngestionError(str(exc)) from exc

    if not parsed.passages:
        raise PermanentIngestionError("No readable text was found in this document.")

    broken = parsed.verify_anchors()
    if broken:
        # An anchor that does not resolve is not evidence (LAW 1).
        raise PermanentIngestionError(
            f"{len(broken)} passage anchors did not match the source text; "
            "refusing to index unverifiable spans."
        )

    objects.advance_ingestion(cur, source_id=source_id, to_status=IngestionStatus.PARSING,
                              detail=f"Parsed {len(parsed.passages)} passages")
    count = corpus.store_passages(cur, project_id=project_id, source_id=source_id,
                                  passages=parsed.passages)

    objects.advance_ingestion(cur, source_id=source_id, to_status=IngestionStatus.STRUCTURING,
                              detail="Recording paper structure")
    paper = corpus.store_paper(cur, project_id=project_id, source_id=source_id,
                               parsed=parsed, actor=actor)

    objects.advance_ingestion(cur, source_id=source_id, to_status=IngestionStatus.INDEXING,
                              detail=f"Indexing {count} passages")
    embedding = corpus.embed_passages(cur, project_id=project_id, source_id=source_id)

    objects.advance_ingestion(cur, source_id=source_id, to_status=IngestionStatus.ENRICHING,
                              detail="Recording sections")
    sections = sorted({p.section for p in parsed.passages if p.section})
    return {
        "kind": "document", "passages": count, "pages": parsed.page_count,
        "sections": sections, "embedding": embedding, **paper,
        "summary": (f"{count} passages, {parsed.page_count} pages"
                    + (f", {embedding['embedded']} embedded" if embedding["embedded"]
                       else ", lexical index only")),
    }


def _ingest_dataset(
    cur, *, project_id: str, source_id: str, path: Path, suffix: str, name: str,
    content_hash: str, storage_key: str, actor: str,
) -> dict[str, Any]:
    objects.advance_ingestion(cur, source_id=source_id, to_status=IngestionStatus.PARSING,
                              detail="Reading tabular data")
    try:
        profile = dataset_parser.profile_dataset(path, suffix=suffix)
    except dataset_parser.UnsupportedDataset as exc:
        raise PermanentIngestionError(str(exc)) from exc
    if profile.column_count == 0:
        raise PermanentIngestionError("No columns were found in this dataset.")

    objects.advance_ingestion(cur, source_id=source_id, to_status=IngestionStatus.STRUCTURING,
                              detail=f"Profiling {profile.column_count} columns")
    stored = corpus.store_dataset(cur, project_id=project_id, source_id=source_id,
                                  name=name, profile=profile, content_hash=content_hash,
                                  storage_key=storage_key, actor=actor)

    # A dataset's searchable surface is its schema, not its rows: §106 forbids
    # shipping millions of rows around, and a column description is what a
    # researcher actually searches for. Schema passages describe rather than
    # quote, so they deliberately carry no source span.
    objects.advance_ingestion(cur, source_id=source_id, to_status=IngestionStatus.INDEXING,
                              detail="Indexing column descriptions")
    schema_passages = [
        document_parser.Passage(
            ordinal=column.ordinal,
            content=(f"Column {column.name} ({column.physical_type}, {column.semantic_type})"
                     + (f" in {column.unit}" if column.unit else "")
                     + f". {column.unique_count} distinct values, "
                       f"{column.missing_count} missing."),
            locator=f"column {column.ordinal + 1}: {column.original_name}",
            kind="schema", section="schema",
            metadata={"semantic_type": column.semantic_type, "column": column.name},
        )
        for column in profile.columns
    ]
    corpus.store_passages(cur, project_id=project_id, source_id=source_id,
                          passages=schema_passages)
    embedding = corpus.embed_passages(cur, project_id=project_id, source_id=source_id)

    objects.advance_ingestion(cur, source_id=source_id, to_status=IngestionStatus.ENRICHING,
                              detail="Building data-quality report")
    return {
        "kind": "dataset", **stored,
        "rows": profile.row_count, "columns": profile.column_count,
        "quality_report": profile.quality_report, "embedding": embedding,
        "summary": f"{profile.row_count} rows, {profile.column_count} columns",
    }
