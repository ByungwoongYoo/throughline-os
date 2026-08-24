from __future__ import annotations

import os
import shutil
import tempfile
import time
from pathlib import Path

import pytest

# Each test session gets its own embedded PostgreSQL data directory so a test
# run can never touch a researcher's real project database.
_TEST_HOME = Path(tempfile.gettempdir()) / "throughline-os-tests"
os.environ.setdefault("THROUGHLINE_HOME", str(_TEST_HOME))


def _discard_a_half_initialised_cluster() -> None:
    """Recover from a `pgdata` that macOS emptied out from under us.

    The test database lives in the OS temp directory, which macOS purges
    periodically — and it does not purge it atomically. What survives is the data
    *subdirectories* (`base`, `global`, `pg_wal`) with every top-level file gone,
    including `PG_VERSION` and the configuration. No server can start from that,
    and `initdb` refuses to touch it because the directory is not empty.

    Left alone this presents as a thousand identical errors whose traceback ends
    inside `initdb`, which says nothing about the actual cause and cost an
    afternoon the first time. A directory with no `PG_VERSION` is not a database
    by PostgreSQL's own definition, so it is moved aside rather than deleted —
    reversible, and it keeps the evidence if the cause was ever something else.
    """
    pgdata = _TEST_HOME / "pgdata"
    if not pgdata.exists() or (pgdata / "PG_VERSION").exists():
        return
    ruined = pgdata.with_name(f"pgdata.unusable-{int(time.time())}")
    pgdata.rename(ruined)
    print(
        f"\nThe test database at {pgdata} had no PG_VERSION — the temp directory "
        f"was purged mid-flight. Moved it to {ruined.name} and starting fresh; "
        f"nothing of yours was in it.",
    )


@pytest.fixture(scope="session", autouse=True)
def database() -> None:
    from throughline_domain.migrate import migrate

    _discard_a_half_initialised_cluster()
    migrate()
    yield
    from throughline_domain.db import shutdown

    shutdown()


@pytest.fixture()
def cur():
    """A cursor in a transaction that is always rolled back.

    Tests therefore share one migrated database without sharing state, and a
    failing test cannot leave rows behind for the next one.
    """
    from throughline_domain.db import connection

    with connection() as conn:
        with conn.cursor() as cursor:
            yield cursor
        conn.rollback()


@pytest.fixture()
def project(cur) -> str:
    from throughline_domain.ids import new_id

    user_id = new_id("usr")
    cur.execute(
        "INSERT INTO users(id, email, display_name, password_hash, password_salt) "
        "VALUES (%s, %s, %s, %s, %s)",
        (user_id, f"{user_id}@test.local", "Test Researcher", "x", "y"),
    )
    project_id = new_id("prj")
    cur.execute(
        "INSERT INTO projects(id, owner_user_id, name, research_question) "
        "VALUES (%s, %s, %s, %s)",
        (project_id, user_id, "Test project", "Does X associate with Y?"),
    )
    return project_id

# ---------------------------------------------------------------------------
# A real paper, built rather than found
# ---------------------------------------------------------------------------
#
# The three tests that need a PDF used to glob one out of a directory under
# /Users/sarthakpattnaik/Downloads. On any other machine that glob is empty, the
# tests skipped themselves, and a skip reads as green — so the one test covering
# the whole §137 workflow had never run anywhere but its author's laptop, and the
# gaps it would have caught shipped.
#
# Generated, not committed: a checked-in binary cannot be reviewed in a diff, and
# the properties these tests actually depend on — headed sections, a known
# searchable phrase, several pages, resolvable anchors — are clearer as code than
# as bytes. PyMuPDF is already a dependency of throughline-ingestion, so this
# costs nothing new.

_PAPER_PAGES = (
    "Antibiotic Consumption and Antimicrobial Resistance:\n"
    "A Cross-National Analysis\n\n"
    "A. Researcher, B. Colleague\n"
    "Department of Global Health\n\n"
    "ABSTRACT\n\n"
    "Antimicrobial resistance is among the most consequential threats to modern\n"
    "medicine. We examine whether national antibiotic consumption, measured in\n"
    "defined daily doses, is associated with the prevalence of resistant isolates\n"
    "across 120 country-years. We find a strong positive association between\n"
    "consumption and resistance. Gross domestic product per capita is frequently\n"
    "proposed as a confounder of this relationship; we test that proposal\n"
    "directly and do not find that it explains the association.\n",

    "1. INTRODUCTION\n\n"
    "Resistance to antibiotics arises through selection pressure. Where more\n"
    "antibiotic is consumed, resistant organisms enjoy a larger advantage. The\n"
    "mechanism is not in doubt at the level of a single organism, but its\n"
    "magnitude at the level of a national health system is contested.\n\n"
    "Three objections recur in the literature. The first is surveillance bias:\n"
    "wealthier countries detect more resistance because they look harder. The\n"
    "second is that consumption and resistance are both downstream of economic\n"
    "development, so the association is spurious. The third is that resistance\n"
    "prevalence is measured inconsistently between reporting systems.\n\n"
    "2. DATA\n\n"
    "We assembled a panel of 120 country-year observations recording antibiotic\n"
    "consumption in defined daily doses per 1000 inhabitants per day, the\n"
    "percentage of tested isolates resistant to a first-line agent, and gross\n"
    "domestic product per capita in constant dollars.\n",

    "3. METHODS\n\n"
    "We regress resistance on consumption and report the ordinary least squares\n"
    "slope with heteroskedasticity-consistent standard errors. To test the\n"
    "economic-development objection we refit the model with gross domestic\n"
    "product per capita entered as a covariate and compare the consumption\n"
    "coefficient before and after adjustment. A confounder that explained the\n"
    "association would move that coefficient substantially toward zero.\n\n"
    "4. RESULTS\n\n"
    "Consumption is positively associated with resistance. The association\n"
    "survives adjustment for gross domestic product per capita: the consumption\n"
    "coefficient is essentially unchanged, and the coefficient on gross domestic\n"
    "product is not distinguishable from zero.\n\n"
    "5. LIMITATIONS\n\n"
    "The panel is observational. Surveillance intensity is not measured and may\n"
    "still bias the resistance estimate upward in high-income countries.\n",
)

# A phrase that appears in the body exactly once, for search assertions. Kept
# beside the text so a later edit to the paper cannot silently orphan it.
PAPER_SEARCH_TERM = "surveillance bias"


def build_paper_pdf(path: Path) -> Path:
    """Write a small multi-page paper with extractable, sectioned text."""
    import fitz  # PyMuPDF, via throughline-ingestion

    document = fitz.open()
    for text in _PAPER_PAGES:
        page = document.new_page()
        page.insert_textbox(fitz.Rect(60, 60, 535, 780), text,
                            fontsize=10.5, fontname="helv")
    document.save(path)
    document.close()
    return path


@pytest.fixture(scope="session")
def paper_pdf(tmp_path_factory) -> Path:
    """A generated paper, shared across the session — building it twice is waste."""
    directory = tmp_path_factory.mktemp("papers")
    return build_paper_pdf(directory / "consumption_and_resistance.pdf")


@pytest.fixture(scope="session")
def paper_search_term() -> str:
    """A phrase known to be in :func:`build_paper_pdf` output.

    A fixture rather than a literal in the test, so the phrase and the text it
    has to appear in cannot drift apart unnoticed.
    """
    return PAPER_SEARCH_TERM


@pytest.fixture(autouse=True)
def _fresh_model_provider():
    """
    Re-probe the model provider around every test.

    The provider is cached deliberately (probing costs a round trip), but that
    cache is process-global: one test pinning the provider to "none" would
    otherwise silently disable inference for every test that ran after it, in
    file order. Cheap to reset, and the alternative is an order-dependent suite.
    """
    import throughline_model

    throughline_model.provider(refresh=True)
    yield
    throughline_model.provider(refresh=True)
