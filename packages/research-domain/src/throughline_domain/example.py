"""The worked example — a real project, built by the real pipeline.

Part B6 asks for something a researcher can drag, expand and break before
investing anything of their own. The screen it replaces was a form: an empty
account was shown a text box and asked to describe a research question, which
is the highest-effort possible first action and tells them nothing about what
the product does with it.

**Nothing here is mocked, and that is the whole point.** The example is a
project like any other: two real sources are ingested through the real
ingestion path, the analysis is computed in the sandbox, the finding carries
the lifecycle and the provenance every other finding carries. A demo built from
canned JSON would look identical on the first screen and fall apart on the
second — and it would break the rule the product sells itself on, that every
number on screen came from a recorded run against a named dataset version.

It is also deliberately a *good* example rather than a flattering one. The
dataset carries a confounder that a careless reading would call a cause, and
the finding it produces says "association only". A worked example that showed
the system discovering a clean causal story would be teaching the wrong lesson
about the tool on the first screen a researcher ever sees.
"""

from __future__ import annotations

import io
from pathlib import Path
from typing import Any

import numpy as np

from throughline_schemas.enums import SourceType

from . import objects, storage, workflow
from .ids import new_id

#: Named so it is recognisable in a project list and obviously not the
#: researcher's own work.
EXAMPLE_PROJECT_NAME = "Example · Antibiotic consumption and resistance"

EXAMPLE_QUESTION = (
    "Is national antibiotic consumption associated with antimicrobial "
    "resistance, and does GDP per capita explain the relationship?"
)

#: Rows in the generated panel. Enough for a correlation to be worth trusting
#: and small enough that ingestion finishes while somebody is still looking.
ROWS = 120

#: Fixed, so the example is the same on every machine. A worked example whose
#: numbers move between installs cannot be written about in documentation, and
#: cannot be used to reproduce a support question.
SEED = 2024


def dataset_csv(rows: int = ROWS) -> bytes:
    """The panel: consumption drives resistance, GDP is a plausible red herring.

    GDP is generated independently of resistance. It correlates with nothing
    causal, and exists so the example has something for the confounding check
    to actually find — the same reason the fixture it grew from has it.
    """
    rng = np.random.default_rng(SEED)
    consumption = rng.normal(25, 6, rows)
    gdp = rng.normal(40000, 12000, rows)
    resistance = 0.85 * consumption + rng.normal(0, 2.5, rows)
    codes = ["IND", "USA", "GBR", "FRA", "DEU", "BRA", "JPN", "ZAF"]

    lines = ["country,consumption_ddd,resistance_pct,gdp_per_capita"]
    for i in range(rows):
        lines.append(
            f"{codes[i % 8]},{consumption[i]:.3f},{resistance[i]:.3f},{gdp[i]:.1f}")
    return ("\n".join(lines) + "\n").encode()


#: The paper's text, page by page. Written to be genuinely reconcilable against
#: the dataset: it reports a correlation of the same sign and rough magnitude,
#: and states a limitation the data can be checked against.
PAPER_PAGES: tuple[str, ...] = (
    "Antibiotic Consumption and Antimicrobial Resistance:\n"
    "A Cross-National Analysis\n\n"
    "Abstract\n\n"
    "We examine the relationship between national antibiotic consumption and "
    "the prevalence of antimicrobial resistance across 120 country-years. "
    "Consumption is measured in defined daily doses per 1000 inhabitants per "
    "day. Resistance is the proportion of invasive isolates reported as "
    "non-susceptible. We find a strong positive association between "
    "consumption and resistance. We do not claim causation: the design is "
    "cross-sectional and residual confounding is likely.\n",

    "Introduction\n\n"
    "Antimicrobial resistance is among the most consequential slow-moving "
    "threats to clinical medicine. Consumption is the most frequently "
    "proposed driver, and the association has been reported repeatedly at "
    "national scale. Reported effect sizes vary widely, which is usually "
    "attributed to differences in surveillance rather than to real "
    "heterogeneity in the underlying relationship.\n\n"
    "Data and Methods\n\n"
    "National surveillance returns were assembled into a panel of 120 "
    "country-years. Consumption and resistance were analysed with Pearson "
    "correlation. GDP per capita was included as a candidate confounder, on "
    "the grounds that wealthier health systems both prescribe differently and "
    "report more completely.\n",

    "Results\n\n"
    "Consumption and resistance are positively associated across the panel. "
    "The association survives adjustment for GDP per capita, whose own "
    "association with resistance is close to zero once consumption is "
    "accounted for.\n\n"
    "Limitations\n\n"
    "This is a cross-sectional analysis and cannot establish direction. "
    "Countries differ in how isolates are collected and which are referred "
    "for testing, so surveillance bias may still bias the resistance estimate "
    "upward in countries with more complete reporting. The estimate should be "
    "read as an association between two measured quantities, not as an effect "
    "of prescribing on resistance.\n",
)


def build_paper_pdf(path: Path) -> Path:
    """Write the paper as a real PDF, so ingestion parses it like any other."""
    import fitz  # PyMuPDF, declared by this package rather than borrowed.

    document = fitz.open()
    for text in PAPER_PAGES:
        page = document.new_page()
        page.insert_textbox(fitz.Rect(60, 60, 535, 780), text,
                            fontsize=10.5, fontname="helv")
    document.save(path)
    document.close()
    return path


def paper_pdf_bytes() -> bytes:
    """The paper as bytes. PyMuPDF writes to a path, so this goes via a temp."""
    import tempfile

    with tempfile.TemporaryDirectory() as directory:
        path = build_paper_pdf(Path(directory) / "consumption-and-resistance.pdf")
        return path.read_bytes()


def existing(cur, *, user_id: str) -> str | None:
    """The example project this user already has, if any.

    Seeding twice would leave a researcher with two identical projects and no
    way to tell which one they had been reading.
    """
    cur.execute(
        "SELECT id FROM projects WHERE owner_user_id = %s AND name = %s "
        "ORDER BY created_at LIMIT 1",
        (user_id, EXAMPLE_PROJECT_NAME),
    )
    row = cur.fetchone()
    return row["id"] if row else None


def create(cur, *, user_id: str, actor: str) -> dict[str, Any]:
    """Create the example project and start it ingesting.

    Returns as soon as the work is queued rather than waiting for it. Ingestion
    of a PDF takes seconds, and the workspace already knows how to show a source
    that is still being read — so the researcher watches the example assemble
    itself, which is a better introduction to what the product does than a
    spinner followed by a finished screen.
    """
    already = existing(cur, user_id=user_id)
    if already:
        return {"project_id": already, "created": False}

    project_id = new_id("prj")
    cur.execute(
        "INSERT INTO projects(id, owner_user_id, name, research_question, description) "
        "VALUES (%s, %s, %s, %s, %s)",
        (project_id, user_id, EXAMPLE_PROJECT_NAME, EXAMPLE_QUESTION,
         "A worked example. Everything in it was produced by the same pipeline "
         "your own sources go through — you can delete it whenever you like."),
    )

    for filename, media_type, payload in (
        ("consumption-and-resistance.pdf", "application/pdf", paper_pdf_bytes()),
        ("national-surveillance.csv", "text/csv", dataset_csv()),
    ):
        record = storage.register_file(
            cur, project_id=project_id, filename=filename,
            stream=io.BytesIO(payload), media_type=media_type)
        source_id = objects.create_source(
            cur, project_id=project_id, source_type=SourceType.UPLOAD,
            title=filename, actor=actor, file_id=str(record["id"]),
            content_hash=str(record["content_hash"]))
        workflow.enqueue(cur, workflow_name="ingest.source", project_id=project_id,
                         payload={"source_id": source_id},
                         idempotency_key=f"ingest:{source_id}")

    # Discovery cannot run until the dataset has been profiled, so it is queued
    # as its own step that waits for the columns to exist rather than assuming
    # an ordering the queue does not promise.
    # More attempts than the default three. Each one is a cheap check that the
    # dataset has been profiled yet, and the backoff has to cover however long
    # a PDF and a CSV take to ingest on a slow machine — running out of retries
    # would leave the example permanently half-built, which is worse than not
    # offering it.
    workflow.enqueue(cur, workflow_name="example.assemble", project_id=project_id,
                     payload={"project_id": project_id},
                     idempotency_key=f"example:{project_id}", max_attempts=12)

    return {"project_id": project_id, "created": True}
