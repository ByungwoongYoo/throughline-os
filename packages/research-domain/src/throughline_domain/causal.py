"""
Law 6 — no causal language without a causal design.

A post-generation validator, deliberately, not a prompt instruction. Prompts are
requests: a model asked not to say "leads to" will say it anyway some fraction of
the time, and that fraction is invisible until a professor reads it in a
manuscript. A validator is a gate — text that claims more than the design
supports does not reach the researcher.

The rule that makes this tractable: **what a sentence may claim is a function of
how the data was collected, not of how strong the result is.** A correlation of
0.99 on cross-sectional data still cannot say "causes". A modest effect from a
randomised trial can. So the vocabulary is keyed to study design, and the
strength of the finding never unlocks a stronger verb.

Three sources of false positives get handled explicitly, because a validator that
cries wolf is one someone will switch off:

* **Statistical terms of art.** "effect size", "treatment effect", "main effect",
  "fixed effects" are names of quantities, not causal claims.
* **Negation.** "does not cause", "no evidence that X causes Y" are the correct
  careful phrasings this law exists to encourage.
* **Questions and hypotheses.** "whether X causes Y" and "we hypothesise that"
  are not assertions.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

# ---------------------------------------------------------------------------
# Study designs, ordered by what they can support
# ---------------------------------------------------------------------------

#: What each design licenses. The keys are the designs the platform can record;
#: the values are what a sentence about that data is permitted to assert.
DESIGN_LICENCE: dict[str, str] = {
    # Randomisation is what buys causal language. Nothing else does.
    "randomised_controlled_trial": "causal",
    "randomized_controlled_trial": "causal",
    "experiment": "causal",
    "randomised_experiment": "causal",

    # A credible natural experiment: causal claims are defensible but should be
    # attributed to the identification strategy rather than asserted flatly.
    "quasi_experiment": "conditional_causal",
    "instrumental_variable": "conditional_causal",
    "regression_discontinuity": "conditional_causal",
    "difference_in_differences": "conditional_causal",

    # Temporal ordering is established; confounding is not excluded.
    "cohort": "temporal",
    "longitudinal": "temporal",
    "panel": "temporal",
    "case_control": "temporal",

    # No temporal ordering at all. Association only.
    "cross_sectional": "association",
    "observational": "association",
    "ecological": "association",
    "survey": "association",
    "correlational": "association",

    # Unknown design is treated as the weakest case, never the strongest.
    # Defaulting the other way would let an unlabelled dataset license anything.
    "unknown": "association",
    "": "association",
}

#: Human wording for each licence, used in the explanation shown to a researcher.
LICENCE_DESCRIPTION = {
    "causal": "randomised — causal language is supported",
    "conditional_causal": ("quasi-experimental — causal language is defensible if "
                           "attributed to the identification strategy"),
    "temporal": ("temporal ordering established, confounding not excluded — "
                 "predictive and temporal language only"),
    "association": ("no temporal ordering or randomisation — association language "
                    "only"),
}


# ---------------------------------------------------------------------------
# Vocabulary
# ---------------------------------------------------------------------------

@dataclass(frozen=True, slots=True)
class Rule:
    """One forbidden construction, with what to say instead."""
    pattern: re.Pattern[str]
    claim: str
    replacement: str
    #: Lowest licence at which this construction becomes acceptable.
    permitted_at: str


def _rule(expression: str, claim: str, replacement: str,
          permitted_at: str = "causal") -> Rule:
    return Rule(re.compile(expression, re.IGNORECASE), claim, replacement, permitted_at)


#: Ordered most-specific first, so "has no effect on" is matched before "effect".
RULES: tuple[Rule, ...] = (
    _rule(r"\bcaus(?:e|es|ed|ing)\b", "causation",
          "is associated with"),
    _rule(r"\bcausal(?:ly)?\b", "causation", "associational"),
    _rule(r"\bdriv(?:e|es|en|ing)\b", "causation", "co-varies with"),
    _rule(r"\bleads?\s+to\b", "causation", "is associated with"),
    _rule(r"\bled\s+to\b", "causation", "was associated with"),
    _rule(r"\bresults?\s+in\b", "causation", "is associated with"),
    _rule(r"\bbecause\s+of\b", "causal attribution", "in the presence of"),
    _rule(r"\bdue\s+to\b", "causal attribution", "accompanied by"),
    _rule(r"\bowing\s+to\b", "causal attribution", "accompanied by"),
    _rule(r"\bproduc(?:e|es|ed|ing)\b", "causation", "is accompanied by"),
    _rule(r"\bindu(?:ce|ces|ced|cing)\b", "causation", "is associated with"),
    _rule(r"\btrigger(?:s|ed|ing)?\b", "causation", "precedes"),
    _rule(r"\bbrings?\s+about\b", "causation", "accompanies"),
    _rule(r"\bgives?\s+rise\s+to\b", "causation", "is associated with"),
    _rule(r"\bresponsible\s+for\b", "causal attribution", "associated with"),
    _rule(r"\battributabl[ey]\s+to\b", "causal attribution", "associated with"),
    _rule(r"\bconsequence\s+of\b", "causal attribution", "correlate of"),
    _rule(r"\bimpacts?\b", "causation", "differs with"),
    _rule(r"\binfluenc(?:e|es|ed|ing)\b", "causation", "co-varies with"),
    _rule(r"\baffect(?:s|ed|ing)?\b", "causation", "varies with"),
    _rule(r"\bthe\s+effect\s+of\b", "causation", "the association between"),
    _rule(r"\bexplains?\b", "causal attribution", "predicts"),
    _rule(r"\bdetermin(?:e|es|ed|ing)\b", "causation", "predicts"),
    _rule(r"\bprevents?\b", "causation", "is inversely associated with"),
    _rule(r"\breduc(?:e|es|ed|ing)\b", "causation", "is associated with lower"),
    _rule(r"\bincreas(?:e|es|ed|ing)\b", "causation", "is associated with higher"),
    _rule(r"\bimprov(?:e|es|ed|ing)\b", "causation", "is associated with better"),

    # Permitted once temporal ordering exists, but not before.
    _rule(r"\bpredicts?\b", "prediction", "is associated with", "temporal"),
    _rule(r"\bprecedes?\b", "temporal ordering", "co-occurs with", "temporal"),
    _rule(r"\bsubsequently\b", "temporal ordering", "also", "temporal"),
    _rule(r"\bover\s+time\b", "temporal change", "across the sample", "temporal"),
)

#: Terms of art containing a flagged word but asserting nothing causal. Matched
#: against the surrounding text before a violation is recorded.
TERMS_OF_ART = (
    r"effect\s+size", r"treatment\s+effect", r"main\s+effects?", r"fixed\s+effects?",
    r"random\s+effects?", r"marginal\s+effects?", r"interaction\s+effects?",
    r"effect\s+estimate", r"causal_status", r"causal\s+status", r"causal\s+design",
    r"causal\s+inference", r"causal\s+language", r"causal\s+claim",
    r"increase\s+the\s+sample", r"reduce\s+the\s+risk\s+of\s+bias",
    r"side\s+effects?", r"no\s+causal", r"cause\s+of\s+death",
)
_TERMS = re.compile("|".join(TERMS_OF_ART), re.IGNORECASE)

#: Constructions that turn an assertion into a denial, a question or a caveat.
#: Checked in the ~60 characters before the match.
_NEGATED = re.compile(
    r"\b(?:not|never|no|cannot|can(?:'|’)t|does\s+not|do\s+not|did\s+not|"
    r"without|neither|nor|rather\s+than|instead\s+of|"
    r"whether|if|unclear\s+(?:whether|if)|test\s+whether|"
    r"hypothes\w+|question\s+of|nothing\s+(?:here|in)|"
    r"cannot\s+tell|does\s+not\s+establish|may\s+not)\b",
    re.IGNORECASE,
)

_LICENCE_ORDER = {"association": 0, "temporal": 1, "conditional_causal": 2, "causal": 3}


@dataclass(slots=True)
class Violation:
    """One phrase claiming more than the design supports."""
    phrase: str
    start: int
    end: int
    claim: str
    suggestion: str
    sentence: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "phrase": self.phrase, "start": self.start, "end": self.end,
            "claim": self.claim, "suggestion": self.suggestion,
            "sentence": self.sentence,
        }


class CausalLanguageViolation(RuntimeError):
    """Text claimed causation the study design cannot support."""

    def __init__(self, violations: list[Violation], design: str) -> None:
        self.violations = violations
        self.design = design
        phrases = ", ".join(sorted({f"{v.phrase!r}" for v in violations})[:5])
        super().__init__(
            f"This text claims causation that a {design.replace('_', ' ')} design "
            f"cannot support: {phrases}. "
            f"{LICENCE_DESCRIPTION.get(licence_for(design), '')}."
        )


def licence_for(design: str) -> str:
    """What a given study design permits a sentence to claim."""
    return DESIGN_LICENCE.get((design or "").strip().lower(), "association")


def _sentence_around(text: str, index: int) -> str:
    start = max(text.rfind(".", 0, index), text.rfind("\n", 0, index)) + 1
    end = text.find(".", index)
    end = len(text) if end == -1 else end + 1
    return text[start:end].strip()


def check(text: str, *, design: str) -> list[Violation]:
    """
    Find every phrase claiming more than `design` supports.

    Returns rather than raises, so a caller can choose between rewriting,
    warning and refusing. `enforce` is the raising version.
    """
    if not text:
        return []

    licence = licence_for(design)
    allowed = _LICENCE_ORDER[licence]
    violations: list[Violation] = []

    for rule in RULES:
        if _LICENCE_ORDER[rule.permitted_at] <= allowed:
            continue
        for match in rule.pattern.finditer(text):
            window_start = max(0, match.start() - 60)
            before = text[window_start:match.start()]
            around = text[window_start:min(len(text), match.end() + 30)]

            # A term of art is a name, not a claim.
            if _TERMS.search(around):
                continue
            # A denial, a question or a hypothesis is not an assertion.
            if _NEGATED.search(before):
                continue

            violations.append(Violation(
                phrase=match.group(0),
                start=match.start(),
                end=match.end(),
                claim=rule.claim,
                suggestion=rule.replacement,
                sentence=_sentence_around(text, match.start()),
            ))

    # Deduplicate overlapping matches, keeping the longest at each position.
    violations.sort(key=lambda v: (v.start, -(v.end - v.start)))
    kept: list[Violation] = []
    for violation in violations:
        if kept and violation.start < kept[-1].end:
            continue
        kept.append(violation)
    return kept


def enforce(text: str, *, design: str) -> str:
    """
    Return the text, or refuse it.

    Used at the boundary where model output becomes something a researcher
    reads. Refusing is correct: a sentence that overstates its design is not
    improved by a warning beside it, because the sentence is what gets quoted.
    """
    violations = check(text, design=design)
    if violations:
        raise CausalLanguageViolation(violations, design)
    return text


def rewrite(text: str, *, design: str) -> tuple[str, list[Violation]]:
    """
    Apply each rule's suggested replacement.

    Offered for review, never applied silently — a substitution can produce a
    grammatically odd sentence, and LAW 4 forbids changing what a researcher
    will publish without showing them. The violations are returned alongside so
    the interface can show both versions.
    """
    violations = check(text, design=design)
    rewritten = text
    for violation in sorted(violations, key=lambda v: v.start, reverse=True):
        rewritten = (rewritten[:violation.start] + violation.suggestion
                     + rewritten[violation.end:])
    return rewritten, violations


def describe(design: str) -> dict[str, Any]:
    """What this design permits, for display beside a result."""
    licence = licence_for(design)
    return {
        "design": design or "unknown",
        "licence": licence,
        "description": LICENCE_DESCRIPTION[licence],
        "permits_causal_language": licence in ("causal", "conditional_causal"),
        "note": (
            "What a sentence may claim depends on how the data were collected, "
            "not on how strong the result is. A very large correlation from "
            "cross-sectional data still supports only association."
        ),
    }


__all__ = [
    "CausalLanguageViolation", "DESIGN_LICENCE", "LICENCE_DESCRIPTION", "RULES",
    "Rule", "Violation", "check", "describe", "enforce", "licence_for", "rewrite",
]
