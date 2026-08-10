"""
Image ↔ image — figure similarity.

Two things are being tested, and the second matters more than the first.

**That it detects real reuse** — identical files, re-saved copies, rotations and
flips. A duplicate-detection feature that misses a flipped panel misses the
commonest case.

**That it never accuses anyone.** The exposure from a false accusation is
asymmetric and severe: a wrong "unrelated" costs a reviewer nothing, a wrong
"fabricated" can end a career. So there are explicit tests that the forbidden
vocabulary never appears in any output, on any path, including the positive
ones.
"""

from __future__ import annotations

import pytest
from throughline_domain import images

#: Words this feature must never produce, whatever it finds. Checked against
#: every field of every verdict, because the guarantee is worth nothing if it
#: only holds for the sentence and not the guidance.
FORBIDDEN = ("manipulat", "fabricat", "fraud", "falsif", "misconduct",
             "doctored", "faked")


@pytest.fixture()
def figures(tmp_path):
    """A small set of synthetic panels with known relationships."""
    from PIL import Image, ImageDraw
    import numpy as np

    rng = np.random.default_rng(7)

    def noise(name, seed_shift=0):
        data = (rng.random((160, 160)) * 255).astype("uint8")
        image = Image.fromarray(data, mode="L")
        draw = ImageDraw.Draw(image)
        draw.rectangle([40 + seed_shift, 40, 110 + seed_shift, 110], fill=20)
        path = tmp_path / name
        image.save(path)
        return str(path)

    original = noise("original.png")

    # A re-save: same picture, different bytes.
    resaved = str(tmp_path / "resaved.png")
    Image.open(original).save(resaved)

    rotated = str(tmp_path / "rotated.png")
    Image.open(original).transpose(Image.Transpose.ROTATE_90).save(rotated)

    flipped = str(tmp_path / "flipped.png")
    Image.open(original).transpose(Image.Transpose.FLIP_LEFT_RIGHT).save(flipped)

    different = noise("different.png", seed_shift=30)

    tiny = str(tmp_path / "tiny.png")
    Image.open(original).resize((32, 32)).save(tiny)

    return {"original": original, "resaved": resaved, "rotated": rotated,
            "flipped": flipped, "different": different, "tiny": tiny}


def _image(path, title, content_hash=None):
    return {"path": path, "title": title, "content_hash": content_hash,
            "id": title}


def _assertive_text(verdict) -> str:
    """
    Everything the verdict *asserts*.

    `language_note` is deliberately excluded: it is the sentence that promises
    the system will never say "manipulated or fabricated", so it necessarily
    contains those words. Scanning it would make the guarantee impossible to
    state — the check is on what the system claims, not on its disclaimer.
    """
    parts = [verdict.get("sentence", ""), verdict.get("guidance", "")]
    for key in ("caveats", "remedies", "still_possible"):
        parts.extend(verdict.get(key) or [])
    return " ".join(parts).lower()


# ---------------------------------------------------------------------------
# The rule that governs the whole feature
# ---------------------------------------------------------------------------

def test_no_verdict_ever_asserts_misconduct(figures):
    """
    Checked on every path, including the ones that find something. A guarantee
    that only holds when nothing is detected is not a guarantee.
    """
    pairs = [
        (figures["original"], figures["original"]),
        (figures["original"], figures["resaved"]),
        (figures["original"], figures["rotated"]),
        (figures["original"], figures["flipped"]),
        (figures["original"], figures["different"]),
        (figures["original"], figures["tiny"]),
    ]
    for left, right in pairs:
        verdict = images.compare(_image(left, "A"), _image(right, "B"))
        text = _assertive_text(verdict)
        for word in FORBIDDEN:
            assert word not in text, f"{verdict['outcome']} said {word!r}"


def test_every_positive_outcome_routes_to_needs_review(figures):
    """
    A duplicate is never rendered as a contradiction or a failure. The system is
    putting a pair in front of a person, not reaching a conclusion.
    """
    for right in (figures["resaved"], figures["rotated"], figures["flipped"]):
        verdict = images.compare(_image(figures["original"], "A"),
                                 _image(right, "B"))
        assert verdict["family"] == "needs_review", verdict["outcome"]


def test_the_language_limit_is_stated_on_every_result(figures):
    verdict = images.compare(_image(figures["original"], "A"),
                             _image(figures["different"], "B"))
    assert "never asserts" in verdict["language_note"]


# ---------------------------------------------------------------------------
# Detection
# ---------------------------------------------------------------------------

def test_identical_bytes_are_recognised(figures):
    verdict = images.compare(
        _image(figures["original"], "A", content_hash="abc"),
        _image(figures["resaved"], "B", content_hash="abc"))

    assert verdict["outcome"] == "I1"
    assert "legitimate reuse" in verdict["guidance"]


def test_a_resaved_copy_is_recognised_without_a_hash(figures):
    """Different bytes, same picture — the case a checksum misses entirely."""
    verdict = images.compare(_image(figures["original"], "A"),
                             _image(figures["resaved"], "B"))

    assert verdict["outcome"] == "I2"


def test_a_rotated_panel_is_recognised(figures):
    """
    The commonest kind of reuse, and invisible to any hash that does not try the
    transforms — a rotation changes every bit of a perceptual hash.
    """
    verdict = images.compare(_image(figures["original"], "A"),
                             _image(figures["rotated"], "B"))

    assert verdict["outcome"] == "I3"
    assert "rotated" in verdict["sentence"]


def test_a_flipped_panel_is_recognised(figures):
    verdict = images.compare(_image(figures["original"], "A"),
                             _image(figures["flipped"], "B"))

    assert verdict["outcome"] == "I3"


def test_unrelated_images_are_reported_as_unrelated(figures):
    verdict = images.compare(_image(figures["original"], "A"),
                             _image(figures["different"], "B"))

    assert verdict["outcome"] in ("I7", "I8")
    assert verdict["family"] in ("supported", "qualified")


def test_a_too_small_image_is_undetermined_rather_than_guessed(figures):
    """
    Below the threshold a hash compares compression artifacts. A verdict there
    would be noise dressed as analysis.
    """
    verdict = images.compare(_image(figures["original"], "A"),
                             _image(figures["tiny"], "B"))

    assert verdict["outcome"] == "I9"
    assert verdict["family"] == "undetermined"


def test_an_unreadable_file_is_refused(tmp_path):
    broken = tmp_path / "broken.png"
    broken.write_text("this is not an image")

    with pytest.raises(images.ImageError, match="could not be read"):
        images.compare(_image(str(broken), "A"), _image(str(broken), "B"))


# ---------------------------------------------------------------------------
# Several at once
# ---------------------------------------------------------------------------

def test_comparing_many_reports_the_denominator(figures):
    """
    Five images is ten comparisons. One flagged pair out of ten is a prompt;
    without the denominator it reads as a finding.
    """
    result = images.compare_many([
        _image(figures["original"], "original"),
        _image(figures["resaved"], "resaved"),
        _image(figures["rotated"], "rotated"),
        _image(figures["flipped"], "flipped"),
        _image(figures["different"], "different"),
    ])

    assert result["multiplicity"]["images"] == 5
    assert result["multiplicity"]["comparisons"] == 10
    assert "not remarkable on its own" in result["multiplicity"]["note"]


def test_comparing_many_surfaces_the_reused_panels(figures):
    result = images.compare_many([
        _image(figures["original"], "original"),
        _image(figures["resaved"], "resaved"),
        _image(figures["different"], "different"),
    ])

    flagged = {(p["left"], p["right"]) for p in result["flagged"]}
    assert ("original", "resaved") in flagged


def test_the_limits_of_pixel_comparison_are_stated(figures):
    """
    Keypoint matching added shared-region detection, so the stated limits
    changed with it — a limits note that goes stale is worse than none, because
    it understates a real capability while sounding careful.

    What remains true: it cannot say whether two different photographs show the
    same specimen, and it cannot read what a figure means.
    """
    result = images.compare_many([
        _image(figures["original"], "A"), _image(figures["different"], "B")])

    assert "same specimen" in result["limits"]
    assert "vision model" in result["limits"]


def test_which_checks_actually_ran_is_reported(figures):
    """
    §123 — OpenCV absent means shared-region detection did not run, and a panel
    spliced into part of another figure would not be found. Silence there would
    read as "nothing to find".
    """
    result = images.compare_many([
        _image(figures["original"], "A"), _image(figures["different"], "B")])
    checks = result["checks_run"]

    assert checks["perceptual_hash"] is True
    assert checks["rigid_transforms"] is True
    assert isinstance(checks["shared_region"], bool)
    if not checks["shared_region"]:
        assert "spliced" in checks["note"]


def test_a_shared_region_is_found_between_a_panel_and_a_composite(tmp_path):
    """
    The case a whole-image hash cannot see by construction: one panel pasted
    into the corner of a larger figure. Every bit of a global hash differs while
    a real region is shared.
    """
    pytest.importorskip("cv2")
    from PIL import Image
    import numpy as np

    rng = np.random.default_rng(11)
    panel = Image.fromarray(
        (rng.random((120, 120)) * 255).astype("uint8"), mode="L")
    panel_path = tmp_path / "panel.png"
    panel.save(panel_path)

    composite = Image.fromarray(
        (rng.random((300, 300)) * 255).astype("uint8"), mode="L")
    composite.paste(panel, (150, 20))
    composite_path = tmp_path / "composite.png"
    composite.save(composite_path)

    found = images.shared_region(str(panel_path), str(composite_path))
    assert found is not None, "a pasted panel should be found"
    assert found["inliers"] >= images.MIN_MATCHES


def test_one_image_is_not_a_comparison(figures):
    with pytest.raises(images.ImageError, match="at least two"):
        images.compare_many([_image(figures["original"], "A")])


def test_too_many_images_is_refused(figures):
    many = [_image(figures["original"], f"P{i}") for i in range(21)]
    with pytest.raises(images.ImageError, match="at most"):
        images.compare_many(many)


# ---------------------------------------------------------------------------
# The hashes themselves
# ---------------------------------------------------------------------------

def test_a_hash_is_stable_for_the_same_image(figures):
    assert images.difference_hash(figures["original"]) \
        == images.difference_hash(figures["original"])


def test_hamming_distance_is_zero_for_identical_hashes():
    assert images.hamming(0b1010, 0b1010) == 0
    assert images.hamming(0b1010, 0b1011) == 1
