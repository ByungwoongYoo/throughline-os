"""
Plain-language readings of results (§105, §115, §126).

The rigorous surface is correct and hard to read. A q-value of 5.17e-66 sitting
beside an evidence grade of `weak` is exactly right under §47 and looks like a
malfunction to anyone who has not met §47. §126 requires that a researcher who
does not know statistics can still use this platform; that cannot be met by
making the expert view friendlier, because the expert view is doing its job.

So this adds a second reading beside the first. Two properties keep it safe:

**It contains no numbers.** The schema forbids them and the stored row is
checked. A summary with no numbers cannot round, restate or drift from the
recorded values — it can only be right or wrong about their *meaning*, and the
exact figures are on screen beside it for the reader to check.

**It never replaces the rigorous view.** It is stored separately, labelled as a
model's reading, and the interface shows both. A researcher who reads only the
plain summary should still come away knowing the result is weak.
"""

from __future__ import annotations

import re
from typing import Any

from throughline_model import ModelUnavailable, provider, prompt
from throughline_model.schemas import PlainSummary

from .db import jsonb
from .ids import new_id


class InterpretationError(RuntimeError):
    """A summary could not be produced or was rejected."""


class SummaryContainedNumbers(InterpretationError):
    """The model wrote a figure into prose that must not carry one."""


# Digits that would be a claim. Ordinal words and section markers are fine;
# a decimal, a percentage or an exponent is a statistic wearing prose.
_NUMERIC_CLAIM = re.compile(
    r"(?:\d+\.\d+|\d+\s*%|\d+(?:\.\d+)?[eE][-+]?\d+|\bp\s*[=<>]|\bn\s*=\s*\d)")


def _describe_assumptions(checks: list[dict[str, Any]]) -> str:
    """
    Assumption checks as words, with no statistics.

    The model is told which assumptions were violated and how serious that is,
    but never the test statistic — it has no use for the number and every
    opportunity to misquote it.
    """
    if not checks:
        return "No assumption checks were recorded."
    lines = []
    for check in checks:
        line = f"- {check['name']}: {check['outcome']}"
        if check.get("severity") and check["outcome"] == "violated":
            line += f" ({check['severity']})"
        lines.append(line)
    return "\n".join(lines)


def _band(value: int | None) -> str:
    """Sample size as a band, so the model can reason about power without a figure."""
    if value is None:
        return "unknown"
    if value < 30:
        return "very small (under thirty)"
    if value < 100:
        return "small"
    if value < 1000:
        return "moderate"
    return "large"


def summarise_run(cur, *, run_id: str, refresh: bool = False) -> dict[str, Any]:
    """
    Produce, store and return a plain-language reading of an analysis run.

    Cached on the run: the same completed run always yields the same recorded
    numbers, so re-summarising it costs tokens for no new information. `refresh`
    overrides that when the prompt version has moved on.
    """
    cur.execute(
        "SELECT r.id, r.project_id, r.result, s.research_question "
        "FROM analysis_runs r LEFT JOIN analysis_specs s ON s.id = r.spec_id "
        "WHERE r.id = %s AND r.status = 'completed'",
        (run_id,),
    )
    run = cur.fetchone()
    if not run:
        raise InterpretationError(
            f"{run_id} is not a completed analysis run. A result is only "
            "interpretable once it has been computed (LAW 2)."
        )

    if not refresh:
        cur.execute(
            "SELECT summary, prompt_name, prompt_version, model, created_at "
            "FROM plain_summaries WHERE analysis_run_id = %s", (run_id,))
        cached = cur.fetchone()
        if cached:
            return {**cached["summary"], "cached": True,
                    "model": cached["model"],
                    "prompt": f"{cached['prompt_name']} v{cached['prompt_version']}"}

    cur.execute(
        "SELECT name, outcome, severity FROM assumption_checks WHERE run_id = %s "
        "ORDER BY name", (run_id,))
    assumptions = list(cur.fetchall())

    cur.execute(
        "SELECT vc.name, vc.outcome FROM validation_checks vc "
        "JOIN validation_reports vr ON vr.id = vc.report_id "
        "JOIN connections c ON c.id = vr.connection_id "
        "WHERE c.analysis_run_id = %s ORDER BY vc.name",
        (run_id,),
    )
    validation = list(cur.fetchall())

    result = run["result"] or {}
    template = prompt("plain_summary")

    instructions = template.render(
        method=result.get("method", "unknown"),
        variables=", ".join(
            str(v) for v in (result.get("extra") or {}).values()
            if isinstance(v, str)) or "not recorded",
        practical=result.get("practical_significance", "not assessed"),
        quality=result.get("evidence_quality", "not assessed"),
        assumptions=_describe_assumptions(assumptions),
        validation="\n".join(f"- {v['name']}: {v['outcome']}" for v in validation)
                   or "No robustness checks have been run.",
        limitations="\n".join(f"- {l}" for l in (result.get("limitations") or []))
                    or "None recorded.",
    )

    backend = provider()
    try:
        summary, completion = backend.generate_structured(
            schema=PlainSummary, instructions=instructions,
            prompt_name=template.name, prompt_version=template.version,
        )
    except ModelUnavailable as exc:
        # §123 — say what is missing, do not approximate it.
        raise InterpretationError(str(exc)) from exc

    # The schema asks for no numbers; this checks that it got none. A model that
    # writes "r was 0.9" into what the interface presents as a safe paraphrase
    # has reintroduced exactly the transcription risk Phase 5 removed.
    for field in ("headline", "what_it_means", "how_confident", "what_would_change_it"):
        text = getattr(summary, field)
        found = _NUMERIC_CLAIM.search(text)
        if found:
            raise SummaryContainedNumbers(
                f"The model wrote {found.group(0)!r} into {field}. A plain-language "
                "summary must carry no figures: the exact values are shown beside it "
                "and must not be restated where they could drift (LAW 2)."
            )

    payload = summary.model_dump()
    cur.execute(
        "INSERT INTO plain_summaries(id, project_id, analysis_run_id, summary, "
        "prompt_name, prompt_version, model, prompt_tokens, completion_tokens, "
        "duration_ms) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) "
        "ON CONFLICT (analysis_run_id) DO UPDATE SET summary = EXCLUDED.summary, "
        "prompt_name = EXCLUDED.prompt_name, prompt_version = EXCLUDED.prompt_version, "
        "model = EXCLUDED.model, created_at = now()",
        (new_id("psum"), run["project_id"], run_id, jsonb(payload),
         completion.prompt_name, completion.prompt_version, completion.model,
         completion.usage.prompt_tokens, completion.usage.completion_tokens,
         completion.usage.duration_ms),
    )

    return {
        **payload,
        "cached": False,
        "model": completion.model,
        "prompt": f"{completion.prompt_name} v{completion.prompt_version}",
        # §42 — an operational summary, not reasoning.
        "operational_summary": (
            f"Read the recorded result, its assumption checks and its validation "
            f"report, and restated them in plain language without figures."),
    }


__all__ = ["InterpretationError", "SummaryContainedNumbers", "summarise_run"]
