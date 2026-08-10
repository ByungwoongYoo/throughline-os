"""Persisting parsed papers and profiled datasets.

This is the seam between the pure parsers in `throughline_ingestion` and the
research model. Everything written here also writes its lineage, because a
passage, a paper and a dataset version are all derived artifacts.
"""

from __future__ import annotations

import pathlib
import re

from typing import Any, Sequence

from throughline_schemas.enums import LineageType, ObjectType

from .embeddings import provider as embedding_provider
from .ids import new_id
from .lineage import add_edge
from .objects import create_object


def store_passages(cur, *, project_id: str, source_id: str, passages: Sequence[Any]) -> int:
    """Insert parsed passages. Re-ingestion replaces them wholesale.

    Passages are derived from an immutable file, so recomputing them is
    deterministic and replacement is safe — unlike claims or findings, which
    carry human judgement and are never silently discarded.
    """
    cur.execute("DELETE FROM passages WHERE source_id = %s", (source_id,))
    for passage in passages:
        cur.execute(
            """
            INSERT INTO passages
                (id, project_id, source_id, ordinal, kind, locator, page, section,
                 paragraph_index, content, char_start, char_end, metadata)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                new_id("psg"), project_id, source_id, passage.ordinal, passage.kind,
                passage.locator, passage.page, passage.section, passage.paragraph_index,
                passage.content, passage.char_start, passage.char_end, passage.metadata,
            ),
        )
    return len(passages)


def embed_passages(cur, *, project_id: str, source_id: str, batch: int = 256) -> dict[str, Any]:
    """Compute and store embeddings for a source's passages.

    Reports honestly when no local model is installed rather than leaving the
    caller to assume semantic search will work.
    """
    embedder = embedding_provider()
    if embedder is None:
        return {"embedded": 0, "model": None,
                "note": "No local embedding model installed; retrieval is lexical only."}

    cur.execute(
        "SELECT id, content FROM passages WHERE source_id = %s ORDER BY ordinal",
        (source_id,),
    )
    rows = list(cur.fetchall())
    embedded = 0
    for start in range(0, len(rows), batch):
        window = rows[start : start + batch]
        vectors = embedder.embed([r["content"] for r in window])
        for row, vector in zip(window, vectors):
            literal = "[" + ",".join(f"{float(v):.7f}" for v in vector) + "]"
            cur.execute(
                """
                INSERT INTO passage_embeddings(passage_id, project_id, model, dimension, embedding)
                VALUES (%s, %s, %s, %s, %s::vector)
                ON CONFLICT (passage_id) DO UPDATE
                    SET embedding = EXCLUDED.embedding, model = EXCLUDED.model,
                        dimension = EXCLUDED.dimension
                """,
                (row["id"], project_id, embedder.name, embedder.dimension, literal),
            )
            embedded += 1
    return {"embedded": embedded, "model": embedder.name}


#: A title that is only hex is not a title.
#:
#: Uploads are stored under their content hash, and the plain-text and DOCX
#: parsers fall back to the *storage* filename when a document declares no title
#: of its own. The result was every paper in the knowledge graph being named
#: `b9590d6e361c…` — technically a string, useless to a reader, and invisible
#: until someone opened a node and tried to read it.
_LOOKS_LIKE_A_HASH = re.compile(r"^[0-9a-f]{16,}$", re.IGNORECASE)


def _readable_title(cur, parsed: Any, source_id: str) -> str:
    """
    The best human-readable name for this document.

    Falls back to what the researcher called the file, because that is a name a
    person chose, and a name a person chose beats any string a parser
    manufactured.
    """
    candidate = (getattr(parsed, "title", "") or "").strip()
    if candidate and not _LOOKS_LIKE_A_HASH.match(candidate):
        return candidate

    cur.execute("SELECT title FROM sources WHERE id = %s", (source_id,))
    source = cur.fetchone()
    filename = (source["title"] if source else "").strip()
    if filename and not _LOOKS_LIKE_A_HASH.match(pathlib.Path(filename).stem):
        return filename
    return "Untitled paper"


def store_paper(
    cur, *, project_id: str, source_id: str, parsed: Any, actor: str,
) -> dict[str, Any]:
    """Create the paper record and its research object, with lineage."""
    source_object_id = _source_object(cur, project_id=project_id, source_id=source_id, actor=actor)
    title = _readable_title(cur, parsed, source_id)
    paper_object_id = create_object(
        cur, project_id=project_id, object_type=ObjectType.PAPER,
        title=title, actor=actor, source_id=source_id,
        derived_from=[source_object_id], lineage_type=LineageType.DERIVED_FROM,
        metadata={"parser": parsed.metadata.get("parser"), "pages": parsed.page_count},
    )
    paper_id = new_id("pap")
    cur.execute(
        """
        INSERT INTO papers (id, project_id, source_id, object_id, title, page_count, metadata)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (source_id) DO UPDATE
            SET title = EXCLUDED.title, page_count = EXCLUDED.page_count,
                metadata = EXCLUDED.metadata
        RETURNING id
        """,
        (paper_id, project_id, source_id, paper_object_id, title,
         parsed.page_count, parsed.metadata),
    )
    return {"paper_id": cur.fetchone()["id"], "object_id": paper_object_id}


def store_dataset(
    cur, *, project_id: str, source_id: str, name: str, profile: Any,
    content_hash: str, storage_key: str | None, actor: str,
) -> dict[str, Any]:
    """Create dataset, an immutable version, and its profiled columns."""
    source_object_id = _source_object(cur, project_id=project_id, source_id=source_id, actor=actor)
    dataset_object_id = create_object(
        cur, project_id=project_id, object_type=ObjectType.DATASET, title=name,
        actor=actor, source_id=source_id, derived_from=[source_object_id],
        metadata={"format": profile.format, "rows": profile.row_count,
                  "columns": profile.column_count},
    )

    dataset_id = new_id("dst")
    cur.execute(
        """
        INSERT INTO datasets (id, project_id, source_id, object_id, name, format)
        VALUES (%s, %s, %s, %s, %s, %s)
        ON CONFLICT (source_id) DO UPDATE SET name = EXCLUDED.name
        RETURNING id
        """,
        (dataset_id, project_id, source_id, dataset_object_id, name, profile.format),
    )
    dataset_id = cur.fetchone()["id"]

    cur.execute(
        "SELECT COALESCE(MAX(version), 0) AS v FROM dataset_versions WHERE dataset_id = %s",
        (dataset_id,),
    )
    next_version = int(cur.fetchone()["v"]) + 1
    cur.execute(
        "SELECT id FROM dataset_versions WHERE dataset_id = %s ORDER BY version DESC LIMIT 1",
        (dataset_id,),
    )
    previous = cur.fetchone()

    version_id = new_id("dsv")
    cur.execute(
        """
        INSERT INTO dataset_versions
            (id, dataset_id, version, parent_version_id, storage_key, content_hash,
             row_count, column_count, quality_report)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (version_id, dataset_id, next_version, previous["id"] if previous else None,
         storage_key, content_hash, profile.row_count, profile.column_count,
         profile.quality_report),
    )

    for column in profile.columns:
        cur.execute(
            """
            INSERT INTO dataset_columns
                (id, dataset_version_id, ordinal, name, original_name, physical_type,
                 semantic_type, unit, missing_count, unique_count, statistics, sensitivity)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (new_id("dsc"), version_id, column.ordinal, column.name, column.original_name,
             column.physical_type, column.semantic_type, column.unit, column.missing_count,
             column.unique_count, column.statistics, column.sensitivity),
        )

    return {
        "dataset_id": dataset_id,
        "dataset_version_id": version_id,
        "version": next_version,
        "object_id": dataset_object_id,
    }


def _source_object(cur, *, project_id: str, source_id: str, actor: str) -> str:
    """The research object standing for the raw source, created once."""
    cur.execute(
        "SELECT id FROM research_objects WHERE source_id = %s AND object_type = %s",
        (source_id, str(ObjectType.CITATION)),
    )
    row = cur.fetchone()
    if row:
        return row["id"]
    cur.execute("SELECT title FROM sources WHERE id = %s", (source_id,))
    source = cur.fetchone()
    return create_object(
        cur, project_id=project_id, object_type=ObjectType.CITATION,
        title=source["title"] if source else "Source", actor=actor, source_id=source_id,
    )
