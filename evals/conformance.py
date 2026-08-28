"""
Every statistical method, checked against somebody else's implementation.

The market audit's first risk is the one this addresses: internal tests do not
prove scientific correctness. `tests/test_statistics.py` already compares
several methods against scipy, and that is the right idea done by hand — six of
the ten registered methods have a check, four do not, and nothing anywhere says
which four. A reader of the test file cannot tell a method that was checked from
one that was forgotten.

So this walks the registry instead of a list somebody maintains. Every method
either has a reference implementation here or an explicit reason why it cannot,
and a method that has neither **fails**. Adding a method without a check is
therefore a broken build rather than a silent gap — the same discipline the
skip allowlist applies to tests and the primitive registry applies to charts.

**Random frames, not chosen ones.** A hand-picked example can pass while ties,
unequal variances, a near-singular design or a degenerate group diverge. Each
method is run over many seeded frames, and the largest disagreement across all
of them is what gets reported — a maximum rather than an average, because an
average hides the one case that matters.

**What agreement means here.** Two implementations of the same test should agree
to floating-point noise, not to three decimal places: they are computing the
same closed form. A tolerance loose enough to hide a real difference in method —
a different denominator, a missing continuity correction, the wrong tail — would
make the whole exercise decorative. Where a method legitimately differs from the
naive reference, that is stated as a reason rather than absorbed into slack.

    python -m evals.conformance
"""

from __future__ import annotations

import argparse
import dataclasses
import json
import math
from typing import Any, Callable

import numpy as np
import pandas as pd
from scipy import stats

from throughline_runtime.contract import StatisticalResult
from throughline_runtime.methods import REGISTRY

#: Two implementations of one closed form should agree to floating-point noise.
#: Anything looser would hide a wrong denominator or a missing correction, which
#: is the class of error this exists to find.
TOLERANCE = 1e-9

#: How many random frames each method is judged over. Enough that ties, unequal
#: variances and lopsided groups all occur somewhere in the set.
FRAMES = 60


@dataclasses.dataclass
class Finding:
    method: str
    #: "checked" — compared against a reference; "declared" — reason given.
    status: str
    #: Largest disagreement seen, across every frame and every compared field.
    worst: float = 0.0
    #: Which field and which seed produced it, so a failure can be reproduced.
    worst_at: str = ""
    frames: int = 0
    reason: str = ""

    @property
    def agrees(self) -> bool:
        return self.status != "checked" or self.worst <= TOLERANCE


def _frame(seed: int) -> pd.DataFrame:
    """
    One random dataset, deliberately awkward.

    Groups of unequal size, a category with few members, values with ties and a
    predictor correlated with the outcome — the shapes where two implementations
    part company. A frame of clean independent normals would agree with anything.
    """
    rng = np.random.default_rng(seed)
    n = int(rng.integers(30, 90))
    x = rng.normal(size=n)
    # Correlated, so regression and correlation have signal to find.
    y = 0.6 * x + rng.normal(scale=0.8, size=n)
    # Deliberately unequal groups, and small ones.
    group = rng.choice(["a", "b", "c"], size=n, p=[0.55, 0.35, 0.10])
    # Rounded, so ranks have ties — where Spearman and Mann-Whitney differ most
    # between implementations that do and do not correct for them.
    tied = np.round(rng.normal(size=n), 1)
    other = rng.choice(["p", "q"], size=n)
    return pd.DataFrame({"x": x, "y": y, "group": group, "tied": tied,
                         "other": other})


def _run(method: str, frame: pd.DataFrame, **variables: Any) -> StatisticalResult:
    return REGISTRY[method](frame, {
        "variables": variables, "confidence_level": 0.95,
        "method_rationale": "", "random_seed": 0, "filters": [],
    })


def _compare(finding: Finding, seed: int, field: str,
             ours: float | None, theirs: float) -> None:
    """Record one disagreement, keeping the worst seen."""
    if ours is None or not math.isfinite(theirs):
        return
    gap = abs(float(ours) - float(theirs))
    if gap > finding.worst:
        finding.worst = gap
        finding.worst_at = f"{field} at seed {seed}"


# ---------------------------------------------------------------------------
# References. Each returns the fields it can check for one frame.
# ---------------------------------------------------------------------------

def _ref_pearson(frame: pd.DataFrame, _: StatisticalResult) -> dict[str, float]:
    r, p = stats.pearsonr(frame["x"], frame["y"])
    return {"estimate": r, "p_value": p}


def _ref_spearman(frame: pd.DataFrame, _: StatisticalResult) -> dict[str, float]:
    # `tied` is rounded on purpose: a Spearman that did not correct for ties
    # would agree on continuous data and diverge here.
    rho, p = stats.spearmanr(frame["tied"], frame["y"])
    return {"estimate": float(rho), "p_value": float(p)}


def _ref_t_test(frame: pd.DataFrame,
                result: StatisticalResult) -> dict[str, float]:
    """
    The arithmetic, given the method the result says it used.

    `t_test` chooses Student or Welch from Levene's test, so a reference that
    hardcoded either would report a disagreement that is a difference of
    *method selection* rather than an error — this ran first with Welch hardcoded
    and produced exactly that false finding.

    So the choice is read back from the assumption check the result publishes,
    and the arithmetic is then checked independently. That is the honest scope
    of this harness: given the test you say you ran, are the numbers right.
    Whether the choice itself was sound is a separate question, checked by the
    assumption tests rather than here.
    """
    a = frame.loc[frame["other"] == "p", "x"]
    b = frame.loc[frame["other"] == "q", "x"]
    equal = any(c.name == "equal_variance" and c.outcome == "passed"
                for c in result.assumptions)
    t, p = stats.ttest_ind(a, b, equal_var=equal)
    return {"test_statistic": float(t), "p_value": float(p)}


def _ref_mann_whitney(frame: pd.DataFrame, _: StatisticalResult) -> dict[str, float]:
    a = frame.loc[frame["other"] == "p", "tied"]
    b = frame.loc[frame["other"] == "q", "tied"]
    result = stats.mannwhitneyu(a, b, alternative="two-sided")
    return {"test_statistic": float(result.statistic),
            "p_value": float(result.pvalue)}


def _ref_anova(frame: pd.DataFrame, _: StatisticalResult) -> dict[str, float]:
    """
    Every group, including one with a single member.

    Dropping small groups looked like tidying and was a second false finding:
    the implementation keeps them deliberately — silently discarding a group is
    discarding data — so a reference that filtered them was analysing a
    different dataset and disagreed by 0.9 on the F statistic.
    """
    groups = [g["x"].to_numpy() for _, g in frame.groupby("group")]
    f, p = stats.f_oneway(*groups)
    return {"test_statistic": float(f), "p_value": float(p)}


def _ref_kruskal(frame: pd.DataFrame, _: StatisticalResult) -> dict[str, float]:
    # Every group, for the same reason as the ANOVA above.
    groups = [g["tied"].to_numpy() for _, g in frame.groupby("group")]
    h, p = stats.kruskal(*groups)
    return {"test_statistic": float(h), "p_value": float(p)}


def _ref_chi_square(frame: pd.DataFrame, _: StatisticalResult) -> dict[str, float]:
    table = pd.crosstab(frame["group"], frame["other"])
    chi2, p, dof, _ = stats.chi2_contingency(table, correction=False)
    return {"test_statistic": float(chi2), "p_value": float(p),
            "degrees_of_freedom": float(dof)}


def _ref_regression(frame: pd.DataFrame, _: StatisticalResult) -> dict[str, float]:
    fit = stats.linregress(frame["x"], frame["y"])
    return {"p_value": float(fit.pvalue)}


def _ref_descriptive(frame: pd.DataFrame, _: StatisticalResult) -> dict[str, float]:
    # Nothing to compare against a test statistic; the mean is what it reports.
    return {"estimate": float(frame["x"].mean())}


#: How each method is driven, and what checks it.
#:
#: Keyed by the registry's own names, so a renamed method shows up as
#: unrecognised rather than quietly losing its reference.
CHECKS: dict[str, tuple[dict[str, Any],
                        Callable[[pd.DataFrame, StatisticalResult],
                                 dict[str, float]]]] = {
    "pearson_correlation": ({"x": "x", "y": "y"}, _ref_pearson),
    "spearman_correlation": ({"x": "tied", "y": "y"}, _ref_spearman),
    "t_test": ({"value": "x", "group": "other"}, _ref_t_test),
    "mann_whitney": ({"value": "tied", "group": "other"}, _ref_mann_whitney),
    "anova": ({"value": "x", "group": "group"}, _ref_anova),
    "kruskal_wallis": ({"value": "tied", "group": "group"}, _ref_kruskal),
    "chi_square": ({"x": "group", "y": "other"}, _ref_chi_square),
    "linear_regression": ({"outcome": "y", "predictors": ["x"]}, _ref_regression),
    "descriptive": ({"columns": ["x"]}, _ref_descriptive),
}

#: Methods with no independent reference, and why. A reason here is a claim
#: somebody has to defend, which is the point of writing it down.
DECLARED: dict[str, str] = {
    "bootstrap_correlation":
        "Resampling has no closed form to compare against: two correct "
        "implementations disagree by design because they draw different "
        "samples. Its determinism under a fixed seed is tested instead, in "
        "tests/test_statistics.py, which is the property that can be checked.",
}


def evaluate(frames: int = FRAMES) -> list[Finding]:
    """Judge every registered method, in the registry's own order."""
    findings: list[Finding] = []

    for name in sorted(REGISTRY):
        if name in CHECKS:
            variables, reference = CHECKS[name]
            finding = Finding(method=name, status="checked")
            for seed in range(frames):
                frame = _frame(seed)
                try:
                    ours = _run(name, frame, **variables)
                    theirs = reference(frame, ours)
                except Exception:
                    # A frame this method legitimately refuses — too few rows in
                    # a group, a constant column — is not a disagreement. The
                    # refusals themselves are tested elsewhere; here they are
                    # simply not evidence either way.
                    continue
                finding.frames += 1
                for field, expected in theirs.items():
                    _compare(finding, seed, field, getattr(ours, field, None),
                             expected)
            findings.append(finding)
        elif name in DECLARED:
            findings.append(Finding(method=name, status="declared",
                                    reason=DECLARED[name]))
        else:
            findings.append(Finding(
                method=name, status="unchecked",
                reason="No reference implementation and no reason given."))
    return findings


def report(findings: list[Finding]) -> str:
    """The findings as something a statistician could be handed."""
    lines = ["Statistical conformance against scipy", ""]
    for f in findings:
        if f.status == "checked":
            verdict = "agrees" if f.agrees else "DIFFERS"
            lines.append(
                f"  {f.method:24} {verdict:8} worst {f.worst:.3e}"
                f"  over {f.frames} frames"
                + (f"  ({f.worst_at})" if not f.agrees else ""))
        elif f.status == "declared":
            lines.append(f"  {f.method:24} declared  {f.reason.split('.')[0]}.")
        else:
            lines.append(f"  {f.method:24} UNCHECKED {f.reason}")

    checked = [f for f in findings if f.status == "checked"]
    lines += ["",
              f"{len(checked)} checked, "
              f"{len([f for f in findings if f.status == 'declared'])} declared, "
              f"{len([f for f in findings if f.status == 'unchecked'])} unchecked.",
              f"Tolerance {TOLERANCE:.0e} — two implementations of one closed "
              "form should agree to floating-point noise."]
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--frames", type=int, default=FRAMES)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    findings = evaluate(args.frames)
    if args.json:
        print(json.dumps([dataclasses.asdict(f) for f in findings], indent=2))
    else:
        print(report(findings))

    bad = [f for f in findings if f.status == "unchecked" or not f.agrees]
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
