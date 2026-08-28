"""Visuals in the research model — recommendation, critique, render, provenance.

this rule is the whole point of this module: a figure is created *from* an analysis
run and linked to it by lineage, so a chart on a slide can always be resolved
back to the computation and the dataset underneath.

 is enforced here too. A natural-language edit that changes what the figure
*means* — different rows, different variables — is not a re-plot; it requires a
new analysis. `apply_edit` refuses those rather than redrawing and letting the
figure quietly disagree with its own statistics.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Sequence

from throughline_schemas.enums import LineageType, ObjectType
from throughline_visual import critic as visual_critic
from throughline_visual import labels as labels_module
from throughline_visual import prepare as visual_prepare
from throughline_visual import recommend as visual_recommend
from throughline_visual.labels import LabelBook
from throughline_visual.renderers import publication, web
from throughline_visual.spec import ResearchVisualSpec, VisualData

from .analysis import get_run
from .db import jsonb
from .events import audit, emit
from .ids import new_id
from .lineage import add_edge
from .objects import create_object
from .storage import storage_root


class VisualError(RuntimeError):
    pass


class EditRequiresRecomputation(VisualError):
    """ — "If a request changes the underlying analysis: rerun computation."."""


#: Spec fields whose change alters *what is being shown*, not how it looks.
#: Editing one of these means a different analysis, not a different drawing.
_DATA_BEARING_FIELDS = {"x", "y", "group", "facet", "filters", "aggregation",
                        "analysis_run_id", "dataset_version_id"}

#: Fields that only affect presentation and may be edited freely.
_PRESENTATION_FIELDS = {"title", "subtitle", "caption", "citations", "theme",
                        "uncertainty", "annotations", "interaction",
                        "animation_semantics", "visual_type", "category_labels"}


def spec_hash(spec: ResearchVisualSpec) -> str:
    payload = spec.model_dump(mode="json")
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


def variable_labels(cur, *, project_id: str, dataset_version_id: str) -> LabelBook:
    """What a reader should see instead of each raw column name.

    The recommender is deliberately database-free, so this is where the
    canonical variable layer is consulted: it already holds a `display_label`
    for exactly this purpose, and a figure that prints `resistance_pct` is
    ignoring data the project has already curated.

    The unit is the part worth being careful about. `canonical_unit` describes
    the harmonised quantity, but a figure plots the *column's* values, and an
    approved mapping may still record `transformation_required` — the numbers
    have not been converted just because the mapping exists. Labelling an axis
    with a unit the values are not in would be a worse failure than printing a
    raw name, so the column's own unit wins, and the canonical one is used only
    where the column declares none and no transformation stands between them.
    """
    cur.execute(
        """
        SELECT DISTINCT ON (dc.id)
               dc.name, dc.original_name, dc.unit AS column_unit,
               cv.display_label, cv.canonical_unit, vm.transformation_required
        FROM dataset_columns dc
        LEFT JOIN variable_mappings vm
               ON vm.dataset_column_id = dc.id
              AND vm.status = 'approved'
              AND vm.project_id = %s
        LEFT JOIN canonical_variables cv
               ON cv.id = vm.canonical_variable_id
        WHERE dc.dataset_version_id = %s
        -- One column can carry more than one approved mapping; take the most
        -- confident, and break ties by id so the label never depends on scan
        -- order. A figure that renamed itself between two runs of the same
        -- analysis would be its own kind of dishonesty.
        ORDER BY dc.id, vm.confidence DESC NULLS LAST, cv.id
        """,
        (project_id, dataset_version_id),
    )

    entries: dict[str, dict[str, Any]] = {}
    for row in cur.fetchall():
        canonical_label = (row["display_label"] or "").strip()
        header = (row["original_name"] or "").strip()
        column_unit = (row["column_unit"] or "").strip()
        canonical_unit = (row["canonical_unit"] or "").strip()
        transformed = bool((row["transformation_required"] or "").strip())

        unit = column_unit or (canonical_unit if not transformed else "")

        if canonical_label:
            label, source = canonical_label, labels_module.CANONICAL
        elif header and header != row["name"]:
            # The header the researcher typed. Not curated, but written by a
            # person for people, which the normalised key never was.
            label = labels_module.humanise(
                labels_module.strip_trailing_unit(header, unit))
            source = labels_module.DATASET_HEADER
        else:
            label, source = labels_module.humanise(row["name"]), labels_module.COLUMN_NAME

        entry = {"label": label, "unit": unit or None, "source": source}
        entries[row["name"]] = entry
        if header:
            # A spec may name either spelling; both must resolve.
            entries.setdefault(header, entry)

    return LabelBook(entries)


def recommend_for_run(
    cur, *, analysis_run_id: str, goal: str = "show the relationship",
    audience: str = "researcher",
) -> dict[str, Any]:
    """ — recommend a figure for a completed analysis."""
    run = get_run(cur, analysis_run_id)
    if not run:
        raise VisualError(f"Unknown analysis run: {analysis_run_id}")
    if run["status"] != "completed":
        raise VisualError(
            f"Analysis run {analysis_run_id} is {run['status']}; only a completed "
            "run has results to visualise."
        )
    version_ids = run["dataset_version_ids"] or []
    version_id = version_ids[0] if version_ids else None
    book = (
        variable_labels(cur, project_id=run["project_id"], dataset_version_id=version_id)
        if version_id else LabelBook()
    )
    return visual_recommend.recommend(
        analysis_run_id=analysis_run_id, method=run["method"],
        variables=run["variables"], result=run["result"] or {},
        dataset_version_id=version_id,
        goal=goal, audience=audience, labels=book,
    )


def create_visual(
    cur, *, project_id: str, spec: ResearchVisualSpec, actor: str,
    sample: dict[str, Sequence[Any]] | None = None,
    recommendation: dict[str, Any] | None = None,
    finding_id: str | None = None, autofix: bool = True,
) -> dict[str, Any]:
    """Prepare, critique and store a figure, with its lineage."""
    run = get_run(cur, spec.analysis_run_id)
    if not run:
        raise VisualError(f"Unknown analysis run: {spec.analysis_run_id}")
    if run["project_id"] != project_id:
        raise VisualError("The analysis run belongs to a different project.")

    result = run["result"] or {}
    data = visual_prepare.prepare(spec, analysis_result=result, sample=sample)
    report = visual_critic.critique(spec, data, analysis=result, autofix=autofix)
    spec = report.spec or spec

    visual_id = new_id("vis")
    object_id = create_object(
        cur, project_id=project_id, object_type=ObjectType.VISUALIZATION,
        title=spec.title or f"{spec.visual_type} figure", actor=actor,
        metadata={"visual_id": visual_id, "visual_type": str(spec.visual_type)},
    )
    # The figure visualises the analysis; the edge is what this rule rests on.
    if run["object_id"]:
        add_edge(cur, project_id=project_id, source_artifact_id=run["object_id"],
                 target_artifact_id=object_id, lineage_type=LineageType.VISUALIZES,
                 metadata={"visual_id": visual_id})

    cur.execute(
        """
        INSERT INTO visuals
            (id, project_id, object_id, analysis_run_id, finding_id, spec_version,
             visual_type, spec, spec_hash, data, recommendation, critique, publishable,
             created_by)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (visual_id, project_id, object_id, spec.analysis_run_id, finding_id,
         spec.spec_version, str(spec.visual_type), jsonb(spec.model_dump(mode="json")),
         spec_hash(spec), jsonb(data.model_dump(mode="json")),
         jsonb(_serialisable(recommendation or {})), jsonb(report.to_dict()),
         report.publishable, actor),
    )
    emit(cur, project_id=project_id, event_type="VisualizationCreated",
         payload={"visual_id": visual_id, "analysis_run_id": spec.analysis_run_id,
                  "publishable": report.publishable})
    audit(cur, project_id=project_id, actor=actor, action="create",
          object_type="visual", object_id=visual_id)

    return {"visual_id": visual_id, "object_id": object_id, "spec": spec,
            "data": data, "critique": report.to_dict(),
            "publishable": report.publishable}


def _serialisable(recommendation: dict[str, Any]) -> dict[str, Any]:
    payload = dict(recommendation)
    if isinstance(payload.get("spec"), ResearchVisualSpec):
        payload["spec"] = payload["spec"].model_dump(mode="json")
    payload["visual_type"] = str(payload.get("visual_type", ""))
    payload["alternatives"] = [
        {**a, "visual_type": str(a.get("visual_type", ""))}
        for a in payload.get("alternatives", [])
    ]
    return payload


def list_visuals(cur, project_id: str, limit: int = 100) -> list[dict[str, Any]]:
    """
    Every figure this project has made, newest first.

    Nothing listed them. A figure is created with its critique and a lineage
    edge back to the analysis it draws, and then could only be reached by
    somebody who had kept its id — so the record existed and the researcher
    could not see it. `idx_visuals_project` has been indexed on exactly this
    order since the table was written, for a query nobody had made.

    The spec is not returned: it is large, and a list wants a title and whether
    the figure passed the critic. Opening one loads the rest.
    """
    cur.execute(
        "SELECT id, visual_type, publishable, created_at, analysis_run_id, "
        "       finding_id, spec ->> 'title' AS title, "
        "       spec ->> 'caption' AS caption "
        "FROM visuals WHERE project_id = %s "
        "ORDER BY created_at DESC LIMIT %s",
        (project_id, limit))
    return [dict(row) for row in cur.fetchall()]


def load_visual(cur, visual_id: str) -> dict[str, Any]:
    cur.execute("SELECT * FROM visuals WHERE id = %s", (visual_id,))
    row = cur.fetchone()
    if not row:
        raise VisualError(f"Unknown visual: {visual_id}")
    return row


def render_visual(cur, *, visual_id: str, fmt: str,
                  height_px: int | None = None) -> dict[str, Any]:
    """
    Render a stored figure. Publication formats plus the web spec, one source.

    `height_px` gives an exact pixel height for a raster export; the width
    follows from the figure's own proportions rather than from a video frame.
    It is refused for a vector format by the renderer, because an SVG has no
    pixel height and a silent no-op would leave the caller believing otherwise.
    """
    row = load_visual(cur, visual_id)
    if not row["publishable"]:
        blocking = [c["check"] for c in (row["critique"].get("critiques") or [])
                    if c["severity"] == "blocking" and c["outcome"] == "violated"]
        raise VisualError(
            "This figure did not pass the visualization critic and must not be "
            f"published. Unresolved: {', '.join(blocking) or 'unknown'}."
        )

    spec = ResearchVisualSpec.model_validate(row["spec"])
    data = VisualData.model_validate(row["data"])
    current_hash = row["spec_hash"]

    if fmt == "vega-lite":
        payload = web.render(spec, data)
        cur.execute(
            "INSERT INTO visual_renders(id, visual_id, format, spec_hash, payload) "
            "VALUES (%s, %s, %s, %s, %s) "
            "ON CONFLICT (visual_id, format, spec_hash) DO UPDATE SET payload = EXCLUDED.payload "
            "RETURNING id",
            (new_id("vren"), visual_id, fmt, current_hash, jsonb(payload)),
        )
        return {"visual_id": visual_id, "format": fmt, "payload": payload,
                "render_id": cur.fetchone()["id"]}

    # The filename carries the spec hash and the size, not just the format.
    #
    # It used to be `{visual_id}.{fmt}` while the row was keyed on
    # (visual_id, format, spec_hash) — so editing a figure and re-rendering
    # produced a second row pointing at the same file, and the first row's
    # content_hash described bytes that were gone. `stale_renders` then reported
    # a file as out of date while pointing at the one that had replaced it.
    # Adding a size without this would collide again: 720px and 1080px are the
    # same name.
    directory = storage_root() / "figures" / visual_id
    size = "" if height_px is None else f"-{height_px}"
    path = directory / f"{visual_id}-{current_hash[:12]}{size}.{fmt}"
    publication.render(
        spec, data, path=path, fmt=fmt, height_px=height_px,
        # Provenance travels inside the file, because a figure that leaves the
        # building is the one output whose link back cannot be a foreign key.
        metadata={
            "Title": visual_id,
            "Description": f"spec_hash={current_hash}",
            "Creator": "Throughline",
        })
    byte_size = path.stat().st_size
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    storage_key = str(path.relative_to(storage_root()))

    cur.execute(
        "INSERT INTO visual_renders(id, visual_id, format, storage_key, content_hash, "
        "spec_hash, bytes, height_px) VALUES (%s, %s, %s, %s, %s, %s, %s, %s) "
        "ON CONFLICT (visual_id, format, spec_hash, COALESCE(height_px, -1)) DO UPDATE "
        "SET storage_key = EXCLUDED.storage_key, content_hash = EXCLUDED.content_hash, "
        "bytes = EXCLUDED.bytes RETURNING id",
        (new_id("vren"), visual_id, fmt, storage_key, digest, current_hash,
         byte_size, height_px),
    )
    return {"visual_id": visual_id, "format": fmt, "storage_key": storage_key,
            "content_hash": digest, "bytes": byte_size, "height_px": height_px,
            "warning": publication.warn_about_format(fmt),
            "render_id": cur.fetchone()["id"]}


def apply_edit(
    cur, *, visual_id: str, changes: dict[str, Any], actor: str,
) -> dict[str, Any]:
    """Edit a figure's presentation. Refuses edits that change its meaning.

    "Never visually fake a different answer": changing which rows or variables a
    figure draws is a new analysis, and this raises rather than silently
    redrawing with the old statistics attached.
    """
    row = load_visual(cur, visual_id)
    data_changes = sorted(set(changes) & _DATA_BEARING_FIELDS)
    if data_changes:
        raise EditRequiresRecomputation(
            f"Changing {', '.join(data_changes)} changes what the figure shows, not "
            "how it looks. Create a new AnalysisSpec and run it, then visualise "
            "that result — a redraw would leave the old statistics on new data."
        )
    unknown = sorted(set(changes) - _PRESENTATION_FIELDS)
    if unknown:
        raise VisualError(
            f"Unknown or non-editable field(s): {', '.join(unknown)}. "
            f"Editable: {', '.join(sorted(_PRESENTATION_FIELDS))}"
        )

    spec = ResearchVisualSpec.model_validate(row["spec"] | changes)
    data = VisualData.model_validate(row["data"])
    run = get_run(cur, row["analysis_run_id"])
    report = visual_critic.critique(spec, data, analysis=(run["result"] or {}),
                                    autofix=True)
    spec = report.spec or spec

    cur.execute(
        "UPDATE visuals SET spec = %s, spec_hash = %s, visual_type = %s, "
        "critique = %s, publishable = %s, version = version + 1 WHERE id = %s",
        (jsonb(spec.model_dump(mode="json")), spec_hash(spec), str(spec.visual_type),
         jsonb(report.to_dict()), report.publishable, visual_id),
    )
    audit(cur, project_id=row["project_id"], actor=actor, action="edit",
          object_type="visual", object_id=visual_id, detail={"fields": sorted(changes)})
    return {"visual_id": visual_id, "spec": spec, "critique": report.to_dict(),
            "publishable": report.publishable}


def stale_renders(cur, visual_id: str) -> list[dict[str, Any]]:
    """ — renders whose spec has moved on are marked, not silently served."""
    row = load_visual(cur, visual_id)
    cur.execute(
        "SELECT id, format, spec_hash, created_at FROM visual_renders WHERE visual_id = %s",
        (visual_id,),
    )
    return [dict(r, stale=r["spec_hash"] != row["spec_hash"]) for r in cur.fetchall()]
