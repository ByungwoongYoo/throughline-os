"""The corpus in three dimensions, with the loss stated rather than hidden.

Passages are embedded in 256 dimensions. A researcher cannot look at 256
dimensions, so a 3D view is genuinely useful — where does this corpus separate,
which sources sit together, is there structure worth investigating. It is also
the single easiest place in this product to mislead somebody, because a
projection always *looks* like structure whether or not it contains any.

Three commitments follow, and each one rules out the shorter implementation.

**Explained variance is returned, always, and is not optional to display.**
Three components of a 256-dimension space might carry 60% of the variance or
6%. At 6% the picture is close to noise arranged prettily, and a reader with no
number in front of them cannot tell the difference — the two look identical. So
the number travels with the coordinates rather than being available on request.

**The projection is reproducible for the same points.** SVD fixes components
only up to sign, and which sign comes back can depend on the order the rows
arrived in — so the same corpus mirrors when a query plan changes or the heap is
rewritten. Nothing would be wrong, and a researcher would see their data flip
and reasonably conclude something had changed. The orientation is anchored to
the data instead. This is deliberately a narrower promise than "the view is
stable": when the leading eigenvalues are close the components genuinely rotate
as the corpus changes, which is PCA working rather than failing, and no
convention can pin down an orientation the data does not determine.

**Vectors from different models are never mixed.** The schema says so already —
"the model name is stored so a re-embedding under a different model is
detectable rather than silently mixed" — and this is where that comment either
means something or does not. Two models' vectors share a dimension count and
nothing else; projecting them together produces separation that is an artefact
of which model ran, presented as a property of the corpus.
"""

from __future__ import annotations

from typing import Any

#: More than a researcher can read, and enough that the shape is real. Beyond
#: this the SVD cost grows without the picture improving: a scatter of 20,000
#: points is a silhouette, not a plot.
MAX_POINTS = 2000

#: Below this, a projection is not a summary of anything. Three points in 256
#: dimensions lie exactly on a plane, so the picture would show perfect
#: structure that is a property of arithmetic rather than of the corpus.
MIN_POINTS = 4


class EmbeddingSpaceUnavailable(RuntimeError):
    """There is nothing here that can honestly be projected."""


def _parse(vector: Any) -> list[float]:
    """pgvector comes back as text like '[0.1,0.2,…]' unless a codec is registered."""
    if isinstance(vector, (list, tuple)):
        return [float(v) for v in vector]
    text = str(vector).strip()
    if text.startswith("[") and text.endswith("]"):
        text = text[1:-1]
    if not text:
        return []
    return [float(part) for part in text.split(",")]


def project(cur, project_id: str, *, limit: int = MAX_POINTS) -> dict[str, Any]:
    """Project this project's passage embeddings into three dimensions.

    Raises `EmbeddingSpaceUnavailable` rather than returning an empty or
    degenerate result, because a chart drawn from one is indistinguishable from
    a chart of a corpus with no structure.
    """
    import numpy as np

    cur.execute(
        """
        SELECT e.passage_id, e.embedding, e.model, e.dimension,
               p.source_id, p.page, p.section, p.content,
               s.title AS source_title
        FROM passage_embeddings e
        JOIN passages p ON p.id = e.passage_id
        LEFT JOIN sources s ON s.id = p.source_id
        WHERE e.project_id = %s
        -- Ordered so the same corpus yields the same sample when truncated.
        -- Without this, a second look at a large project would show a different
        -- subset and read as the data having changed.
        ORDER BY e.passage_id
        LIMIT %s
        """,
        (project_id, limit + 1))
    rows = cur.fetchall()

    if len(rows) < MIN_POINTS:
        raise EmbeddingSpaceUnavailable(
            f"This project has {len(rows)} embedded passage(s). At least "
            f"{MIN_POINTS} are needed before a projection means anything — "
            "below that the picture is a property of the arithmetic rather "
            "than of the corpus.")

    truncated = len(rows) > limit
    rows = rows[:limit]

    models = {row["model"] for row in rows}
    if len(models) > 1:
        # The schema anticipated this explicitly. Two models' vectors share a
        # dimension count and nothing else, and projecting them together
        # produces a clean separation that is an artefact of which model ran.
        raise EmbeddingSpaceUnavailable(
            "This project's passages are embedded under more than one model "
            f"({', '.join(sorted(models))}). Their vectors are not comparable, "
            "so a projection of them together would show separation caused by "
            "the model rather than by the text. Re-embed the corpus under one "
            "model first.")

    vectors = [_parse(row["embedding"]) for row in rows]
    widths = {len(v) for v in vectors}
    if len(widths) > 1:
        raise EmbeddingSpaceUnavailable(
            "Stored vectors have differing widths, so they do not describe one "
            "space. This is a corpus that needs re-embedding.")

    matrix = np.asarray(vectors, dtype=float)
    if matrix.shape[1] < 3:
        raise EmbeddingSpaceUnavailable(
            "Embeddings of fewer than three dimensions cannot be shown in "
            "three.")

    centred = matrix - matrix.mean(axis=0)
    # Total variance before the projection, which is what the ratio is *of*.
    total = float((centred ** 2).sum())
    if total <= 0:
        raise EmbeddingSpaceUnavailable(
            "Every passage in this project has the same embedding, so there is "
            "no structure to project. That usually means the embedding step "
            "did not run properly rather than that the texts are identical.")

    _, singular, components = np.linalg.svd(centred, full_matrices=False)
    components = components[:3]

    coordinates = centred @ components.T

    # Deterministic orientation, for the same set of points.
    #
    # SVD fixes each component only up to sign, and which sign comes back can
    # depend on the order the rows were handed to it — so the same corpus
    # mirrors when a query plan changes or the heap is rewritten. Anchoring on
    # the data rather than on the loadings fixes that: the point furthest along
    # each axis is made positive, and it is a property of the corpus's shape
    # rather than of the arithmetic.
    #
    # What this does **not** promise, and an earlier version of this comment
    # wrongly did, is that the view survives the corpus *changing*. When the
    # leading eigenvalues are close together the components genuinely rotate —
    # measured at |cos| 0.5 between old and new on eight points of unstructured
    # data — and that is PCA working correctly, not a sign artefact. No
    # convention can pin an orientation the data does not determine.
    #
    # **No test in this suite can fail if this block is deleted**, and that is
    # recorded rather than hidden. The `ORDER BY` above already hands SVD an
    # identical matrix every time, and numpy is deterministic for identical
    # input, so on one machine the pin is redundant. What it covers is two
    # machines: LAPACK implementations differ, and Accelerate and OpenBLAS can
    # return opposite signs for the same corpus — so a figure exported on a Mac
    # and one exported on a Linux server would be mirror images. That is
    # unreachable from here, which makes it a known gap in the evidence rather
    # than a covered case.
    for index in range(coordinates.shape[1]):
        column = coordinates[:, index]
        furthest = int(np.argmax(np.abs(column)))
        if column[furthest] < 0:
            coordinates[:, index] = -column
            components[index] = -components[index]
    explained = [float((singular[i] ** 2) / total)
                 for i in range(min(3, len(singular)))]

    points = []
    for row, position in zip(rows, coordinates):
        points.append({
            "id": row["passage_id"],
            # Where the passage is, not what it says. A label is read at a
            # glance beside a dot; a sentence of content would be unreadable
            # there and is available by opening the source.
            "label": _label(row),
            "source_id": row["source_id"],
            "x": float(position[0]),
            "y": float(position[1]),
            "z": float(position[2]) if len(position) > 2 else 0.0,
        })

    return {
        "points": points,
        "model": next(iter(models)),
        "dimension": int(matrix.shape[1]),
        # Per component and in total: a reader needs to know both that the first
        # axis carries most of it and how much the whole picture is worth.
        "explained_variance": explained,
        "explained_total": sum(explained),
        "truncated": truncated,
        "total_available": len(rows) + (1 if truncated else 0),
    }


def _label(row: dict[str, Any]) -> str:
    title = (row.get("source_title") or "Untitled source").strip()
    where = row.get("section") or (
        f"p. {row['page']}" if row.get("page") is not None else "")
    return f"{title} — {where}" if where else title


__all__ = ["MAX_POINTS", "MIN_POINTS", "EmbeddingSpaceUnavailable", "project"]
