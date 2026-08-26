"""The landing page's animation clock, and why it must not count frames.

**Reported as "somehow the frontend degraded, it is not smooth, the motion is
reduced and it appears static."** Three descriptions of one defect. The render
loop advanced its clock with `this.t += 0.016 * speed` — sixty frames a second
written as a constant — so on any machine that could not sustain 60fps the
animation clock ran slow in exact proportion. Measured at ~50fps it advanced at
**83% of real time**; at 30fps it would be 48%, at 20fps 32%. The black hole
really was spinning slower, which is why the report was about motion rather than
about frame rate.

The failure is invisible to the person who wrote it, because it only appears on
hardware weaker than theirs — the same shape as `bootstrap.sh` installing four
of nine packages and passing on the machine it was written on.

These are static checks on the choreography source. The behavioural measurement
that produced the numbers above needs a browser and lives in the deploy notes;
what is pinned here is the property that made it wrong, so it cannot come back.
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / "frontend" / "main.template.html"


def loop_body() -> str:
    """The render loop with its comments stripped.

    Stripping them is not incidental. The loop *explains* the old fixed-frame
    clock by quoting it, and a check that cannot tell a comment from a statement
    would forbid the code from recording why it is the way it is — which is the
    one thing that stops the constant being put back by someone who never heard
    about this.
    """
    page = TEMPLATE.read_text()
    start = page.index("const loop = () => {")
    body = page[start:page.index("this.raf = requestAnimationFrame(loop);", start)]
    return "\n".join(line for line in body.splitlines()
                     if not line.strip().startswith("//"))


def test_the_animation_clock_uses_elapsed_time_not_an_assumed_frame():
    """The defect itself. `0.016` is 60fps hardcoded, and it is only correct on
    a machine fast enough not to need the code to be correct."""
    body = loop_body()
    assert "this.t += dt * speed" in body, (
        "the animation clock no longer advances by measured elapsed time")
    assert "0.016" not in body, (
        "a fixed 60fps frame time is back in the render loop; on slower "
        "hardware this slows the animation itself rather than the frame rate")


def test_the_elapsed_time_is_clamped_but_not_below_a_usable_frame_rate():
    """Two failure modes, opposite directions. Unclamped, a backgrounded tab
    returns a delta of minutes and teleports the animation on return. Clamped
    too tightly, the clock slows again on exactly the weak machines the fix is
    for — a 0.05 clamp silently reimposes a 20fps ceiling."""
    body = loop_body()
    found = re.search(r"const dt = Math\.min\(([\d.]+),", body)
    assert found, "the frame delta is no longer clamped at all"
    clamp = float(found.group(1))
    assert clamp >= 0.1, (
        f"dt is clamped to {clamp}s, which caps the clock at {1 / clamp:.0f}fps "
        "and slows time on any machine below that")
    assert clamp <= 0.25, (
        f"dt is clamped to {clamp}s; returning to a backgrounded tab would jump "
        "the animation by that much in a single frame")


def test_the_per_frame_eases_are_corrected_for_frame_rate():
    """A fixed fraction per frame is a different curve at every frame rate, so
    the pointer parallax drifted lazier on slow machines for the same reason the
    clock did."""
    body = loop_body()
    assert "Math.pow(0.94, dt * 60)" in body, (
        "the per-frame easing is no longer corrected for elapsed time")
    assert re.search(r"\*\s*0\.06;", body) is None, (
        "a raw per-frame ease constant is back in the loop")


def test_quality_adapts_on_a_clock_rather_than_a_frame_count():
    """**Counting frames to notice that frames are slow is circular.** The first
    version of this waited for thirty consecutive slow frames, which at 2fps is
    fifteen seconds of stuttering before anything is done — measured, and it is
    why the counter is a timer now."""
    body = loop_body()
    assert "this.slowTime += dt" in body and "this.fastTime += dt" in body, (
        "quality adaptation is counting frames again")
    assert "slowFrames" not in body and "fastFrames" not in body


def test_quality_recovers_and_has_a_floor():
    """It must climb back when the machine can afford it, or one slow moment
    permanently degrades the page. And it must stop somewhere, or a struggling
    machine ends up rendering a blurred smear rather than a slower one."""
    body = loop_body()
    assert "this.quality = Math.min(1, this.quality" in body, (
        "quality never climbs back, so a transient stall is permanent")
    found = re.search(r"this\.quality = Math\.max\(([\d.]+),", body)
    assert found, "quality has no floor"
    assert float(found.group(1)) >= 0.3, (
        f"the resolution floor is {found.group(1)}, low enough to look broken")


def test_the_renderer_actually_reads_the_quality_it_computes():
    """The loop can adapt all it likes; if `renderGL` ignores it, nothing gets
    cheaper. This is the connection that makes the adaptation real."""
    page = TEMPLATE.read_text()
    render = page[page.index("renderGL(t, cam, boost, flare, starOff)"):]
    render = render[:render.index("componentDidMount()")]
    assert "this.quality" in render, (
        "renderGL does not use this.quality, so lowering it changes nothing")
