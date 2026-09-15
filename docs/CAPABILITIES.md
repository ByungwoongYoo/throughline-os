# What is built, in depth

This is the detail that used to open the README. It moved here when the README
was restructured to say first what Throughline is and how to run it (T186):
nothing was cut, and the claims below are still checked — the spatial counts by
`apps/web/tests/the-capabilities-count-what-is-there.test.ts`.

For what the product does for a researcher, start with the README. For what is
missing and the order it is being built in, `ROADMAP.md`. For who is doing what
now, `TASKS.md`.

The scientific spine works end to end: a paper goes in, claims come out, a
dataset tests them, and the result renders as a publication figure with its
provenance intact. All six of Part I's comparison verbs are wired with real refusal
taxonomies — a comparison the system declines to make is a first-class answer,
not an error.

That vocabulary now covers images as well. **Scan ↔ scan** compares a received
case against the scans a researcher already holds, and sorts them by whether
they *may* be compared rather than by how much they resemble it: appearance in
medical imaging is dominated by acquisition rather than by pathology, so a list
ordered by resemblance is mostly a list of scans taken on the same machine. It
partitions and never ranks — an ordered list of similar cases is a differential
diagnosis whatever it is labelled. NIfTI files are read in the browser and never
persisted, identifiers are never written into the project, and a region marked
on the case is echoed only onto scans the verdict permits, because drawing it
elsewhere would assert a correspondence that does not exist.

DICOM headers are read whatever the file, and pixels only where they are stored
uncompressed — so a compressed series is still *judged* for comparability, which
takes only the header, and declined for display with its transfer syntax named.
That split matters because DICOM is the only format here that records modality,
sequence weighting and contrast phase; a NIfTI carries none of them, which is
why two NIfTIs honestly come back as *cannot be judged*.

A library scales by being **queried on acquisition rather than ranked on
resemblance**: "every portal-venous CT at a millimetre or under" is the same
facts the verdict rests on, asked as a question. A query built from the case
returns exactly the scans the verdict calls directly comparable — a test holds
the two together, because two answers to one question that disagreed would make
both untrustworthy. Scans whose headers cannot answer are neither matched nor
excluded but counted separately, since a filter reporting twelve matches while
silently dropping forty unreadable headers is lying by omission.

Marks survive between sessions; scans do not. A mark attaches to a *salted
hash* of the series UID, computed with a salt that never leaves the machine —
so reopening the same series brings the marks back, while nothing stored points
at a patient or a study, and the same file opened elsewhere would not find them.
They are kept in browser storage rather than the project record, because a mark
carries free text and free text is the most reliable way an identifier escapes a
research system.

On top of that spine sits an interpretation layer, whose job is to make the
system's own record legible to the person using it:

- **The exploration ledger** counts every look at the data in a session and
  applies Benjamini–Hochberg across the family. A pre-registered prediction with
  a stated direction is exempt; a comparison the platform refused still counts,
  because it was a look even though it produced no statistic.
- **Withdrawn sources** — harvesting marks a source the repository stopped
  publishing, and the report says what in the project still rests on it. It
  never calls a withdrawal a retraction: an embargo, a correction and a
  retraction arrive identically, and the feed does not say which.
- **Fork lineage** reads `forked_from_run_id` and `fork_reason` back, so a
  sensitivity branch is visible as a branch. Nothing counts forks against the
  researcher — forking is how sensitivity analysis is done.
- **Export staleness** compares the hash recorded when a document was exported
  against what the analyses say now, and keeps "you edited this" apart from "the
  numbers moved underneath it". Only the second is alarming.
- **Pre-registration that is actually checked.** A registration can state the
  analysis it intends — method, design, covariates, exclusions — and the system
  compares that with what was really run. This closes a loophole in the ledger
  above: the exemption from multiple-comparison correction used to ask only
  whether a registration existed, was unedited and came first, all of which can
  be true of an analysis with nothing to do with the plan. It is now earned by
  matching, and a deviating test rejoins the family it belongs to.

  Three rules keep it usable. A plan that says nothing about covariates cannot
  be deviated from on covariates — unstated is reported as unregistered, not as
  a violation. A harmonised rename is not a change. And nothing calls a
  deviation misconduct: deviating is usually right, and the point is to state it
  deliberately rather than have a reviewer find it. The *Deviations from the
  registered plan* section is generated from the record with every reason left
  blank, because the system knows what changed and only the researcher knows
  why.

The spatial layer renders rather than being catalogued.
`apps/web/lib/charts3d/registry.ts` names all 253 visualizations the brief lists
and records which of them anything can actually draw — **216 today, against 86
at the start of the wave, and no primitive left unwritten**. Eight primitives
account for all of them, because a named visualization is a configuration of a
primitive rather than a chart of its own: `surface` 55, `points` 36, `network`
35, `glyphs` 28 (vector and tensor fields), `volume` 26 (voxel grids), `lines`
20 (orbits, flight paths, trajectories and streamlines), `isosurface` 12
(spheres, tori, molecular orbitals, tumour margins — and a decision boundary,
which in three inputs is a shell rather than a height field) and `bars` 4. The
remaining 37 need somebody else's reader — DICOM, NIfTI, Mol\*, a CAD kernel —
which the registry keeps apart from a missing renderer because the costs differ
in kind.

These figures are checked against the registry by
`apps/web/tests/the-capabilities-count-what-is-there.test.ts`. They were wrong in the README
for a long time — 238 and 199, when the catalogue held 253 and drew 216 — which
is the same defect the catalogue *page* had already been repaired for: a
headline number typed into a file, going quietly out of date while the code it
described grew. The page derives its number now; this paragraph cannot, so a
test derives it instead.

`bars` is the one §10 warns against, and it is built to say so: all four of its
entries are *framed* rather than inherently spatial, so the chart measures what
depth costs it — how many bars are hidden behind others, and how much taller the
near row reads for the same value — and puts both in the caption. At the default
view of a 5×5 grid that is three hidden and 56% of stretch.

Each of those charts states what it is hiding, which for a spatial chart is not
a courtesy. Depth buys occlusion, so a volume reports how many voxels fall below
the window, how many sit inside it but too faint for a pixel to show, and what
the sampling stride was; a field says how many arrows were shortened to fit and
to read those by colour instead; a set of paths says where the measurements had
holes in them, because a line drawn across a gap is a confident claim about
ground nothing was recorded on. `/charts-3d` draws all six from synthetic data,
with one hand driving whichever chart it is over — which is where `bounds()` is
actually used rather than merely implemented.

The flat charts became interactive in the same wave: hover emphasis, a tooltip
carrying the real value in the reader's units rather than in pixels, and
highlighting linked between a chart and its data table, across 12 of the 13
primitives.

What is missing is most of the integration surface, the Scientific Motion
Grammar and the video engine. `ROADMAP.md` is the live document: it records what exists, what
does not, and the order the rest is being built in. Where an earlier audit was
wrong, the correction is kept rather than quietly edited out.

**Every statistical method is checked against somebody else's implementation.**
`evals/conformance.py` walks the method registry rather than a list somebody
maintains: each method either has a scipy reference or a written reason why one
cannot exist, and a method with neither fails the build. It runs over sixty
random frames chosen to be awkward — unequal groups, single-member groups, tied
ranks — because a hand-picked example can pass while the edge cases diverge.
Agreement is required to floating-point noise rather than to a few decimal
places, since two implementations of one closed form should differ only in
rounding.

Agreeing with scipy is necessary and not sufficient: a number can be computed
correctly and then be labelled, paired or judged wrongly. The latest wave found
several of those:
- A rank-biserial correlation had its sign reversed.
- Kruskal–Wallis reported eta-squared-H under the name epsilon-squared.
- A proportion of variance explained was judged on the correlation scale.
- A regression's headline p-value belonged to the whole model while the
  estimate beside it belonged to one predictor.
- Cramér's V was taken from the continuity-corrected statistic.

Each result's headline numbers now describe the same thing, and each effect
size is judged on its own scale.

**A corrected result gets one verdict everywhere.** A discovery run's
false-discovery rate is the researcher's to set, and whether a q-value survived
is decided by one rule, `discovery.survived_correction`, at the rate its own run
was corrected at. Before that, the correction promoted a result at 0.10 and
eight later readers each re-derived the verdict with `q < 0.05`, including:
- the patterns screen;
- the claim test, which called the promoted discovery a null;
- validation;
- the figures and the result card.

The interface now shows the server's verdict rather than computing its own, and
a source scan fails any new comparison of a q-value with a fixed number.

**Nothing here is a placeholder presented as working functionality.** That is
the standard the project sells itself on, so it is also the thing most worth
checking: `tests/test_packaging.py` and the primitive registry exist to make
drift between what is claimed and what runs visible in CI rather than in a demo.

A recurring class of defect here is worth naming, because most of the last
wave's work was it: **a column written by one part of the system and read by
none.** A withdrawn source that no screen mentions, a fork reason recorded and
never displayed, a render hash stored so staleness would be "provable" and
compared by nothing. Each one passed every test, because nothing was broken —
the feature simply had no reader. `tests/test_sql_references.py` catches the
narrower version (a query naming a column that does not exist); the wider
version is only found by reading the schema against the code, which is why
`ROADMAP.md` and `TASKS.md` record where it has been found before.
