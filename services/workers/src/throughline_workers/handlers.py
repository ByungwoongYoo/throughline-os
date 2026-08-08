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


@REGISTRY.register("analysis.run")
def analysis_run(run: dict[str, Any], cur: Any) -> dict[str, Any]:
    """Execute one analysis in the sandbox and commit its provenance (§43, §44).

    The dataset file is located here, in the parent, and handed to the executor
    as a path. The sandbox process is never told where the object store is, and
    never receives database credentials.
    """
    from throughline_domain import analysis, storage
    from throughline_runtime.executor import SandboxPolicy, SandboxTimeout, run_analysis

    run_id = run["input"]["analysis_run_id"]
    cur.execute("SELECT project_id, spec_id, status FROM analysis_runs WHERE id = %s", (run_id,))
    record = cur.fetchone()
    if not record:
        raise ValueError(f"Analysis run {run_id} no longer exists")
    if record["status"] in {"completed", "failed"}:
        # §38 — a retry must not recompute a terminal run.
        return {"analysis_run_id": run_id, "status": record["status"], "skipped": True}

    spec_row = dict(analysis.load_spec(cur, record["spec_id"]))
    version_ids = spec_row["dataset_version_ids"]
    cur.execute(
        """
        SELECT f.storage_key, f.filename, dv.content_hash, dv.row_count
        FROM dataset_versions dv
        JOIN datasets d ON d.id = dv.dataset_id
        JOIN sources s ON s.id = d.source_id
        JOIN files f ON f.id = s.file_id
        WHERE dv.id = %s
        """,
        (version_ids[0],),
    )
    location = cur.fetchone()
    if not location:
        raise ValueError("The dataset version has no stored file to analyse.")

    spec_row["_dataset"] = {"content_hash": location["content_hash"],
                            "row_count": location["row_count"]}
    spec_payload = {
        "method": spec_row["method"], "variables": spec_row["variables"],
        "filters": spec_row["filters"], "confidence_level": spec_row["confidence_level"],
        "method_rationale": spec_row["method_rationale"],
        "random_seed": spec_row["random_seed"], "parameters": spec_row["parameters"],
    }

    cur.execute("UPDATE analysis_runs SET status = 'running', started_at = now() "
                "WHERE id = %s", (run_id,))

    try:
        sandbox = run_analysis(
            spec=spec_payload,
            input_path=storage.path_for(location["storage_key"]),
            input_suffix=Path(location["filename"] or "").suffix.lower() or ".csv",
            policy=SandboxPolicy(),
        )
    except SandboxTimeout as exc:
        from throughline_runtime.executor import SandboxResult, policy_report

        sandbox = SandboxResult(ok=False, payload={"error": str(exc)},
                                policy=policy_report())

    return analysis.record_result(cur, run_id=run_id, sandbox=sandbox,
                                  spec_row=spec_row, actor="system:analysis")


def _execute_analysis(cur, run_id: str) -> None:
    """Run one analysis to completion inside the caller's transaction.

    Discovery and validation generate many analyses whose results they need
    immediately, so they run inline rather than round-tripping through the queue.
    The sandbox boundary is identical either way — this is the same handler.
    """
    analysis_run({"input": {"analysis_run_id": run_id}}, cur)


@REGISTRY.register("discovery.run")
def discovery_run(run: dict[str, Any], cur: Any) -> dict[str, Any]:
    """§48/§49 — generate candidates, test them, correct, rank, record.

    Every candidate becomes a real sandboxed analysis run, so a discovered
    connection is traceable to the computation behind it (LAW 1, LAW 2).
    """
    from throughline_domain import analysis, discovery

    discovery_run_id = run["input"]["discovery_run_id"]
    cur.execute("SELECT * FROM discovery_runs WHERE id = %s", (discovery_run_id,))
    record = cur.fetchone()
    if not record:
        raise ValueError(f"Discovery run {discovery_run_id} no longer exists")
    if record["status"] in {"complete", "failed"}:
        return {"discovery_run_id": discovery_run_id, "status": record["status"],
                "skipped": True}

    project_id = record["project_id"]
    version_id = record["dataset_version_id"]
    cur.execute("UPDATE discovery_runs SET status = 'running', started_at = now() "
                "WHERE id = %s", (discovery_run_id,))

    plan = discovery.plan_candidates(cur, dataset_version_id=version_id)
    candidates = plan["candidates"]

    # Steps 4–6: one sandboxed analysis per surviving candidate.
    tested: list[dict[str, Any]] = []
    for candidate in candidates:
        created = analysis.create_spec(cur, project_id=project_id, spec={
            "method": candidate["method"],
            "dataset_version_ids": [version_id],
            "variables": candidate["variables"],
            "method_rationale": candidate["rationale"],
            "research_question": (f"Is {candidate['left_variable']} associated with "
                                  f"{candidate['right_variable']}?"),
        }, actor="system:discovery")
        analysis_run_id = analysis.create_run(cur, project_id=project_id,
                                              spec_id=created["spec_id"])
        _execute_analysis(cur, analysis_run_id)
        finished = analysis.get_run(cur, analysis_run_id)
        tested.append({"candidate": candidate, "analysis_run_id": analysis_run_id,
                       "run": finished})

    # Step 7: correct across the whole family that was actually run.
    completed = [t for t in tested if t["run"]["status"] == "completed"]
    corrections = discovery.benjamini_hochberg(
        [(t["run"]["result"] or {}).get("p_value") for t in completed],
        fdr=float(record["false_discovery_rate"]),
    )

    connection_ids: list[str] = []
    for item, correction in zip(completed, corrections):
        connection_id = discovery.record_connection(
            cur, project_id=project_id, discovery_run_id=discovery_run_id,
            candidate=item["candidate"], analysis_run_id=item["analysis_run_id"],
            result=item["run"]["result"] or {}, q_value=correction["q_value"],
        )
        connection_ids.append(connection_id)
        # Step 10: only survivors of the correction become exploratory. The rest
        # stay candidates — visible, but not presented as discoveries (§13/§14).
        if correction["survives"]:
            discovery.transition(
                cur, connection_id=connection_id, to_status="exploratory",
                reason=(f"Survived Benjamini-Hochberg correction at FDR "
                        f"{record['false_discovery_rate']:.2f} "
                        f"(q = {correction['q_value']:.4g})."),
                actor="system:discovery", checks={"multiple_comparison_correction": True},
            )

    cur.execute(
        """
        UPDATE discovery_runs SET status = 'complete', candidates_considered = %s,
            candidates_excluded = %s, tests_run = %s, exclusion_reasons = %s,
            finished_at = now()
        WHERE id = %s
        """,
        (len(candidates), len(plan["excluded_columns"]), len(completed),
         plan["excluded_columns"], discovery_run_id),
    )

    exploratory = sum(1 for c in corrections if c["survives"])
    return {
        "discovery_run_id": discovery_run_id, "status": "complete",
        "columns_usable": plan["columns_usable"],
        "excluded_columns": plan["excluded_columns"],
        "candidates": len(candidates), "tests_run": len(completed),
        "survived_correction": exploratory, "connection_ids": connection_ids,
    }


@REGISTRY.register("connection.validate")
def connection_validate(run: dict[str, Any], cur: Any) -> dict[str, Any]:
    """§51 — try to destroy a connection; promote it only if it survives."""
    from throughline_domain import discovery, validation

    connection_id = run["input"]["connection_id"]
    confounders = list(run["input"].get("confounders") or [])

    outcome = validation.validate_connection(
        cur, connection_id=connection_id,
        runner=lambda analysis_run_id: _execute_analysis(cur, analysis_run_id),
        confounders=confounders,
    )

    cur.execute("SELECT lifecycle_status FROM connections WHERE id = %s", (connection_id,))
    current = cur.fetchone()["lifecycle_status"]
    if current == "exploratory":
        if outcome["passed"]:
            discovery.transition(cur, connection_id=connection_id, to_status="validated",
                                 reason=outcome["summary"], actor="system:validation",
                                 checks=outcome["checks"])
        else:
            # Failing validation does not reject the connection — it leaves it
            # exploratory, which is exactly what it still is.
            outcome["note"] = ("The connection remains exploratory. Failing a "
                               "robustness check is information, not a verdict.")
    return {"connection_id": connection_id, **outcome}


@REGISTRY.register("finding.challenge")
def finding_challenge(run: dict[str, Any], cur: Any) -> dict[str, Any]:
    """§57 — run the Scientific Critic against a finding."""
    from throughline_domain import critic

    return critic.challenge_finding(
        cur, finding_id=run["input"]["finding_id"],
        runner=lambda analysis_run_id: _execute_analysis(cur, analysis_run_id),
        actor=run["input"].get("actor") or "system:critic",
        confounders=tuple(run["input"].get("confounders") or ()),
    )
