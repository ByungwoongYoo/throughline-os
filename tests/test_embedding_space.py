"""Projecting a corpus to three dimensions without lying about it.

A projection always *looks* like structure. Three components of a 256-dimension
space carrying 60% of the variance and three carrying 6% produce pictures that
are visually indistinguishable, and only one of them means anything. That makes
this the easiest place in the product to mislead somebody, so most of these
tests are about what the projection refuses to do and what it insists on
reporting.
"""

from __future__ import annotations

import math

import pytest
from throughline_domain import embedding_space
from throughline_domain.ids import new_id


def _source(cur, project, title="A paper"):
    source_id = new_id("src")
    cur.execute(
        "INSERT INTO sources(id, project_id, source_type, title, "
        "ingestion_status) VALUES (%s, %s, 'paper', %s, 'ready')",
        (source_id, project, title))
    return source_id


def _passage(cur, project, source, *, ordinal, vector, model="test-embed",
             section="Methods"):
    passage_id = new_id("psg")
    cur.execute(
        "INSERT INTO passages(id, project_id, source_id, ordinal, content, "
        "section) VALUES (%s, %s, %s, %s, %s, %s)",
        (passage_id, project, source, ordinal, f"Passage {ordinal}", section))
    literal = "[" + ",".join(str(float(v)) for v in vector) + "]"
    cur.execute(
        "INSERT INTO passage_embeddings(passage_id, project_id, model, "
        "dimension, embedding) VALUES (%s, %s, %s, %s, %s::vector)",
        (passage_id, project, model, len(vector), literal))
    return passage_id


def _vector(seed: float, width: int = 256) -> list[float]:
    """A vector with dominant structure, the way a real embedding has.

    Two earlier fixtures were quietly degenerate and both made tests pass or
    fail for reasons unrelated to what they claimed. `sin(seed + i * 0.37)`
    spans a 2-dimensional subspace, so the third component explained 0.000 and
    pointed in a noise direction. Near-random values are the opposite failure:
    eight points in 256 dimensions have near-equal eigenvalues (0.178, 0.163,
    0.146 as measured), so the components are essentially arbitrary and rotate
    wildly on any change — which is PCA behaving correctly on structureless
    data, and useless for testing anything about orientation.

    Real embeddings have a few strong directions and a long tail. This places
    each point on three axes with clearly separated scales, plus small noise in
    the remaining dimensions.
    """
    def hashed(k: float) -> float:
        return math.sin(seed * 12.9898 + k * 78.233) * 43758.5453 % 1.0 - 0.5

    a, b, c = hashed(1) * 6, hashed(2) * 3, hashed(3) * 1.2
    out = [0.0] * width
    out[0], out[1], out[2] = a, b, c
    for i in range(3, width):
        out[i] = hashed(i) * 0.05
    return out


def _corpus(cur, project, n=8, model="test-embed"):
    source = _source(cur, project)
    return [_passage(cur, project, source, ordinal=i, vector=_vector(i * 1.7),
                     model=model) for i in range(n)]


# ---------------------------------------------------------------------------
# What it refuses
# ---------------------------------------------------------------------------

def test_too_few_passages_is_refused_rather_than_drawn(cur, project):
    """Three points in 256 dimensions lie exactly on a plane.

    The picture would show perfect structure, and that structure would be a
    property of arithmetic rather than of the corpus — which is the most
    convincing kind of wrong.
    """
    source = _source(cur, project)
    for i in range(3):
        _passage(cur, project, source, ordinal=i, vector=_vector(i))

    with pytest.raises(embedding_space.EmbeddingSpaceUnavailable) as caught:
        embedding_space.project(cur, project)

    assert "at least 4" in str(caught.value).lower()


def test_two_models_are_never_projected_together(cur, project):
    """The schema anticipated this in a comment; this is where it means something.

    Two models' vectors share a dimension count and nothing else. Projected
    together they separate cleanly — and the separation is an artefact of which
    model ran, presented as a property of the corpus.
    """
    source = _source(cur, project)
    for i in range(4):
        _passage(cur, project, source, ordinal=i, vector=_vector(i),
                 model="model-a")
    for i in range(4, 8):
        _passage(cur, project, source, ordinal=i, vector=_vector(i),
                 model="model-b")

    with pytest.raises(embedding_space.EmbeddingSpaceUnavailable) as caught:
        embedding_space.project(cur, project)

    message = str(caught.value)
    assert "model-a" in message and "model-b" in message
    # Says what to do, not merely what is wrong.
    assert "re-embed" in message.lower()


def test_identical_embeddings_are_refused_with_the_likely_cause(cur, project):
    """Zero variance is almost always a broken embedding step rather than a
    corpus of identical texts, and saying so saves an afternoon."""
    source = _source(cur, project)
    for i in range(6):
        _passage(cur, project, source, ordinal=i, vector=[0.5] * 256)

    with pytest.raises(embedding_space.EmbeddingSpaceUnavailable) as caught:
        embedding_space.project(cur, project)

    assert "did not run properly" in str(caught.value)


def test_an_empty_project_is_refused(cur, project):
    with pytest.raises(embedding_space.EmbeddingSpaceUnavailable):
        embedding_space.project(cur, project)


# ---------------------------------------------------------------------------
# What it reports
# ---------------------------------------------------------------------------

def test_explained_variance_travels_with_the_coordinates(cur, project):
    """Not optional, and not available on request.

    Three components carrying 60% and three carrying 6% look identical on
    screen. A reader with no number in front of them cannot tell which they are
    looking at, so the number is part of the result rather than a separate call
    somebody might not make.
    """
    _corpus(cur, project, 10)

    result = embedding_space.project(cur, project)

    assert len(result["explained_variance"]) == 3
    assert 0 < result["explained_total"] <= 1
    # Components come out in descending order of variance, which is what makes
    # "the first axis is the main one" a true statement about the picture.
    assert result["explained_variance"] == sorted(
        result["explained_variance"], reverse=True)


def test_it_reports_the_model_and_dimension_it_projected_from(cur, project):
    """A 3D scatter from 256 dimensions and one from 8 are different claims."""
    _corpus(cur, project, 6)

    result = embedding_space.project(cur, project)

    assert result["model"] == "test-embed"
    assert result["dimension"] == 256


def test_a_point_can_be_walked_back_to_its_source(cur, project):
    """A dot nobody can identify is a decoration. Each carries the passage it
    is, the source it came from, and where in that source it sits."""
    _corpus(cur, project, 5)

    point = embedding_space.project(cur, project)["points"][0]

    assert point["id"].startswith("psg_")
    assert point["source_id"].startswith("src_")
    assert "A paper" in point["label"]
    assert "Methods" in point["label"]


def test_truncation_is_reported_rather_than_silent(cur, project):
    """A researcher looking at 2,000 of 5,000 passages and believing they are
    looking at all of them draws conclusions about a corpus they have not seen.
    """
    _corpus(cur, project, 8)

    result = embedding_space.project(cur, project, limit=5)

    assert result["truncated"] is True
    assert len(result["points"]) == 5


def test_nothing_is_truncated_when_everything_fits(cur, project):
    _corpus(cur, project, 6)

    assert embedding_space.project(cur, project)["truncated"] is False


# ---------------------------------------------------------------------------
# Stability
# ---------------------------------------------------------------------------

def test_the_orientation_does_not_depend_on_the_order_rows_arrive_in(cur, project):
    """What the sign convention actually buys, stated honestly.

    SVD fixes components only up to sign, and which sign a given BLAS returns
    can depend on the order of the rows it was handed. Without a convention the
    same corpus mirrors when rows come back in a different order — from a
    changed query plan, a rewritten heap, or another machine.

    What the convention does *not* buy — and an earlier version of this file
    claimed it did — is that the view survives the corpus changing. When
    eigenvalues are close the components genuinely rotate, and that is PCA
    working rather than a bug. Only reproducibility for the same set of points
    is promised, so only that is tested.
    """
    source = _source(cur, project)
    vectors = [_vector(i * 1.7) for i in range(9)]
    for i, vector in enumerate(vectors):
        _passage(cur, project, source, ordinal=i, vector=vector)

    first = {p["id"]: p for p in embedding_space.project(cur, project)["points"]}

    # Rewrite every row, which moves them all to the end of the heap in a new
    # order — the same points, arriving differently.
    cur.execute("UPDATE passage_embeddings SET dimension = dimension "
                "WHERE project_id = %s", (project,))

    second = {p["id"]: p for p in embedding_space.project(cur, project)["points"]}

    assert set(first) == set(second)
    for pid in first:
        for axis in ("x", "y", "z"):
            assert first[pid][axis] == pytest.approx(second[pid][axis], abs=1e-9), (
                f"{axis} moved for {pid} when the rows were reordered")


def test_truncation_takes_the_same_passages_after_the_table_changes(cur, project):
    """An unordered LIMIT shows a different subset once rows move on disk.

    The first version compared two calls on an untouched table and passed with
    the ORDER BY removed — PostgreSQL returns a small unmodified table in
    physical order, so it was asserting that nothing had happened. Updating rows
    writes new tuple versions and moves them to the end of the heap, which is
    exactly what a real corpus does as it is worked on.
    """
    _corpus(cur, project, 12)
    first = [p["id"] for p in embedding_space.project(cur, project, limit=6)["points"]]

    # Rewrite the earliest rows, moving them to the end of the heap.
    cur.execute(
        "UPDATE passage_embeddings SET dimension = dimension "
        "WHERE passage_id IN (SELECT passage_id FROM passage_embeddings "
        "                     WHERE project_id = %s ORDER BY passage_id LIMIT 4)",
        (project,))

    second = [p["id"] for p in embedding_space.project(cur, project, limit=6)["points"]]

    assert first == second


def test_the_projection_is_centred_on_the_corpus(cur, project):
    """PCA coordinates are offsets from the mean, so a cloud with no centring
    would sit off in a corner and waste most of the view."""
    _corpus(cur, project, 10)

    points = embedding_space.project(cur, project)["points"]

    for axis in ("x", "y", "z"):
        mean = sum(p[axis] for p in points) / len(points)
        assert mean == pytest.approx(0, abs=1e-9)


def test_a_project_sees_only_its_own_passages(cur, project):
    """Isolation, which everything else in this system also promises."""
    _corpus(cur, project, 6)

    cur.execute(
        "INSERT INTO users(id, email, display_name, password_hash, password_salt) "
        "VALUES ('usr_other', 'other@test.local', 'Other', 'x', 'y')")
    cur.execute("INSERT INTO projects(id, name, owner_user_id) "
                "VALUES ('prj_other', 'Other', 'usr_other')")
    other_source = _source(cur, "prj_other", title="Someone else's paper")
    for i in range(6):
        _passage(cur, "prj_other", other_source, ordinal=i, vector=_vector(i + 99))

    result = embedding_space.project(cur, project)

    assert len(result["points"]) == 6
    assert all("Someone else" not in p["label"] for p in result["points"])
