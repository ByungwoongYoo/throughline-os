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
            "physical_type": "float", "semantic_type": "measurement", "unit": None,
            "original_name": "survey_noise_b", "unique_count": 42,
            "missing_count": 0}
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


# --- what the model is told when it proposes a canonical name ----------------


def test_the_model_is_shown_what_the_file_states():
    """**The expensive half of the same mistake.**

    `_clean_label` was fixed so the *display* label comes from the file. But the
    model still proposed the *canonical name* — the thing that decides whether
    two datasets are comparable at all — from `survey_noise_b`, while the file
    said "Antibiotic consumption, DDD per 1000 inhabitants" one field away.
    Withholding the meaning and then asking for it back is strictly worse than
    passing it along.
    """
    line = harmonize._profile_line(
        column(description="Antibiotic consumption, DDD per 1000 inhabitants"))
    assert "Antibiotic consumption" in line, (
        "the model is asked to name a column whose meaning the file stated, "
        "without being shown it")


def test_a_column_with_no_stated_meaning_reads_as_before():
    """CSV and Parquet carry no labels, and every unlabelled format writes an
    empty description — so the common line must not grow a dangling clause."""
    line = harmonize._profile_line(column())
    assert "the file states" not in line
    assert line.startswith("survey_noise_b (")


def test_a_stated_meaning_is_bounded():
    """A label is free text from somebody else's system. Unbounded, it is a
    prompt-injection surface as much as a token cost."""
    line = harmonize._profile_line(column(description="x" * 5000))
    assert len(line) < 500, "an unbounded label reaches the prompt intact"


def test_the_rows_themselves_still_never_leave():
    """The profile's standing promise. A label is metadata — the same category
    as `original_name`, already sent — and this must not have widened it into
    sending values.

    Checked against statements only. The docstring's own promise reads "without
    its values", so a check that could not tell prose from code would forbid the
    function from stating the guarantee it keeps.
    """
    source = (ROOT / "packages" / "research-domain" / "src" / "throughline_domain"
              / "harmonize.py").read_text()
    body = source[source.index("def _profile_line"):]
    body = body[:body.index("\ndef ", 10)]
    quote = chr(34) * 3
    code, in_doc = [], False
    for line in body.splitlines():
        if line.count(quote) == 1:
            in_doc = not in_doc
            continue
        if in_doc or line.strip().startswith("#") or quote in line:
            continue
        code.append(line)
    code = "\n".join(code)

    for leak in ("fetchall", "SELECT", "sample(", "head(", ".values"):
        assert leak not in code, (
            f"_profile_line now touches {leak!r}; it may only describe a "
            "column, never carry its rows")
