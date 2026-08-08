# Phase 4 — Visual Intelligence

Per §132. Real publication figures, produced from recorded analyses, checked for
honesty before they can be published.

**Status: complete. 151 tests passing.**

## §74 proven, not asserted

The claim "do not recreate analysis logic for each output" is easy to write and
easy to violate. It is enforced structurally here:

```
analysis_run (recorded)
      │
      ▼
prepare.py  ──►  VisualData   (computed exactly once)
                     │
        ┌────────────┴────────────┐
        ▼                         ▼
  publication renderer       web renderer
  (SVG / PDF / PNG)          (Vega-Lite spec)
```

Neither renderer ever sees the dataset, so neither *can* re-aggregate and
disagree with the analysis. Every statistic printed on a figure comes from
`data.statistics`, copied verbatim from the run. That is what makes §58's
"visualization fidelity" question answerable at all.

A live regression rendered to all four outputs from one spec:

```
svg        50,636 bytes    pdf   19,950 bytes
png        88,908 bytes    vega-lite   3-layer spec
```

## §72 — the researcher never picks a chart type

| Analysis | Recommended | Why |
|---|---|---|
| correlation | scatter | shows every observation, so the reader judges the shape and sees outliers |
| multiple regression | coefficient plot | each adjusted estimate with its interval, side by side |
| t-test / ANOVA | **box**, not bar | a bar of means hides exactly the spread needed to judge whether groups differ |
| chi-square | heatmap | shows *where* the association sits |
| descriptive | histogram | shape, skew and gaps before any test |

Every recommendation carries its reason, a caption with the §47 statistics, an
interpretation and the alternatives it considered.

## §76 — the critic catches misleading figures

Eight checks, three severities. Blocking problems stop publication; fixable ones
are fixed and reported:

- **axis_integrity** — a bar chart's baseline is anchored at zero (fixed
  automatically). Blocking, because bar length encodes magnitude.
- **overstatement** — a caption claiming causation against
  `causal_status: association_only` is **blocking**. This is where association
  quietly becomes cause, and §52 forbids it.
- **comparable_scales** — found by looking at a real rendered figure (below).
- **uncertainty_representation** — an interval the analysis produced but the
  figure omitted is added automatically.
- **sample_visibility** — `n = 120` is appended to the caption if missing.
- **category_overload**, **scale_choice**, **accessibility**,
  **misleading_encoding** (a line over categorical x implies an ordering the
  data does not have).

## A bug the rendered figure revealed

The first live coefficient plot looked correct and was not. `gdp_per_capita`'s
interval collapsed to an invisible dot beside `consumption_ddd`'s, because raw
regression coefficients are in the units of their predictor — GDP is in tens of
thousands, so its coefficient is ~1e-6.

**A reader sees "no effect" when the truth may be "different units".** The critic
now flags coefficients spanning more than 100× on a shared axis and asks for
standardized coefficients or faceting. This is exactly the class of error §76
exists to catch, and it was only visible by looking at the output.

## §78 — a figure may not fake a different answer

`apply_edit` splits spec fields into presentation and data-bearing. Retitling is
allowed. Changing `filters`, `x`, `y`, `group` or the analysis run is refused:

> Changing filters changes what the figure shows, not how it looks. Create a new
> AnalysisSpec and run it, then visualise that result — a redraw would leave the
> old statistics on new data.

That is §78's "rerun computation; never visually fake a different answer" as a
precondition rather than a convention.

## LAW 5 and staleness

A visual is created *from* an analysis run and linked by a `visualizes` lineage
edge, so a figure traces back through analysis → dataset → source. Every render
records the spec hash it was drawn from; when the spec changes, `stale_renders`
marks the old files rather than serving them silently (§102).

## Not implemented

- **Interactive charts (§77).** The Vega-Lite specs declare `hover`, `brush` and
  `underlying_table`, but there is no browser to run them in — `apps/web` still
  does not exist because Node is not installed.
- **Natural-language visual editing (§78).** The *guard* is built and tested; the
  language front-end needs a model provider (§40), which does not exist.
- **TIFF export (§84).** SVG, PDF and PNG only; TIFF is refused by name.
- **Line and time-series visuals.** `VisualType.LINE` exists and the critic
  checks it, but no analysis produces time series yet — that needs the §46
  time-series methods absent from Phase 2.
- **Maps, networks, and the rest of §75.** The registry is additive; absent types
  are absent, not stubbed menu entries.

## Next

Phase 5 (§133) — the CommunicationArtifact model, dashboards, reports,
manuscripts and presentation generation. §80's "one finding → many outputs" is
the test: the same validated finding feeding a dashboard, a slide and a
manuscript paragraph, each referencing the finding rather than copying it.
