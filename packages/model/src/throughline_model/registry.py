"""
Provider selection and prompt versioning.

The brief asks for routing by task type, cost, latency, context size, reasoning
need, privacy and vision. There are two backends now — one local, one hosted —
and the routing table matters more than ever, because the alternative is that
call sites hard-code a provider and the abstraction stops being real the first
time a second backend appears.

Every model output must be traceable to the prompt that produced it. Prompts
are therefore values with names and versions, stored alongside the output, so
"why did it say that" is answerable months later. Editing a prompt in place
would break that, so a changed prompt gets a new version.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache

from .ollama import OllamaProvider
from .provider import Capability, ModelProvider, NullProvider


@dataclass(frozen=True, slots=True)
class Prompt:
    """
    A named, versioned instruction.

    Frozen because a prompt that can be mutated after an output was recorded
    makes the recorded prompt_version a lie.
    """
    name: str
    version: int
    text: str

    def render(self, **values: object) -> str:
        return self.text.format(**values)


# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------

# Shared preamble. Every prompt inherits the two rules that matter most, because
# stating them once per prompt is how they get forgotten in the tenth one.
_LAWS = (
    "You are part of a research platform that computes its own statistics.\n"
    "You must never state a numerical result. Sample sizes, coefficients, "
    "p-values and confidence intervals come from recorded computations, not from "
    "you. If a number seems necessary, describe it in words instead.\n"
    "Do not claim causation from an association.\n"
    "If the information given is insufficient, say so rather than guessing."
)

PLAIN_SUMMARY = Prompt(
    name="plain_summary", version=3,
    text=(
        _LAWS + "\n\n"
        "Explain a statistical result to a researcher who is not a statistician — "
        "a first-year PhD student, or a professor from another field.\n\n"
        "Write no numbers at all. The exact figures are shown next to your summary; "
        "your job is the meaning, not the values.\n\n"
        "Be direct about weakness. If assumptions were violated, say plainly that the "
        "result deserves less weight than its p-value suggests, and why. A reader who "
        "walks away over-confident has been failed.\n\n"
        # Said once. It was in here twice, which cost tokens on every summary and
        # taught nothing the first statement had not already said.
        "Refer to the variables ONLY by the names given below. Never write a raw "
        "column name such as `consumption_ddd` — the reader has never seen the "
        "spreadsheet and a column name tells them nothing.\n\n"
        "The result:\n"
        "Method: {method}\n"
        "What was compared: {variables}\n"
        "Effect size interpretation: {practical}\n"
        "Evidence quality: {quality}\n"
        "Assumption checks: {assumptions}\n"
        "Validation checks: {validation}\n"
        "Limitations recorded: {limitations}\n"
    ),
)

VISUAL_RECOMMENDATION = Prompt(
    name="visual_recommendation", version=1,
    text=(
        _LAWS + "\n\n"
        "Choose the best chart for this result, and say why.\n\n"
        "Choose from this catalogue only:\n{catalogue}\n\n"
        "Rules that override preference:\n"
        "- A chart that hides sample size when n is small is the wrong chart.\n"
        "- Show uncertainty whenever the result has an interval.\n"
        "- Do not recommend a pie or donut for more than five categories, or for "
        "anything that is not part-of-a-whole.\n"
        "- Prefer showing the data over showing a summary of it when n is small "
        "enough to plot.\n"
        "- Say what your recommendation would hide, in why_not. Every chart hides "
        "something; a blank why_not means you have not thought about it.\n\n"
        "The caption must contain no numbers.\n\n"
        "Research question: {question}\n"
        "Analysis method: {method}\n"
        "Variables and their types:\n{variables}\n"
        "Sample size band: {n_band}\n"
        "Has confidence interval: {has_ci}\n"
        "Audience: {audience}\n"
    ),
)

COMPATIBILITY = Prompt(
    name="compatibility_assessment", version=2,
    text=(
        _LAWS + "\n\n"
        "Decide whether these two research objects can be meaningfully compared.\n\n"
        "Refusing is a legitimate and often correct answer. Two things that share a "
        "topic but not a measurement are RELATED_BUT_NOT_COMPARABLE. Forcing a "
        "comparison manufactures a relationship that does not exist, which is worse "
        "than declining.\n\n"
        "Verdicts:\n"
        "- DIRECTLY_COMPARABLE: same measurement, same units, comparable populations.\n"
        "- COMPARABLE_AFTER_HARMONIZATION: same concept, different units or coding.\n"
        "- CONCEPTUALLY_COMPARABLE: same construct, different measurement; compare "
        "with stated caveats.\n"
        "- RELATED_BUT_NOT_COMPARABLE: same domain, no shared measurement.\n"
        "- NOT_MEANINGFULLY_COMPARABLE: no shared basis at all.\n\n"
        "Object A ({left_kind}):\n{left}\n\n"
        "Object B ({right_kind}):\n{right}\n"
    ),
)

COMPARISON = Prompt(
    name="comparison_plan", version=1,
    text=(
        _LAWS + "\n\n"
        "Compare these two research objects across the dimensions that matter for "
        "this pair. Do not use a fixed checklist — choose the dimensions the "
        "objects actually differ or agree on.\n\n"
        "For each dimension state what each object says, and whether they agree. "
        "Where one object is silent, mark it not_stated rather than inferring.\n\n"
        "List genuine contradictions separately. A difference in population or method "
        "is not a contradiction; it is a reason results may differ.\n\n"
        "Object A:\n{left}\n\nObject B:\n{right}\n"
    ),
)

INTENT = Prompt(
    name="command_intent", version=1,
    text=(
        _LAWS + "\n\n"
        "Resolve a researcher's request into one platform action.\n\n"
        "If the request does not map cleanly onto one of the available intents, "
        "answer `unsupported` and say why. Guessing the nearest action is how a "
        "system confidently does the wrong thing.\n\n"
        "Restate the request as you understood it, so the researcher can confirm "
        "before anything runs.\n\n"
        "Available in this project:\n{context}\n\n"
        "Request: {request}\n"
    ),
)

HYPOTHESIS = Prompt(
    name="hypothesis", version=2,
    text=(
        _LAWS + "\n\n"
        "Propose hypotheses that the observed results suggest but do not establish.\n\n"
        "Every hypothesis must state what observation would falsify it. A hypothesis "
        "with no way to be wrong is a restatement of the data, not a hypothesis, and "
        "will be rejected.\n\n"
        "Do not propose anything the available variables cannot test.\n\n"
        "What is known:\n{context}\n"
    ),
)

RESEARCH_PLAN = Prompt(
    name="research_plan", version=1,
    text=(
        _LAWS + "\n\n"
        "Turn a research objective into a visible plan.\n\n"
        "Mark any step that would transform or filter the data with modifies_data, "
        "because those need explicit approval before they run.\n\n"
        "State what the plan cannot answer with the available material. A plan that "
        "silently omits its own limits is worse than a shorter honest one.\n\n"
        "Objective: {objective}\n"
        "Available in this project:\n{available}\n"
    ),
)

VARIABLE_LABELS = Prompt(
    name="variable_labels", version=1,
    text=(
        _LAWS + "\n\n"
        "Read each column of a dataset and say what it measures.\n\n"
        "The labels you produce replace raw column names everywhere a researcher "
        "reads results, so a wrong label silently rewrites the meaning of every "
        "figure that follows. Where a name is too abbreviated or generic to read "
        "confidently, set ambiguous and say so in the definition. Guessing is worse "
        "than admitting the name is unclear — a reviewer can fix 'unclear', and "
        "cannot fix a confident mistake they did not notice.\n\n"
        "Never invent a unit. If the column name and profile do not indicate one, "
        "leave unit empty.\n\n"
        "The label is for a reader: sentence case, no underscores, no abbreviation "
        "they would have to decode. The canonical_name is a key for matching the "
        "same concept across datasets: lowercase with underscores.\n\n"
        "Research context: {question}\n\n"
        "Columns:\n{columns}\n"
    ),
)

LOCATE_CLAIMS = Prompt(
    name="locate_claims", version=2,
    text=(
        _LAWS + "\n\n"
        "Find the empirical claims in this paper that a dataset could test.\n\n"
        "A testable claim asserts a relationship between two things that could be "
        "measured. 'Antibiotic consumption is associated with resistance' is "
        "testable. 'More research is needed' and 'this has policy implications' "
        "are not — do not return them.\n\n"
        "Quote the claim in the paper's own words. Name the exposure and the "
        "outcome as concepts, not as column names — you have not seen any "
        "dataset.\n\n"
        "If the paper reports an effect size, quote it verbatim — 'r = 0.42', "
        "'OR 1.8'. Do not compute, convert or estimate one. The system parses "
        "the number itself so the parse can be checked against your quotation; "
        "a figure you calculated would be a claim of your own, and every number "
        "in this system comes from a recorded computation.\n\n"
        "Report the study design the paper states. If it does not state one, say "
        "unknown rather than inferring from the topic: what a claim can support "
        "depends on how the data were collected, and guessing that wrongly is how "
        "an association becomes a cause.\n\n"
        "If the text contains no testable empirical claim, return no claims and "
        "say so in the note. An empty answer is correct far more often than a "
        "strained one.\n"
    ),
)

EXTRACT_PAPER = Prompt(
    name="extract_paper", version=2,
    text=(
        _LAWS + "\n\n"
        "Find the sentences in this paper that state each of the following, and "
        "copy them out.\n\n"
        "  design            — what kind of study it was\n"
        "  population        — who or what was studied\n"
        "  sample_size       — how many\n"
        "  methodology       — how the analysis was done\n"
        "  outcome_measure   — what was measured, and how it was defined\n"
        "  results           — the main result\n"
        "  limitations       — what the paper says it cannot show\n"
        "  funding           — who paid for it\n"
        "  conflicts         — declared competing interests\n\n"
        "Return one entry per item you can find, with the sentence copied "
        "exactly as it appears — same words, same numbers, same punctuation. "
        "Do not paraphrase or shorten. Each quote is checked against the paper "
        "afterwards, and one that does not match is discarded, so copying "
        "faithfully is what makes your answer count.\n\n"
        "Most papers state most of these. Look for all nine. Omit an item only "
        "when the paper genuinely does not state it — a missing limitations "
        "statement is a real and useful fact about a paper, but so is a methods "
        "sentence you did not bother to find.\n"
    ),
)

PROMPTS: dict[str, Prompt] = {
    p.name: p for p in (
        PLAIN_SUMMARY, VISUAL_RECOMMENDATION, COMPATIBILITY, COMPARISON,
        INTENT, HYPOTHESIS, RESEARCH_PLAN, VARIABLE_LABELS, LOCATE_CLAIMS,
        EXTRACT_PAPER,
    )
}


# ---------------------------------------------------------------------------
# Provider selection
# ---------------------------------------------------------------------------

#: A choice made in the interface, which outranks the environment.
#:
#: The environment is how an operator configures a deployment; this is how a
#: researcher configures their own machine. Their choice has to survive a
#: restart, so it is persisted by the caller and re-applied at startup — this
#: module deliberately holds no database connection.
#:
#: `api_key` is here for the same reason and with one extra rule: it is never
#: reported by `selection()` and never appears in a capability. A credential
#: that can be read back out of the process is one that ends up in a log line,
#: a debug endpoint or a screenshot eventually.
_override: dict[str, str | None] = {"provider": None, "model": None,
                                    "api_key": None}


def configure(*, provider: str | None = None, model: str | None = None,
              api_key: str | None = None) -> None:
    """
    Point the system at a different model, effective immediately.

    `api_key` is only meaningful for a hosted provider. Passing it does not
    select one — a key on the shelf is not a decision to send data off the
    machine, and conflating the two would let saving a credential silently
    change where unpublished research goes.
    """
    if provider is not None:
        _override["provider"] = provider
    if model is not None:
        _override["model"] = model
    if api_key is not None:
        # An empty string clears it: that is how a caller says "the key was
        # removed" without a second function that could be forgotten.
        _override["api_key"] = api_key or None
    _cached.cache_clear()


def selection() -> dict[str, str | None]:
    """What is selected right now, and where the choice came from."""
    return {
        "provider": _override["provider"]
                    or os.environ.get("THROUGHLINE_MODEL_PROVIDER", "ollama"),
        "model": _override["model"] or os.environ.get("THROUGHLINE_MODEL"),
        "source": "chosen in the interface" if _override["provider"]
                  or _override["model"] else "environment",
    }


def _build() -> ModelProvider:
    """
    The configured backend, or none.

    `ollama` stays the default and nothing promotes the hosted provider
    implicitly. The local default is the privacy guarantee the product makes —
    a fallback that reached for a hosted model when the local one was missing
    would silently move a researcher's unpublished data off their machine to
    fix an availability problem, which is not a trade this code gets to make on
    their behalf.
    """
    configured = (_override["provider"]
                  or os.environ.get("THROUGHLINE_MODEL_PROVIDER", "ollama")).lower()
    if configured in ("none", "off", "disabled"):
        return NullProvider()
    if configured == "ollama":
        provider: ModelProvider = OllamaProvider(model=_override["model"])
    elif configured == "anthropic":
        from .anthropic_provider import AnthropicProvider
        provider = AnthropicProvider(model=_override["model"],
                                     api_key=_override["api_key"])
    else:
        return NullProvider()
    # A provider that cannot answer is worse than none: it turns "this
    # feature needs a model" into a runtime error at the moment of use.
    return provider if provider.capability().text else NullProvider()


@lru_cache(maxsize=1)
def _cached() -> ModelProvider:
    return _build()


def provider(*, refresh: bool = False) -> ModelProvider:
    """
    The configured provider.

    Cached because capability probing costs a network round trip and is asked
    for on most requests. `refresh` re-probes after the researcher installs a
    model, so the interface can go from "none" to available without a restart.
    """
    if refresh:
        _cached.cache_clear()
    return _cached()


def capability() -> Capability:
    return provider().capability()


def prompt(name: str) -> Prompt:
    try:
        return PROMPTS[name]
    except KeyError as exc:
        raise KeyError(f"Unknown prompt {name!r}. Known: {sorted(PROMPTS)}") from exc


__all__ = ["PROMPTS", "Prompt", "capability", "prompt", "provider"]
