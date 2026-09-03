"""
D058 — the macOS launcher told people to do something Apple removed.

The warning read: "Unsigned, so the first time macOS will refuse it.
Right-click the file and choose Open, once." That was true for years and is
not true now. D058 quotes Apple's own macOS 15 release note: *"users will no
longer be able to Control-click to override Gatekeeper... They will need to
visit System Settings > Privacy & Security."*

So a researcher on a current Mac followed the instruction, it did nothing, and
the reasonable conclusion is that the download is broken. The instruction
being *stale* is worse than it being absent: absent, they search; wrong, they
trust it and stop.

The rest of D058 stays open and cannot be closed from here — a `.command`
cannot be notarised at all, and the fix is a signed `.pkg`, which needs an
Apple Developer Program membership. What can be fixed without paying Apple is
telling the truth about what the researcher must actually do.
"""

from __future__ import annotations

import pytest
from throughline_domain.launchers import LAUNCHERS


class TestTheInstructionMatchesTheOperatingSystem:
    def test_it_no_longer_tells_a_mac_user_to_right_click(self):
        warning = LAUNCHERS["darwin"]["warning"]
        assert "right-click" not in warning.lower(), (
            "Apple removed the Control-click override in macOS 15; this "
            "instruction fails on any current Mac")
        assert "control-click" not in warning.lower()

    def test_it_names_where_the_override_actually_lives(self):
        """System Settings > Privacy & Security, which is where it moved."""
        warning = LAUNCHERS["darwin"]["warning"]
        assert "Privacy" in warning and "Security" in warning
        assert "System Settings" in warning

    def test_it_offers_the_route_that_does_not_meet_gatekeeper_at_all(self):
        """
        `curl` does not set the quarantine attribute, so a download fetched
        that way is never checked. D058 records that this is corroborated
        everywhere and stated by Apple nowhere — a working route, not a
        durable one — so it is offered as an alternative rather than as the
        blessed path.
        """
        warning = LAUNCHERS["darwin"]["warning"]
        assert "Terminal" in warning or "terminal" in warning

    def test_windows_is_unchanged(self):
        """SmartScreen still works the way it always has; only macOS moved."""
        warning = LAUNCHERS["win32"]["warning"]
        assert "More info" in warning and "Run anyway" in warning

    def test_every_platform_still_warns_before_the_click(self):
        """
        The reason this text exists: a researcher who meets a security refusal
        unprepared concludes they downloaded something dangerous and stops,
        which is the correct instinct.
        """
        for platform, entry in LAUNCHERS.items():
            if platform == "linux":
                continue      # no signing gate to warn about
            assert entry["warning"].strip(), platform
