"""Real haptics, and honesty about where they can be felt.

A browser cannot make a laptop vibrate: `navigator.vibrate` is Android-only and
Safari does not implement it. This process is native code on the same machine,
so it can produce a real tap — and the reason this module reports a *capability*
rather than a boolean is that the tap happens in the trackpad. A hand resting
there feels it. A hand held in the air, making the gestures the spatial mode is
built around, does not, because that is where the actuator is.

Promising haptic feedback for mid-air gesture would be a claim the hardware
cannot keep, so the tests below are mostly about what it says rather than what
it does.
"""

from __future__ import annotations

from throughline_domain import haptics


def test_the_capability_says_where_it_can_be_felt():
    """The field that stops an interface making a promise the hardware breaks."""
    reported = haptics.capability()

    assert set(reported) == {"available", "reason", "felt_where", "patterns"}
    if reported["available"]:
        assert "trackpad" in reported["felt_where"]
        # And says plainly that mid-air is not covered.
        assert "in the air" in reported["felt_where"]
    else:
        assert reported["reason"], "unavailable with no reason is unhelpful"


def test_an_unavailable_machine_says_so_rather_than_pretending(monkeypatch):
    """Most machines this ever runs on will have nothing. That is a fine answer
    and must not be dressed up as a working feature."""
    monkeypatch.setattr(haptics, "_looked", True)
    monkeypatch.setattr(haptics, "_performer", None)

    reported = haptics.capability()

    assert reported["available"] is False
    assert reported["patterns"] == []
    assert "no haptic actuator" in reported["reason"]


def test_a_tap_on_a_machine_with_no_actuator_is_false_not_an_error(monkeypatch):
    """Never raises, anywhere. This is called from an interaction path, and an
    exception here would take down the gesture it was confirming."""
    monkeypatch.setattr(haptics, "_looked", True)
    monkeypatch.setattr(haptics, "_performer", None)

    assert haptics.tap() is False


def test_a_performer_that_throws_is_survived(monkeypatch):
    class Angry:
        def performFeedbackPattern_performanceTime_(self, *_):
            raise RuntimeError("the trackpad is on fire")

    monkeypatch.setattr(haptics, "_looked", True)
    monkeypatch.setattr(haptics, "_performer", Angry())

    assert haptics.tap("generic") is False


def test_an_unknown_pattern_is_refused_rather_than_guessed(monkeypatch):
    """Guessing would send an arbitrary integer into a system API."""
    performed: list[int] = []

    class Recorder:
        def performFeedbackPattern_performanceTime_(self, pattern, _time):
            performed.append(pattern)

    monkeypatch.setattr(haptics, "_looked", True)
    monkeypatch.setattr(haptics, "_performer", Recorder())

    assert haptics.tap("earthquake") is False
    assert performed == []


def test_the_named_patterns_map_to_apples_identifiers(monkeypatch):
    """Named rather than numbered at the call site: `tap(1)` is a magic number
    nobody can check, and the three patterns mean quite different things."""
    performed: list[int] = []

    class Recorder:
        def performFeedbackPattern_performanceTime_(self, pattern, time):
            performed.append((pattern, time))

    monkeypatch.setattr(haptics, "_looked", True)
    monkeypatch.setattr(haptics, "_performer", Recorder())

    assert haptics.tap("alignment") is True
    # Apple's NSHapticFeedbackPatternAlignment, and "default" performance time —
    # asking for "now" fires before the thing being confirmed has been drawn.
    assert performed == [(1, 0)]


def test_the_lookup_happens_once(monkeypatch):
    """Importing AppKit is not free, and this is on an interaction path."""
    monkeypatch.setattr(haptics, "_looked", False)
    monkeypatch.setattr(haptics, "_performer", None)

    haptics.capability()
    assert haptics._looked is True

    # A second call must not repeat the import attempt.
    monkeypatch.setattr(haptics, "_performer", "sentinel")
    assert haptics._lookup() == "sentinel"
