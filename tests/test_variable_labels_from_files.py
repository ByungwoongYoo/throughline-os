"""The label a data file states, against the label a model guesses.

SPSS, Stata and SAS record what every column means — a human wrote those in the
source system. `datasets.py` reads them (`column_names_to_labels`), and
`corpus.py` stores each one in `dataset_columns.description`, with a comment
saying that losing it "would mean re-deriving by inference something the file
already said outright".

**It was then re-derived by inference anyway.** `harmonize.py` set
`display_label` from the model's proposal, and its fallback was the raw column
name — so a file stating *Antibiotic consumption, DDD per 1000 inhabitants*
could still reach an axis as `survey_noise_b`. Worse, the query that loads
columns for harmonisation never selected `description` at all, so the value was
written on import and read by nothing: this project's named recurring defect,
occurring twice in one path.

ROADMAP Wave 3 — "SPSS/Stata labels into canonical variables", which the brief
calls the highest-leverage ingest feature in the product.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages" / "research-domain" / "src"))
from throughline_domain import harmonize  # noqa: E402


def column(**over):
    base = {"id": "dsc_1", "name": "survey_noise_b", "description": "",
            "physical_type": "float", "semantic_type": "measurement", "unit": None}
    base.update(over)
    return base


def test_the_file_label_is_preferred_over_the_model_proposal():
    """The file's label is a statement by whoever built the dataset; the
    proposal is an inference about it. Inference does not outrank the source."""
    stated = "Antibiotic consumption, DDD per 1000 inhabitants"
    got = harmonize._clean_label("Resistance Rate", column(description=stated))
    assert got == stated, (
        "a model's guess overrode the label the file stated outright")


def test_the_file_label_is_used_when_the_model_proposes_nothing():
    """The path that produced the visible defect: an empty or stripped proposal
    fell through to the raw column name."""
    stated = "Total inpatient bed-days"
    assert harmonize._clean_label("", column(description=stated)) == stated


def test_the_raw_column_name_is_the_last_resort_not_the_second():
    """CSV and Parquet carry no labels, so the proposal is genuinely the best
    available and must still be used. Only with neither does the raw name show."""
    assert harmonize._clean_label("Mortality rate", column()) == "Mortality rate"
    assert harmonize._clean_label("", column()) == "survey_noise_b"


def test_a_whitespace_only_file_label_does_not_win():
    """An empty `description` is the common case — every unlabelled format
    writes one — so it must not beat a real proposal."""
    assert harmonize._clean_label("Mortality rate",
                                  column(description="   ")) == "Mortality rate"


def test_harmonisation_actually_reads_the_description_back():
    """**The half that made the fix inert.** Preferring `description` changes
    nothing if the query that loads columns never selects it, which it did not:
    `corpus.py` wrote the value on import and nothing asked for it again."""
    source = (ROOT / "packages" / "research-domain" / "src" / "throughline_domain"
              / "harmonize.py").read_text()
    query = source[source.index("FROM dataset_columns dc WHERE") - 400:
                   source.index("FROM dataset_columns dc WHERE")]
    assert "dc.description" in query, (
        "the columns loaded for harmonisation no longer carry the file's own "
        "label, so preferring it silently does nothing")
