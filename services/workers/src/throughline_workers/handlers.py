"""Workflow handlers.

Phase 0 registers exactly one handler — a health probe used to prove the queue
is durable end to end. Ingestion, analysis and discovery handlers arrive with
their phases; per §123 nothing is stubbed here to look implemented.
"""

from __future__ import annotations

from typing import Any

from .runner import REGISTRY


@REGISTRY.register("system.echo")
def echo(run: dict[str, Any], cur: Any) -> dict[str, Any]:
    """Return the payload. Used by tests and by the dev script's smoke check."""
    return {"echo": run["input"]}
