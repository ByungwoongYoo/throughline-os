"""
The model provider interface (§40, §41, §42).

Every capability the platform needs from a language model is declared here, and
nothing above this layer may import a vendor SDK. §40 asks for swappable models;
the way you get that is by making the abstraction the only thing anyone codes
against, so a second backend is an addition rather than a migration.

Three rules shape this file more than anything else:

**LAW 2 — a model may never produce a numerical result.** So there is no method
here that returns a number. `generate_structured` validates against a schema you
supply, and the schemas that matter (§41) carry *references* to recorded
computations rather than values. A model may say which analysis to run and how
to describe the outcome; the outcome comes from the sandbox.

**§35 — retrieved content is untrusted data.** `generate_text` takes trusted
instructions and untrusted context as separate arguments, and they are separated
in the assembled prompt too. A caller cannot accidentally concatenate a paper
into its own instructions, because there is no argument that would let it.

**§42 — never expose private chain-of-thought.** Responses carry a short
operational summary, not reasoning. Where a model emits thinking tags, they are
stripped before the text is returned.
"""

from __future__ import annotations

import re
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, TypeVar

from pydantic import BaseModel, ValidationError

T = TypeVar("T", bound=BaseModel)


class ModelError(RuntimeError):
    """The provider could not answer."""


class ModelUnavailable(ModelError):
    """No provider is configured or reachable.

    Distinct from other failures because §123 wants "this installation has no
    model" said plainly, not surfaced as a generic error.
    """


class StructuredOutputInvalid(ModelError):
    """The model's output did not match the requested schema after retries."""


@dataclass(slots=True)
class Usage:
    """What a call cost (§110)."""
    prompt_tokens: int = 0
    completion_tokens: int = 0
    duration_ms: int = 0

    @property
    def total_tokens(self) -> int:
        return self.prompt_tokens + self.completion_tokens


@dataclass(slots=True)
class Completion:
    """A model response, with everything §114 needs to reproduce it."""
    text: str
    model: str
    prompt_name: str
    prompt_version: int
    usage: Usage = field(default_factory=Usage)
    # §42 — what the model *did*, in one line, for the researcher to read.
    operational_summary: str = ""
    finish_reason: str = "stop"


@dataclass(slots=True)
class Capability:
    """What a configured provider can actually do (§123)."""
    name: str
    model: str
    text: bool = True
    structured: bool = False
    embeddings: bool = False
    vision: bool = False
    tools: bool = False
    context_tokens: int = 0
    # A local model is a privacy guarantee, not a performance note (§40).
    local: bool = True
    note: str = ""


# Thinking tags emitted by reasoning models. Stripped rather than shown: §42 is
# explicit that private chain-of-thought must not reach the researcher, and a
# half-formed hypothesis presented as output is worse than no output.
_THINKING = re.compile(r"<(think|thinking|reasoning)>.*?</\1>", re.DOTALL | re.IGNORECASE)


def strip_reasoning(text: str) -> str:
    return _THINKING.sub("", text or "").strip()


class ModelProvider(ABC):
    """
    One backend.

    Implementations raise `ModelUnavailable` when unreachable rather than
    returning empty output, so a caller can distinguish "no model here" from
    "the model had nothing to say" — a distinction §123 turns on.
    """

    name: str

    @abstractmethod
    def capability(self) -> Capability:
        """What this provider can do right now, checked rather than declared."""

    @abstractmethod
    def generate_text(
        self,
        *,
        instructions: str,
        untrusted_context: str = "",
        prompt_name: str,
        prompt_version: int,
        temperature: float = 0.2,
        max_tokens: int = 1024,
    ) -> Completion:
        """
        Free text.

        `instructions` is trusted; `untrusted_context` is anything retrieved
        (§35). They are never concatenated by the caller — the provider fences
        the untrusted part, so the boundary is enforced at the one place that
        builds the prompt rather than at every call site.
        """

    @abstractmethod
    def generate_structured(
        self,
        *,
        schema: type[T],
        instructions: str,
        untrusted_context: str = "",
        prompt_name: str,
        prompt_version: int,
        temperature: float = 0.0,
        max_attempts: int = 3,
    ) -> tuple[T, Completion]:
        """
        A validated object (§41).

        Malformed output is rejected and retried, and after `max_attempts` this
        raises. It does not fall back to parsing prose: §41 is explicit that
        critical product state must not be read out of arbitrary text, and a
        lenient parser is how that rule gets broken quietly.
        """

    def embed(self, texts: list[str]) -> list[list[float]]:
        raise ModelUnavailable(f"{self.name} does not provide embeddings.")

    def vision_analyze(self, *, image_bytes: bytes, instructions: str,
                       prompt_name: str, prompt_version: int) -> Completion:
        raise ModelUnavailable(f"{self.name} does not provide vision.")


class NullProvider(ModelProvider):
    """
    The provider used when none is configured.

    It refuses every call with a message naming the fix. This exists so the rest
    of the platform can be written against a provider that is always present,
    and so an unconfigured installation fails loudly at the point of use rather
    than silently degrading into a version of the product that quietly makes
    things up.
    """

    name = "none"

    def capability(self) -> Capability:
        return Capability(
            name="none", model="", text=False, local=True,
            note=("No model provider is configured. Install Ollama and pull a model, "
                  "or set THROUGHLINE_MODEL_PROVIDER. Features that need a model say "
                  "so rather than degrading."),
        )

    def _refuse(self) -> Any:
        raise ModelUnavailable(
            "No model provider is configured. This installation runs retrieval, "
            "statistics, validation and reporting without one; anything that needs "
            "a model is unavailable rather than approximated."
        )

    def generate_text(self, **_: Any) -> Completion:
        return self._refuse()

    def generate_structured(self, **_: Any) -> tuple[Any, Completion]:
        return self._refuse()


def validate_or_raise(schema: type[T], payload: Any, raw: str) -> T:
    """Validate a parsed payload, with an error a retry prompt can act on."""
    try:
        return schema.model_validate(payload)
    except ValidationError as exc:
        raise StructuredOutputInvalid(
            f"Output did not match {schema.__name__}: {exc.errors()[:3]}. "
            f"Received: {raw[:300]}"
        ) from exc


__all__ = [
    "Capability", "Completion", "ModelError", "ModelProvider", "ModelUnavailable",
    "NullProvider", "StructuredOutputInvalid", "Usage", "strip_reasoning",
    "validate_or_raise",
]
