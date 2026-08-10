"""Phase 1 ingestion (§24, §26, §27) against real files."""

from __future__ import annotations

import io
from pathlib import Path

import pytest
from throughline_domain import corpus, objects, storage, workflow
from throughline_domain.db import connection
from throughline_domain.ids import new_id
from throughline_ingestion import datasets as dataset_parser
from throughline_ingestion import documents as document_parser
from throughline_schemas.enums import IngestionStatus, SourceType
from throughline_workers.runner import Worker

# The three periodontal-disease PDFs from the previous product, used as real
# input rather than a synthetic fixture.
LEGACY_PDFS = sorted(
    Path("/Users/sarthakpattnaik/Downloads/throughline_v18_zero_motion_1_8_0/"
         "data/files/workspace_default").glob("*.pdf")
)


@pytest.fixture()
def committed_project():
    user_id, project_id = new_id("usr"), new_id("prj")
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            "INSERT INTO users(id, email, display_name, password_hash, password_salt) "
            "VALUES (%s, %s, %s, 'x', 'y')",
            (user_id, f"{user_id}@test.local", "Ingest Test"),
        )
        cur.execute("INSERT INTO projects(id, owner_user_id, name) VALUES (%s, %s, 'Ingest')",
                    (project_id, user_id))
    yield project_id
    with connection() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM users WHERE id = %s", (user_id,))


def _upload(project_id: str, filename: str, payload: bytes) -> str:
    """Store a file and queue ingestion the way the API does."""
    with connection() as conn, conn.cursor() as cur:
        record = storage.register_file(cur, project_id=project_id, filename=filename,
                                       stream=io.BytesIO(payload),
                                       media_type="application/octet-stream")
        source_id = objects.create_source(
            cur, project_id=project_id, source_type=SourceType.UPLOAD,
            title=filename, actor="test", file_id=str(record["id"]),
            content_hash=str(record["content_hash"]),
        )
        workflow.enqueue(cur, workflow_name="ingest.source", project_id=project_id,
                         payload={"source_id": source_id},
                         idempotency_key=f"ingest:{project_id}:{record['content_hash']}")
    return source_id


def _drain() -> None:
    while Worker(worker_id="test").run_once():
        pass


def _source(source_id: str) -> dict:
    with connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT * FROM sources WHERE id = %s", (source_id,))
        return cur.fetchone()


# ---------------------------------------------------------------------------
# Pure parsing
# ---------------------------------------------------------------------------


def test_unsupported_format_is_refused_not_silently_empty():
    """§25 — do not show unsupported formats as functional."""
    with pytest.raises(document_parser.UnsupportedFormat) as exc:
        document_parser.parse_document(Path("/tmp/whatever.sav"))
    assert ".sav" in str(exc.value)


def test_plain_text_anchors_resolve_exactly():
    """LAW 1 — offsets must index the real text, verified at parse time."""
    path = Path("/tmp/tl-anchor-test.txt")
    path.write_text("Methods\n\nWe enrolled 240 patients.\n\nResults\n\nMortality was 12.5%.")
    parsed = document_parser.parse_document(path)
    assert parsed.verify_anchors() == []
    for passage in parsed.passages:
        assert parsed.text[passage.char_start : passage.char_end] == passage.content
    assert {p.section for p in parsed.passages} >= {"methods", "results"}


@pytest.mark.skipif(not LEGACY_PDFS, reason="legacy PDFs not present")
def test_real_pdf_parses_with_resolvable_anchors():
    parsed = document_parser.parse_pdf(LEGACY_PDFS[0])
    assert parsed.passages and parsed.page_count > 0
    assert parsed.verify_anchors() == []
    # The column-aware reader must not splice unrelated sentences together.
    joined = " ".join(p.content for p in parsed.passages[:40])
    assert "kindout of" not in joined


# ---------------------------------------------------------------------------
# Dataset profiling
# ---------------------------------------------------------------------------


def test_dataset_profiling_types_columns_from_values_not_names(tmp_path):
    """§26 — a name raises a hypothesis; the values decide."""
    csv_path = tmp_path / "amr.csv"
    csv_path.write_text(
        "country,year,consumption_ddd,resistance_pct,patient_name,age\n"
        "IND,2019,12.4,31.2,Asha,54\n"
        "USA,2019,9.8,18.6,Bob,61\n"
        "GBR,2019,8.1,15.0,Cara,47\n"
        "FRA,2020,11.2,22.4,Dan,39\n"
    )
    profile = dataset_parser.profile_dataset(csv_path)
    by_name = {c.name: c for c in profile.columns}

    assert profile.row_count == 4 and profile.column_count == 6
    assert by_name["country"].semantic_type == "geography"
    # A bare year is stored as a number but means a date — typing it "continuous"
    # would let it be correlated against outcomes as if it were a measurement.
    assert by_name["year"].physical_type == "number"
    assert by_name["year"].semantic_type == "date"
    assert by_name["consumption_ddd"].semantic_type == "continuous"
    assert by_name["age"].semantic_type == "age"
    # §26 — personal fields are flagged, never dropped.
    assert by_name["patient_name"].sensitivity == "possibly_personal"
    assert "patient_name" in profile.quality_report["possibly_personal_columns"]


def test_profiling_flags_sentinels_and_missingness(tmp_path):
    csv_path = tmp_path / "d.csv"
    csv_path.write_text("value,note\n10\n-999,\n20,\nNA,\n")
    profile = dataset_parser.profile_dataset(csv_path)
    value = next(c for c in profile.columns if c.name == "value")
    assert value.missing_count >= 1
    assert -999 in value.statistics.get("possible_sentinel_values", [])


def test_profiling_never_mutates_the_source(tmp_path):
    """§26 — "Never mutate raw data.\""""
    csv_path = tmp_path / "raw.csv"
    original = "a,b\n1,NA\n2,3\n"
    csv_path.write_text(original)
    dataset_parser.profile_dataset(csv_path)
    assert csv_path.read_text() == original


def test_delimiter_is_detected(tmp_path):
    path = tmp_path / "semi.csv"
    path.write_text("a;b;c\n1;2;3\n4;5;6\n")
    profile = dataset_parser.profile_dataset(path)
    assert profile.column_count == 3


# ---------------------------------------------------------------------------
# End-to-end ingestion through the durable worker
# ---------------------------------------------------------------------------


def test_dataset_ingests_to_ready_with_a_version(committed_project):
    source_id = _upload(committed_project, "amr.csv",
                        b"country,year,rate\nIND,2019,31.2\nUSA,2019,18.6\nGBR,2020,15.0\n")
    _drain()

    source = _source(source_id)
    assert source["ingestion_status"] == str(IngestionStatus.READY)

    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT dv.version, dv.row_count, dv.column_count FROM dataset_versions dv "
            "JOIN datasets d ON d.id = dv.dataset_id WHERE d.source_id = %s",
            (source_id,),
        )
        version = cur.fetchone()
        assert version["version"] == 1 and version["row_count"] == 3


def test_unsupported_upload_fails_with_a_useful_reason(committed_project):
    """§104 — never a generic error."""
    source_id = _upload(committed_project, "notes.sav", b"\x00binary")
    _drain()
    source = _source(source_id)
    assert source["ingestion_status"] == str(IngestionStatus.FAILED)
    assert ".sav" in source["ingestion_detail"] and "Supported" in source["ingestion_detail"]


def test_failed_ingestion_preserves_the_stages_it_completed(committed_project):
    """§24 — "Failure state must preserve completed work where possible.\""""
    source_id = _upload(committed_project, "empty.txt", b"   \n  \n ")
    _drain()
    source = _source(source_id)
    assert source["ingestion_status"] == str(IngestionStatus.FAILED)
    # The stored file survives, so a retry does not need a re-upload.
    with connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT f.storage_key FROM sources s JOIN files f ON f.id = s.file_id "
                    "WHERE s.id = %s", (source_id,))
        assert storage.path_for(cur.fetchone()["storage_key"]).exists()


@pytest.mark.skipif(not LEGACY_PDFS, reason="legacy PDFs not present")
def test_real_pdf_ingests_end_to_end_with_lineage(committed_project):
    source_id = _upload(committed_project, LEGACY_PDFS[0].name, LEGACY_PDFS[0].read_bytes())
    _drain()

    source = _source(source_id)
    assert source["ingestion_status"] == str(IngestionStatus.READY), source["ingestion_detail"]

    with connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) n FROM passages WHERE source_id = %s", (source_id,))
        assert cur.fetchone()["n"] > 0

        # LAW 1 — the paper object traces back to the raw source object.
        from throughline_domain import lineage

        cur.execute("SELECT object_id FROM papers WHERE source_id = %s", (source_id,))
        paper_object = cur.fetchone()["object_id"]
        assert lineage.ancestors(cur, paper_object)


# ---------------------------------------------------------------------------
# Titles
# ---------------------------------------------------------------------------

def test_a_paper_is_never_titled_with_its_content_hash(cur, project):
    """
    Regression, found by opening a node in the graph and trying to read it.

    Uploads are stored under their content hash, and the plain-text and DOCX
    parsers fall back to the storage filename when a document declares no title.
    Every paper in the knowledge graph was therefore named `b9590d6e361c…` —
    technically a string, useless to a reader, and invisible until someone
    looked at a node rather than a list.
    """
    from types import SimpleNamespace

    from throughline_domain import corpus
    from throughline_domain.ids import new_id

    source_id = new_id("src")
    cur.execute(
        "INSERT INTO sources(id, project_id, source_type, title, ingestion_status) "
        "VALUES (%s, %s, 'upload', 'consumption_resistance.md', 'ready')",
        (source_id, project))

    parsed = SimpleNamespace(
        title="b9590d6e361c2d39db01571f09034abe2cbe815fee35b4196e242bb34f20949f",
        page_count=1, metadata={"parser": "plain-text"})
    stored = corpus.store_paper(cur, project_id=project, source_id=source_id,
                                parsed=parsed, actor="usr_1")

    cur.execute("SELECT title FROM research_objects WHERE id = %s",
                (stored["object_id"],))
    assert cur.fetchone()["title"] == "consumption_resistance.md"


def test_a_real_parsed_title_is_preferred_over_the_filename(cur, project):
    from types import SimpleNamespace

    from throughline_domain import corpus
    from throughline_domain.ids import new_id

    source_id = new_id("src")
    cur.execute(
        "INSERT INTO sources(id, project_id, source_type, title, ingestion_status) "
        "VALUES (%s, %s, 'upload', 'download (3).pdf', 'ready')",
        (source_id, project))

    parsed = SimpleNamespace(
        title="Antibiotic consumption and resistance in European hospitals",
        page_count=8, metadata={"parser": "pymupdf"})
    stored = corpus.store_paper(cur, project_id=project, source_id=source_id,
                                parsed=parsed, actor="usr_1")

    cur.execute("SELECT title FROM research_objects WHERE id = %s",
                (stored["object_id"],))
    assert cur.fetchone()["title"].startswith("Antibiotic consumption")
