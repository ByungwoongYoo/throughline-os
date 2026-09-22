"""Replayability is explicit, exhaustive and distinct from runtime support."""
from __future__ import annotations

from throughline_domain import code_export, replay_capability
from throughline_runtime.methods import REGISTRY


def test_every_registered_method_has_exactly_one_replay_decision():
    known = set(REGISTRY)
    supported = set(replay_capability.REPLAY_SUPPORTED_METHODS)
    unsupported = set(replay_capability.DECLARED_UNSUPPORTED_REASONS)

    assert supported.isdisjoint(unsupported)
    assert supported | unsupported == known, (
        "Every runtime method needs an explicit replayability decision; "
        f"missing={known - (supported | unsupported)}, "
        f"stale={(supported | unsupported) - known}"
    )


def test_exporter_membership_cannot_drift_from_the_support_decision():
    assert set(code_export.EMITTABLE) == set(replay_capability.REPLAY_SUPPORTED_METHODS)


def test_unsupported_reasons_name_a_real_current_gap():
    for method, reason in replay_capability.DECLARED_UNSUPPORTED_REASONS.items():
        assert len(reason) > 50, f"{method} has a box-ticking replay refusal: {reason!r}"
        assert "not implemented" not in reason.lower()
