"""Real haptic feedback, from the one place on this machine that can produce it.

A browser cannot make anything vibrate on a laptop. `navigator.vibrate` is
Android-only, Safari does not implement it, and Apple's Force Touch engine is
reachable from native code and not from a page. This process is native code, and
it is already running on the same machine as the browser — so the interface can
ask it for a tap and get a real one.

**What this can and cannot do, because the difference decides where it is worth
using.** The actuator is in the trackpad. A researcher with a hand resting there
feels it; a hand held in mid-air, making the gestures the spatial mode is built
around, does not — there is no actuator near it, and no software fixes that.
Saying so is the whole reason this module reports a capability instead of a
boolean called `haptics_enabled`.

So it earns its place on the pointer path, which Rule 5 makes co-equal: dragging
a 3D scatter, crossing a threshold, landing on a point. That is a hand on the
trackpad, and a tap there is the difference between a control that moves and one
that feels like it caught.

Everything here is best-effort and silent on failure. Feedback that raises is
worse than feedback that is missing.
"""

from __future__ import annotations

from typing import Any

#: Apple's three patterns, named for what they mean rather than numbered.
#:
#: `alignment` is the sharp one — it exists for the moment a dragged object snaps
#: to a guide, which is exactly the feel wanted when a selection lands. `generic`
#: is softer and marks a boundary. `level` is the double used for a step change.
PATTERNS: dict[str, int] = {
    "generic": 0,
    "alignment": 1,
    "level": 2,
}

_performer: Any = None
_looked = False


def _lookup() -> Any:
    """Find the trackpad performer once, and remember that we tried.

    Imported lazily and inside a try. `pyobjc` is a macOS-only dependency, this
    module is imported on Linux and Windows by the same API, and a haptic tap is
    not worth an ImportError at startup on a server.
    """
    global _performer, _looked
    if _looked:
        return _performer
    _looked = True
    try:
        import AppKit  # noqa: PLC0415 - deliberately lazy, see docstring

        _performer = AppKit.NSHapticFeedbackManager.defaultPerformer()
    except Exception:  # noqa: BLE001 - any failure means "not available here"
        _performer = None
    return _performer


def capability() -> dict[str, Any]:
    """What this machine can do, and where it can be felt.

    The `felt_where` field is the honest part. A capability that answered only
    "available: true" would let an interface promise a researcher something they
    will never feel while their hands are in the air.
    """
    performer = _lookup()
    if performer is None:
        return {
            "available": False,
            "reason": "This machine has no haptic actuator a program can reach. "
                      "On macOS that means no Force Touch trackpad; elsewhere "
                      "it means the platform offers nothing equivalent.",
            "felt_where": None,
            "patterns": [],
        }
    return {
        "available": True,
        "reason": None,
        # Said plainly, because it is the limit that matters: the actuator is in
        # the trackpad, so a hand in mid-air feels nothing.
        "felt_where": "the trackpad — a hand resting on it feels these; a hand "
                      "held in the air does not, because that is where the "
                      "actuator is",
        "patterns": sorted(PATTERNS),
    }


def tap(pattern: str = "generic") -> bool:
    """Perform one tap. Returns whether it was performed.

    Never raises. This is called from an interaction path, and an exception here
    would take down the gesture it was confirming — a feedback layer that can
    break the thing it decorates has failed at its only job.
    """
    performer = _lookup()
    if performer is None:
        return False

    identifier = PATTERNS.get(pattern)
    if identifier is None:
        return False

    try:
        # `performanceTime` 0 is "default": the system decides when in the frame
        # to fire, which is what Apple's own controls use. Asking for "now"
        # produces a tap that can land before the thing it is confirming has been
        # drawn, which feels like a tap for something else.
        performer.performFeedbackPattern_performanceTime_(identifier, 0)
        return True
    except Exception:  # noqa: BLE001
        return False


__all__ = ["PATTERNS", "capability", "tap"]
