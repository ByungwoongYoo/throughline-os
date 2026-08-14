"""
The evaluation engine (§58).

Six of the specification's categories can be evaluated with no model provider,
and those six are implemented here. The other four — paper extraction quality,
analysis-method appropriateness, hallucinated sources in generated prose, and
video claim fidelity — need generation to evaluate, so they are declared and
reported as `not_implemented` rather than silently omitted. A harness that
reports 5/5 while quietly not testing four categories is a worse artifact than
one that reports 5/5 and names the gap.

Two of the implemented categories should be *provably* perfect rather than
merely observed to pass, and the distinction matters:

  NUMERICAL FIDELITY   Every number in a rendered artifact is either resolved
                       from a recorded row at render time, or text proven
                       identical to what a computation wrote. There is no field
                       in which a transcribed number could sit. This eval
                       re-derives every displayed value from source and compares.

  CITATION RESOLVABILITY
                       A citation is a foreign key. A reference to a source that
                       was never ingested cannot be inserted. This eval walks
                       every stored citation and follows it.

These are structural guarantees, so a failure here is not a regression in
accuracy — it is evidence that the structure was circumvented, which is a more
serious thing and worth reporting differently.

Entailment is *not* in that category and never claims to be. Run:

    python -m evals.harness --project prj_...
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from typing import Any

from throughline_domain import citations as citations_mod
from throughline_domain import communication
from throughline_domain.db import transaction


@dataclass
class Case:
    """One checked item."""
    name: str
    passed: bool
    detail: str


@dataclass
class Category:
    """One §58 evaluation category."""
    name: str
    section: str
    guarantee: str          # "structural" | "checked" | "not_implemented"
    cases: list[Case] = field(default_factory=list)
    note: str = ""

    @property
    def total(self) -> int:
        return len(self.cases)

    @property
    def passed(self) -> int:
        return sum(1 for c in self.cases if c.passed)

    @property
    def score(self) -> float | None:
        return None if not self.cases else self.passed / self.total


# ---------------------------------------------------------------------------
# 1. Numerical fidelity — "does displayed number equal computed output"
# ---------------------------------------------------------------------------

def numerical_fidelity(cur, project_id: str) -> Category:
    category = Category(
        name="Numerical fidelity", section="§58", guarantee="structural",
        note=("Every displayed value is re-resolved from its recorded row and "
              "compared against what the artifact shows. A block cannot hold a "
              "typed statistic — the authoring path refuses it — so a failure "
              "here would mean the structure was bypassed, not that a number "
              "drifted."),
    )

    cur.execute("SELECT id, title FROM communication_artifacts WHERE project_id = %s",
                (project_id,))
    artifacts = list(cur.fetchall())

    for artifact_row in artifacts:
        try:
            artifact = communication.load_artifact(cur, artifact_row["id"], resolve=True)
        except communication.UnresolvedReference as exc:
            category.cases.append(Case(
                f"{artifact_row['title']}: resolution", False, str(exc)))
            continue

        for block in artifact["blocks"]:
            for ref in block.get("value_provenance", []):
                shown = block["resolved"][ref["name"]]
                source, path = ref["source"], ref["path"]

                # Re-read independently of the resolver that produced it.
                if source.startswith("arun_"):
                    cur.execute("SELECT result FROM analysis_runs WHERE id = %s", (source,))
                    row = cur.fetchone()
                    origin = row["result"] if row else None
                else:
                    cur.execute("SELECT * FROM connections WHERE id = %s", (source,))
                    row = cur.fetchone()
                    origin = dict(row) if row else None

                actual = communication._dig(origin, path)
                ok = actual == shown
                category.cases.append(Case(
                    f"{block['id']}.{ref['name']}", ok,
                    f"shown {shown!r} vs recorded {actual!r} at {source}.{path}"
                    if not ok else f"{shown!r} == {source}.{path}",
                ))

        # A block whose text still contains an unsubstituted placeholder would
        # have reached a reader as literal "{{ref:...}}".
        for block in artifact["blocks"]:
            leftover = communication.REF.search(block["text"])
            category.cases.append(Case(
                f"{block['id']}: substitution", leftover is None,
                f"unsubstituted {leftover.group(0)}" if leftover else "fully substituted",
            ))

        # The check that actually bites (§102).
        #
        # Re-resolving and comparing against the resolver's own output cannot
        # disagree — both read the same row, so that alone would be a
        # tautology. What can disagree is a *file already written*: a DOCX
        # exported last week and emailed to a co-author states the numbers as
        # they were then. Every stored render carries the hash of the values it
        # was built from, so a re-hash now says exactly whether that file is
        # still true.
        current = communication.resolved_hash(artifact)
        cur.execute(
            "SELECT id, fmt, resolved_hash FROM artifact_renders WHERE artifact_id = %s",
            (artifact_row["id"],),
        )
        for render in cur.fetchall():
            ok = render["resolved_hash"] == current
            category.cases.append(Case(
                f"{artifact_row['title']}: {render['fmt']} render is current", ok,
                "matches the values currently recorded" if ok
                else (f"was rendered from different values "
                      f"({render['resolved_hash'][:12]} vs {current[:12]}); this file "
                      "states numbers the analyses no longer support"),
            ))

    if not artifacts:
        category.note += " No artifacts exist in this project yet."
    return category


# ---------------------------------------------------------------------------
# 2. Citation resolvability and entailment
# ---------------------------------------------------------------------------

def citation_integrity(cur, project_id: str) -> Category:
    category = Category(
        name="Citation resolvability", section="§58", guarantee="structural",
        note=("Every stored citation is followed to its target. Resolvability is "
              "enforced by foreign key at insert, so a fabricated reference "
              "cannot be stored; this re-checks that nothing was deleted "
              "underneath one."),
    )
    report = citations_mod.verify_project(cur, project_id)
    dangling = {d["citation_id"] for d in report["dangling"]}

    cur.execute("SELECT id FROM citations WHERE project_id = %s", (project_id,))
    for row in cur.fetchall():
        ok = row["id"] not in dangling
        category.cases.append(Case(
            row["id"], ok, "resolves" if ok else "dangling"))
    return category


def citation_entailment(cur, project_id: str) -> Category:
    """
    §58 citation entailment — reported, never scored as accuracy.

    This category deliberately has no pass rate. Most pairs are `not_checkable`
    because deciding whether a passage supports a sentence is a semantic
    judgement and no model provider is configured. Presenting "8 not_checkable"
    as 100% would be the single most misleading number this harness could
    produce.
    """
    category = Category(
        name="Citation entailment", section="§58", guarantee="checked",
        note=("Only the mechanically decidable part is judged: a numeric claim "
              "must have its number in the cited span or the cited run's result. "
              "Numbers that arrived through a resolved reference are excluded — "
              "they already carry a stronger guarantee. Everything else is "
              "not_checkable, which is not a pass."),
    )

    cur.execute(
        "SELECT bc.block_id, bc.citation_id, bc.entailment, bc.entailment_detail "
        "FROM block_citations bc JOIN citations c ON c.id = bc.citation_id "
        "WHERE c.project_id = %s",
        (project_id,),
    )
    for row in cur.fetchall():
        # Only `unsupported` counts as a failure. `not_checkable` and
        # `unverified` are recorded as unresolved, not as passes.
        if row["entailment"] == citations_mod.UNSUPPORTED:
            category.cases.append(Case(
                f"{row['block_id']}/{row['citation_id']}", False,
                row["entailment_detail"]))
        elif row["entailment"] == citations_mod.SUPPORTED:
            category.cases.append(Case(
                f"{row['block_id']}/{row['citation_id']}", True,
                row["entailment_detail"]))
        else:
            category.note += ""  # counted below rather than as a case

    cur.execute(
        "SELECT bc.entailment, COUNT(*) AS n FROM block_citations bc "
        "JOIN citations c ON c.id = bc.citation_id WHERE c.project_id = %s "
        "GROUP BY bc.entailment",
        (project_id,),
    )
    breakdown = {r["entailment"]: r["n"] for r in cur.fetchall()}
    unchecked = breakdown.get("not_checkable", 0) + breakdown.get("unverified", 0)
    category.note += (f" Of {sum(breakdown.values())} claim-citation pairs, "
                      f"{unchecked} could not be checked without a model provider.")
    return category


# ---------------------------------------------------------------------------
# 3. Provenance completeness
# ---------------------------------------------------------------------------

def provenance_completeness(cur, project_id: str) -> Category:
    """§58 — can every artifact trace back to its source?"""
    category = Category(
        name="Provenance completeness", section="§58, LAW 1", guarantee="checked",
        note="Every connection must reach a dataset version through its analysis run.",
    )

    cur.execute(
        "SELECT c.id, c.analysis_run_id, dr.dataset_version_id "
        "FROM connections c LEFT JOIN discovery_runs dr ON dr.id = c.discovery_run_id "
        "WHERE c.project_id = %s",
        (project_id,),
    )
    for row in cur.fetchall():
        ok = bool(row["analysis_run_id"]) and bool(row["dataset_version_id"])
        missing = []
        if not row["analysis_run_id"]:
            missing.append("analysis run")
        if not row["dataset_version_id"]:
            missing.append("dataset version")
        category.cases.append(Case(
            row["id"], ok,
            "reaches dataset version through its run" if ok
            else f"cannot reach: no {' and no '.join(missing)}"))

    # Every rendered artifact must reach at least one recorded computation.
    cur.execute(
        "SELECT a.id, a.title, COUNT(b.id) AS blocks, "
        "COUNT(*) FILTER (WHERE b.value_refs <> '{}'::jsonb) AS with_values "
        "FROM communication_artifacts a "
        "LEFT JOIN artifact_blocks b ON b.artifact_id = a.id "
        "WHERE a.project_id = %s GROUP BY a.id, a.title",
        (project_id,),
    )
    for row in cur.fetchall():
        ok = row["with_values"] > 0
        category.cases.append(Case(
            f"{row['title']}: grounded", ok,
            f"{row['with_values']} of {row['blocks']} blocks carry a value reference"
            if ok else "no block references a recorded computation"))
    return category


# ---------------------------------------------------------------------------
# 4. Finding classification
# ---------------------------------------------------------------------------

def finding_classification(cur, project_id: str) -> Category:
    """§58 — was an exploratory pattern incorrectly promoted?"""
    category = Category(
        name="Finding classification", section="§58, §13, §51", guarantee="checked",
        note=("A connection may only be validated if a validation report passed. "
              "Promotion is earned, never asserted."),
    )

    cur.execute(
        "SELECT c.id, c.lifecycle_status, c.q_value, "
        "(SELECT COUNT(*) FROM validation_reports v "
        " WHERE v.connection_id = c.id AND v.passed IS TRUE) AS passed_reports "
        "FROM connections c WHERE c.project_id = %s",
        (project_id,),
    )
    for row in cur.fetchall():
        status = row["lifecycle_status"]
        if status in ("validated", "replicated"):
            ok = row["passed_reports"] > 0
            detail = ("promoted with a passing validation report" if ok
                      else "promoted with NO passing validation report")
        elif status == "candidate" and row["q_value"] is not None and row["q_value"] < 0.05:
            # Not an error — but a survivor left at candidate is worth surfacing.
            ok = True
            detail = "below the FDR threshold and still held at candidate"
        else:
            ok = True
            detail = f"{status}, consistent"
        category.cases.append(Case(row["id"], ok, detail))
    return category


# ---------------------------------------------------------------------------
# 5. Visualization fidelity
# ---------------------------------------------------------------------------

def visualization_fidelity(cur, project_id: str) -> Category:
    """§58 — does the figure represent the underlying values?"""
    category = Category(
        name="Visualization fidelity", section="§58, §76", guarantee="checked",
        note="A figure may only be published if the visualization critic passed it.",
    )
    cur.execute(
        "SELECT id, publishable, critique FROM visuals WHERE project_id = %s",
        (project_id,),
    )
    rows = list(cur.fetchall())
    for row in rows:
        cur.execute("SELECT COUNT(*) AS n FROM visual_renders WHERE visual_id = %s",
                    (row["id"],))
        rendered = cur.fetchone()["n"] > 0
        ok = row["publishable"] or not rendered
        category.cases.append(Case(
            row["id"], ok,
            "passed the critic" if row["publishable"]
            else "not publishable and not rendered" if not rendered
            else "RENDERED DESPITE FAILING THE CRITIC"))
    if not rows:
        category.note += " No figures exist in this project yet."
    return category


# ---------------------------------------------------------------------------
# Declared but unimplemented (§123 — say so rather than omit)
# ---------------------------------------------------------------------------

UNIMPLEMENTED = [
    ("Paper extraction", "§58",
     "Needs a benchmark of papers with hand-labelled sample, method, variables, "
     "results and limitations, and a model to extract them. Neither exists here."),
    ("Analysis selection", "§58",
     "Whether the chosen statistical method suited the data is a methodological "
     "judgement. The assumption checks bound it but do not answer it."),
    ("Hallucination", "§58",
     "Nothing generates prose yet, so there is no generated text in which a "
     "nonexistent source could appear. Citations cannot be fabricated by "
     "construction, which is a different guarantee from this one."),
    ("Video claim fidelity", "§58",
     "No video pipeline exists (§136 is unbuilt)."),
]


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------

def extraction_fidelity(cur, project_id: str) -> Category:
    """
    Every quotation stored from a paper is still verbatim in that paper.

    Deliberately *not* the "paper extraction quality" category, which stays
    unimplemented. Quality asks whether the model found the right sample size and
    the right limitation, and answering it needs papers with hand-labelled
    ground truth. This asks something narrower and fully decidable: of the
    sentences it did keep, is each one actually in the document it claims to
    quote.

    Worth checking even though extraction verifies quotes at write time, because
    verification happened against the text as it read *then*. A source re-ingested
    with a better PDF parser, or re-uploaded, leaves every stored quotation
    asserting something about a document that has since changed underneath it —
    the same staleness the notebook lint exists for, in a place where the
    consequence is a fabricated quotation in a comparison table.

    Structural, because a failure is not a model being imprecise. Nothing in the
    write path can store an unverified quote, so a failure here means the text
    moved after the fact or the verifier was circumvented.
    """
    from throughline_domain.extraction import verify_quote

    category = Category(
        name="Extraction fidelity", section="§58", guarantee="structural",
        note=("Re-reads every stored quotation against the source's current "
              "indexed text. This is not extraction *quality* — whether the "
              "right sentences were chosen needs hand-labelled papers, and that "
              "category remains unimplemented below."),
    )

    cur.execute(
        "SELECT e.id, e.source_id, e.fields, s.title "
        "FROM paper_extractions e JOIN sources s ON s.id = e.source_id "
        "WHERE e.project_id = %s", (project_id,))
    extractions = cur.fetchall()

    if not extractions:
        category.note += " No papers have been read in this project yet."
        return category

    for extraction in extractions:
        cur.execute(
            "SELECT content FROM passages WHERE source_id = %s ORDER BY ordinal",
            (extraction["source_id"],))
        source_text = "\n".join(row["content"] for row in cur.fetchall())

        for field, value in (extraction["fields"] or {}).items():
            quote = (value or {}).get("quote", "")
            name = f"{extraction['title']}/{field}"
            if not source_text:
                category.cases.append(Case(
                    name, False,
                    "The source has no indexed text at all, so a quotation "
                    "stored against it cannot be checked — and a quotation that "
                    "cannot be checked is not one that has been."))
            elif verify_quote(quote, source_text):
                category.cases.append(Case(name, True, "Found verbatim."))
            else:
                category.cases.append(Case(
                    name, False,
                    f"Not present in the source as indexed now: {quote[:120]!r}. "
                    "It was verified when it was stored, so the document has "
                    "changed since — anything quoting this is quoting a paper "
                    "that no longer says it."))

    return category


CATEGORIES = (
    numerical_fidelity,
    citation_integrity,
    citation_entailment,
    provenance_completeness,
    finding_classification,
    visualization_fidelity,
    extraction_fidelity,
)


#: Checks that are not among the specification's categories. Counted separately
#: so that adding one never moves the coverage figure — otherwise the way to
#: report better coverage becomes writing more checks of one's own choosing,
#: which is the failure this harness exists to make impossible.
BEYOND_SPEC = frozenset({"Extraction fidelity"})


def _summary(results: list[Category]) -> str:
    """
    Coverage, derived rather than asserted.

    The denominator is the specified categories implemented plus those declared
    unimplemented — a number this file can actually establish. It used to be a
    hardcoded nine while the code carried six implemented and four declared,
    which is ten: the constant and the code had disagreed for some time, and a
    coverage figure that does not match its own parts is worse than none. The
    specification is not in this repository, so the honest denominator is the
    one derived from what is here.
    """
    from_spec = [c for c in results if c.name not in BEYOND_SPEC]
    specified = len(from_spec) + len(UNIMPLEMENTED)
    extra = len(results) - len(from_spec)

    text = (f"{len(from_spec)} of {specified} specified categories are "
            f"implemented; {len(UNIMPLEMENTED)} need a model provider or an "
            "unbuilt subsystem and are reported rather than skipped.")
    if extra:
        text += (f" {extra} further check{' runs' if extra == 1 else 's run'} "
                 "beyond the specification, and is not counted toward that "
                 "total." if extra == 1 else
                 f" {extra} further checks run beyond the specification, and "
                 "are not counted toward that total.")
    return text


def run(project_id: str) -> dict[str, Any]:
    results: list[Category] = []
    with transaction() as cur:
        cur.execute("SELECT id, name FROM projects WHERE id = %s", (project_id,))
        project = cur.fetchone()
        if not project:
            raise SystemExit(f"No such project: {project_id}")
        for check in CATEGORIES:
            results.append(check(cur, project_id))

    structural = [c for c in results if c.guarantee == "structural"]
    structural_failures = sum(c.total - c.passed for c in structural)

    return {
        "project": {"id": project_id, "name": project["name"]},
        "categories": [
            {
                "name": c.name, "section": c.section, "guarantee": c.guarantee,
                "checked": c.total, "passed": c.passed,
                "score": c.score, "note": c.note,
                "failures": [{"case": x.name, "detail": x.detail}
                             for x in c.cases if not x.passed],
            }
            for c in results
        ],
        "not_implemented": [
            {"name": n, "section": s, "reason": r} for n, s, r in UNIMPLEMENTED
        ],
        "structural_guarantees_held": structural_failures == 0,
        "summary": _summary(results),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the §58 evaluation suite.")
    parser.add_argument("--project", required=True, help="Project id to evaluate.")
    parser.add_argument("--json", action="store_true", help="Emit JSON.")
    args = parser.parse_args()

    report = run(args.project)

    if args.json:
        print(json.dumps(report, indent=2, default=str))
        return 0 if report["structural_guarantees_held"] else 1

    print(f"\n  EVALUATION — {report['project']['name']}  ({report['project']['id']})\n")
    for category in report["categories"]:
        if category["score"] is None:
            mark, score = "  ", "     no cases"
        else:
            mark = "OK" if category["score"] == 1.0 else "!!"
            score = f"{category['passed']:>4}/{category['checked']:<4} " \
                    f"{category['score'] * 100:5.1f}%"
        print(f"  [{mark}] {category['name']:<26} {score}   ({category['guarantee']})")
        for line in _wrap(category["note"], 68):
            print(f"         {line}")
        for failure in category["failures"][:5]:
            print(f"         FAIL {failure['case']}: {failure['detail'][:90]}")
        print()

    print("  Declared but not implemented:")
    for item in report["not_implemented"]:
        print(f"    - {item['name']} ({item['section']})")
        for line in _wrap(item["reason"], 66):
            print(f"        {line}")
    print()
    print(f"  Structural guarantees held: {report['structural_guarantees_held']}")
    print(f"  {report['summary']}\n")
    return 0 if report["structural_guarantees_held"] else 1


def _wrap(text: str, width: int) -> list[str]:
    words, lines, current = text.split(), [], ""
    for word in words:
        if len(current) + len(word) + 1 > width:
            lines.append(current)
            current = word
        else:
            current = f"{current} {word}".strip()
    if current:
        lines.append(current)
    return lines


if __name__ == "__main__":
    sys.exit(main())
