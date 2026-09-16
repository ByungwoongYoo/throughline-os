"use client";

/**
 * Reports and citation integrity (§79, §80, §58, §93).
 *
 * The design question here is what a reader should be shown *besides* the
 * prose, and the answer follows from what the artifact actually guarantees.
 *
 * Numbers on this screen carry their origin, because the guarantee is that each
 * was read from a recorded row rather than typed — and a guarantee nobody can
 * see is indistinguishable from a claim. Citations carry their entailment
 * state, including `unverified`, because a reference list that only showed the
 * checked ones would imply the rest had passed.
 *
 * Slice 3 item 3.1 opened the screen without changing any of that. What it
 * changed is *when* the reader learns it: the per-block provenance was true
 * only after a press, the export refusal was a disabled button, and the three
 * files a researcher comes here to take away had no heading over them. All
 * three were layering that had drifted into hiding.
 */

import { useState } from "react";
import {
  Artifact, ArtifactBlock, ArtifactSummary, Citation, CitationReport, Connection,
  Integrity, api,
} from "@/lib/api";
import { ApiState, useApi } from "@/lib/useApi";
import { Empty, Failure, Fold, Loading, Status, Totals } from "./primitives";
import { TermList } from "./term";
import {
  BibliographyPanel, ResultsTable, SnapshotPanel,
} from "./bibliography";

const FORMATS = ["markdown", "html", "docx", "pptx"] as const;

/**
 * §80 — whether a report can start from this connection.
 *
 * A report is written from something that was tested, so the only starting
 * points offered are connections with a recorded analysis run. The rule lived
 * inside this screen's filter, which was fine while this screen was the only
 * place a report could be drafted from. It is not any more: the connection
 * detail offers the same act on the object itself, and a rule copied to a
 * second call site is a rule that will disagree with itself the first time one
 * copy is amended. One rule, two callers.
 */
/**
 * Draft a report from a connection, and check its citations at once.
 *
 * One routine with two callers — this screen and the connection detail's
 * actions band — because the check is part of what "drafted" means here: a
 * report whose citations were never checked would show no integrity
 * verdict, and the export gate below reads that verdict. A second caller that
 * copied only the first request would produce a report that looked drafted
 * and was not checked, which is the shape of drift this file exists to
 * prevent (T135).
 */
export async function draftReport(projectId: string, connectionId: string):
    Promise<{ artifact_id: string }> {
  const created = await api.post<{ artifact_id: string }>(
    `/api/projects/${projectId}/artifacts/draft`, { connection_id: connectionId });
  await api.post(`/api/artifacts/${created.artifact_id}/check-citations`);
  return created;
}

export function canDraftReport(connection: { analysis_run_id: string | null }): boolean {
  return Boolean(connection.analysis_run_id);
}

export function Reports({ projectId, connections, onSelect }: {
  projectId: string;
  connections: ApiState<Connection[]>;
  onSelect: (id: string) => void;
}) {
  const artifacts = useApi<ArtifactSummary[]>(`/api/projects/${projectId}/artifacts`);
  const citations = useApi<CitationReport>(`/api/projects/${projectId}/citations/verify`);
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState<unknown>(null);

  // §80, from the one rule above, which the connection detail also asks.
  const eligible = (connections.data ?? []).filter(canDraftReport);

  async function draft(connectionId: string) {
    setDrafting(true);
    setError(null);
    try {
      const created = await draftReport(projectId, connectionId);
      artifacts.reload();
      citations.reload();
      onSelect(created.artifact_id);
    } catch (err) {
      setError(err);
    } finally {
      setDrafting(false);
    }
  }

  /** One eligible connection as a row: its name, its state, and the act. */
  const draftRow = (connection: Connection) => (
    <div className="row" key={connection.id} style={{ padding: "7px 0" }}>
      <div>
        <span style={{ fontWeight: 530 }}>
          {connection.left_variable} × {connection.right_variable}
        </span>{" "}
        <Status value={connection.lifecycle_status} compact />
      </div>
      <button className="btn" disabled={drafting}
              onClick={() => draft(connection.id)}>
        {drafting ? "Assembling…" : "Draft report"}
      </button>
    </div>
  );

  return (
    <>
      <h1>Reports</h1>
      {/*
        One sentence at rest, the rest one press away (T139). The second and
        third sentences say *why* a reference beats a copy, which is worth
        reading once and is in the way on every later visit.
      */}
      <p className="lede">A report references its findings rather than copying them.</p>
      <Fold summary="Why a reference and not a copy" count={1}>
        <p className="note" style={{ marginTop: 0 }}>
          Every number in a report is read from a recorded analysis when the
          document is produced, so the page cannot disagree with the computation.
        </p>
      </Fold>

      {error ? <Failure error={error} /> : null}
      <CitationHealth state={citations} />

      {/*
        §4.11.3 — the three take-aways, under a heading that says they are the
        three take-aways.

        They were already here, in this order, beside the citation health,
        because they answer two halves of one question: whether the references
        still resolve, and what they look like once exported. What they did not
        have was a name. Three sibling `<section className="bib">` panels
        between the citation meters and "Write a report" read as more of the
        integrity readout, which is why every inventory group ranked the
        snapshot and the results table among the capabilities nobody found
        (§6 rank 8) while looking straight at them. The block is the fix; every
        sentence inside it is unchanged, including the one that refuses to call
        the snapshot a backup.
      */}
      <section className="card" aria-labelledby="take-away">
        <h2 id="take-away">Take this away</h2>
        {/* The block's own sentence, cut to the clause that is a fact about
            the three panels rather than a description of each. */}
        <p className="note one-line" style={{ marginTop: 0 }}>
          Three files, each complete on its own — nothing here has to be copied
          by hand off the screens above.
        </p>
        <ResultsTable projectId={projectId} />
        <BibliographyPanel projectId={projectId} />
        <SnapshotPanel projectId={projectId} />
      </section>

      <div className="card">
        <h2>Write a report</h2>
        {eligible.length === 0 && (
          <Empty
            title="Nothing has been tested yet"
            hint="A report is written from a connection with a recorded analysis. Run discovery first."
          />
        )}
        {/*
          Three at rest, the rest in place (T139). Eight rows and eight buttons
          is eight decisions offered at once for one act; the first three are
          the ones the project ranked, and the fold says how many follow rather
          than truncating them away.
        */}
        {eligible.slice(0, 3).map(draftRow)}
        {eligible.length > 3 && (
          <Fold summary="More connections to write from"
                count={eligible.length - 3}>
            {eligible.slice(3, 8).map(draftRow)}
          </Fold>
        )}
      </div>

      {artifacts.error ? <Failure error={artifacts.error} retry={artifacts.reload} /> : null}
      {artifacts.loading && !artifacts.data && <Loading rows={3} label="Reading reports" />}
      {artifacts.data?.length === 0 && (
        <Empty title="No reports yet" hint="Draft one from a tested connection above." />
      )}
      {artifacts.data && artifacts.data.length > 0 && (
        <table>
          <thead>
            <tr>
              <th style={{ width: "44%" }}>Title</th><th>Type</th>
              <th style={{ textAlign: "right" }}>Blocks</th>
              <th style={{ textAlign: "right" }}>Exports</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {artifacts.data.map((artifact) => (
              <tr key={artifact.id} style={{ cursor: "pointer" }}
                  onClick={() => onSelect(artifact.id)}>
                <td style={{ fontWeight: 530 }}>
                  <button type="button" className="pick"
                          onClick={() => onSelect(artifact.id)}>
                    {artifact.title}
                  </button>
                </td>
                <td className="mono">{artifact.artifact_type}</td>
                <td className="numeric" style={{ textAlign: "right" }}>{artifact.block_count}</td>
                <td className="numeric" style={{ textAlign: "right" }}>{artifact.render_count}</td>
                <td><Status value={artifact.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

/** §58 — the project's citation health, stated without flattery. */
function CitationHealth({ state }: { state: ApiState<CitationReport> }) {
  if (state.error) return <Failure error={state.error} retry={state.reload} />;
  if (!state.data) return <Loading rows={2} label="Checking citations" />;

  const report = state.data;
  const unchecked = (report.by_entailment.unverified ?? 0)
    + (report.by_entailment.not_checkable ?? 0);

  return (
    <div className="card card-tight">
      <h3 className="eyebrow">Citation integrity</h3>
      {/* Six integers as one line, the same six facts (T139). */}
      <Totals parts={[
        [report.total, "citations", "citation"],
        [report.resolved, "resolve", "resolves"],
        [report.dangling.length, "dangling", "dangling"],
        [report.by_entailment.supported ?? 0, "supported", "supported"],
        [report.by_entailment.unsupported ?? 0, "unsupported", "unsupported"],
        [unchecked, "unchecked", "unchecked"],
      ]} />
      {/* Three of those six words are the report's own vocabulary and mean
          nothing to a reader who has not met them (T187). The other three —
          citations, resolve, unchecked — say what they are. */}
      <TermList ids={["dangling", "supported", "unsupported"]} />
      {/* The server's paragraph on what these numbers can and cannot mean.
          It does not change between visits, so it is not on screen at rest. */}
      <Fold summary="What these counts do and do not prove" count={1}>
        <p className="note" style={{ margin: 0 }}>{report.note}</p>
      </Fold>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

export function ReportDetail({ artifactId, projectId, onOpenArtifact }: {
  artifactId: string;
  /**
   * The project this document belongs to, for the per-export staleness check.
   *
   * `GET /api/projects/{project_id}/artifacts/{artifact_id}/staleness` is
   * scoped to a project — it checks the artifact is in it before answering —
   * so the id has to come down from the page, which already knows it.
   *
   * Optional only because the mounting site is another file's to edit (§4.11.4
   * lists `page.tsx` among its files, and this component is not there yet).
   * Where it is absent the readout is **not rendered at all** rather than
   * rendered as "could not be checked": that phrase is a claim about the
   * exported copies, and the truth here would be a claim about the wiring.
   * `artifact_staleness.py` makes exactly this distinction — "unresolvable is
   * not current" — and inventing a third meaning for it on screen would undo
   * the one thing that module exists to protect.
   */
  projectId?: string | null;
  /**
   * Where to send the reader once a talk exists.
   *
   * Supplied rather than optional-and-ignored: without it, re-cutting a report
   * would create a second document and leave the reader on the first, with no
   * way to reach the thing they just made. That is the shape of dead surface
   * this codebase keeps producing.
   */
  onOpenArtifact: (artifactId: string) => void;
}) {
  const { data, error, loading, reload } = useApi<Artifact>(`/api/artifacts/${artifactId}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [exported, setExported] = useState<Record<string, string>>({});
  /*
   * Bumped by a successful render, so the staleness readout below re-reads.
   * A new export is precisely the event that changes its answer, and a panel
   * that went on saying "nothing has been exported" directly under the button
   * that just exported something would be wrong in the one moment a reader is
   * watching it.
   */
  const [exportNonce, setExportNonce] = useState(0);

  async function render(fmt: string) {
    setBusy(fmt);
    setFailure(null);
    try {
      const result = await api.post<{ storage_key: string; byte_size: number }>(
        `/api/artifacts/${artifactId}/render?fmt=${fmt}`);
      setExported((current) => ({
        ...current,
        [fmt]: `${result.storage_key} · ${(result.byte_size / 1024).toFixed(1)} kB`,
      }));
      setExportNonce((n) => n + 1);
      reload();
    } catch (err) {
      setFailure(err);
    } finally {
      setBusy(null);
    }
  }

  /**
   * Re-cut this report as a talk.
   *
   * §75: a presentation is the same evidence at a different length, so it is
   * derived from the report rather than assembled again — the slides and the
   * paper end up referencing the same analysis runs, and re-running an
   * analysis moves both. Two documents assembled separately drift into two
   * accounts of one result.
   */
  async function recut() {
    setBusy("talk");
    setFailure(null);
    try {
      const talk = await api.post<{ artifact_id: string }>(
        `/api/artifacts/${artifactId}/presentation`);
      onOpenArtifact(talk.artifact_id);
    } catch (err) {
      setFailure(err);
    } finally {
      setBusy(null);
    }
  }

  if (error) return <Failure error={error} retry={reload} />;
  if (loading || !data) return <Loading rows={5} label="Resolving every value in the report" />;

  return (
    <>
      <h1>{data.title}</h1>
      <div className="row" style={{ marginBottom: 14 }}>
        <Status value={data.status} />
        <span className="mono" style={{ color: "var(--ink-faint)" }}>
          {data.artifact_type} · version {data.version} · {data.blocks.length} blocks
        </span>
      </div>

      <IntegrityPanel integrity={data.integrity} />

      {/*
        Offered on a report and not on a talk: a presentation re-cut from a
        presentation would be a copy, and the route derives slides from a
        report's findings.
      */}
      {data.artifact_type === "report" && (
        <div className="card">
          <h2>As a talk</h2>
          <p style={{ marginTop: 0 }}>
            The same evidence at a different length. The slides reference the
            same analysis runs as this report, so re-running one moves both —
            rather than leaving two accounts of one result.
          </p>
          <button className="btn" disabled={busy !== null}
                  onClick={() => void recut()}>
            {busy === "talk" ? "Cutting…" : "Re-cut as a talk"}
          </button>
        </div>
      )}

      <div className="card">
        <h2>Export</h2>
        <p style={{ marginTop: 0 }}>
          Every format is produced from the same resolved artifact, so none of them can
          state a different number from the others.
        </p>
        {data.integrity.publishable ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            {FORMATS.map((fmt) => (
              <button key={fmt} className="btn" disabled={busy !== null}
                      onClick={() => render(fmt)}>
                {busy === fmt ? "Rendering…" : fmt}
              </button>
            ))}
          </div>
        ) : (
          <ExportRefusal integrity={data.integrity} />
        )}
        {failure ? <div style={{ marginTop: 10 }}><Failure error={failure} /></div> : null}
        {Object.entries(exported).map(([fmt, detail]) => (
          <div key={fmt} className="mono" style={{ color: "var(--ink-faint)", marginTop: 6 }}>
            {fmt} → {detail}
          </div>
        ))}
      </div>

      {/*
        §4.11.4 — under Export, because it is the same subject one step later:
        the block above makes copies, and this says whether the copies already
        made still tell the truth. `ExportedDocuments` asks the project-wide
        version of the question above the Reports list; this is the one document
        a reader has actually opened, format by format.
      */}
      {projectId && (
        <ExportsOfThisDocument projectId={projectId} artifactId={artifactId}
                               nonce={exportNonce} />
      )}

      <div className="card">
        <h2>The report</h2>
        {data.blocks.map((block) => (
          <Block key={block.id} block={block} />
        ))}
      </div>
    </>
  );
}

/**
 * Why there are no format buttons here (§4.11.2).
 *
 * The rule is unchanged and is the one this screen has always had: export is
 * blocked while the integrity check reports problems, because a file outlives
 * the warning that would have accompanied it on screen. What changed is its
 * *shape*. It used to be four buttons that looked pressable, did nothing when
 * pressed, and carried an eleven-point note underneath them — which is the one
 * form this codebase refuses everywhere else (`publish.tsx:230-242`: "a
 * download button here would be one that always fails. Saying why is the useful
 * thing"). A refusal is a sentence in the place the control would have been.
 *
 * The problems are named here as well as in the integrity panel above, because
 * a reader who has scrolled to Export is asking "why can I not export", and the
 * answer is a list of specific blocks — not a pointer back up the page.
 */
function ExportRefusal({ integrity }: { integrity: Integrity }) {
  return (
    <div className="notice" role="alert" style={{ marginTop: 10 }}>
      <span>
        Export is blocked while the integrity check reports problems. A file
        outlives the warning that would have accompanied it on screen, so
        nothing is written until these are fixed.
        {integrity.problems.length > 0 ? (
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {integrity.problems.map((problem, i) => (
              <li key={`${problem.block_id}:${i}`}>
                <b>{problem.kind.replace(/_/g, " ")}</b> — {problem.detail}
              </li>
            ))}
          </ul>
        ) : (
          /*
           * The server said "not publishable" and named nothing. Saying so is
           * better than an empty list under a promise of one — §104 is about
           * the server's own words, and its silence is a word too.
           */
          <> The check named no block, so what to fix has to be found by
            re-checking the citations.</>
        )}
      </span>
    </div>
  );
}

/**
 * The states `artifact_staleness.py` can return for one export.
 *
 * Declared here rather than in `lib/api.ts` because it is one screen's readout
 * of one route, and the module that owns the words is Python. The union is
 * widened with `string` nowhere: an unknown state must fail the compiler here
 * rather than render as a blank chip.
 */
type ExportState =
  | "current" | "document_edited" | "values_changed" | "not_checkable" | "superseded";

/** `GET /api/projects/{id}/artifacts/{id}/staleness`, as the route returns it. */
type StalenessReport = {
  artifact_id: string;
  title: string;
  renders: Array<{
    id: string;
    fmt: string;
    storage_key: string;
    resolved_hash: string | null;
    artifact_version: number;
    created_at: string;
    state: ExportState;
    detail: string;
  }>;
  live_hash: string | null;
  drifted: Array<{ id: string; fmt: string }>;
  note: string;
};

/**
 * Every export of this document, and whether each still reflects the analyses
 * (§4.11.4 — an orphan route whose home the inventory names as this screen).
 *
 * The domain does all the judging and writes every sentence: `state` is one of
 * five words it chose, `detail` is its explanation of that word, and `note` is
 * its summary. Nothing here re-words any of them, because the distinctions it
 * draws are the whole point — an edit the researcher made and numbers that
 * moved underneath them are both "out of date" and only one of them is
 * alarming, and a screen that merged them would bury the second under the
 * first. Nothing is computed in the browser; this component picks no state and
 * counts nothing.
 */
function ExportsOfThisDocument({ projectId, artifactId, nonce }: {
  projectId: string;
  artifactId: string;
  /** Bumped by a fresh export upstream, so this re-reads rather than going stale itself. */
  nonce: number;
}) {
  const { data, error, loading, reload } = useApi<StalenessReport>(
    `/api/projects/${projectId}/artifacts/${artifactId}/staleness`,
    [projectId, artifactId, nonce],
  );

  if (error) return <Failure error={error} retry={reload} />;
  if (loading || !data) {
    return <Loading rows={2} label="Checking the exported copies of this document" />;
  }

  return (
    <div className="card card-tight">
      <h3 className="eyebrow">Exported copies of this document</h3>
      <p className="note" style={{ marginTop: 6 }}>{data.note}</p>
      {data.renders.map((render) => (
        <div className="row" key={render.id}
             style={{ padding: "6px 0", alignItems: "baseline" }}>
          <span className="mono">{render.fmt}</span>
          {/* §118 — the state is a word, not only a colour, and the word is
              the domain's. `raw`, because these five words are a staleness
              vocabulary and not lifecycle states: without it a future
              collision would have this pill announce that an export "has been
              replicated". */}
          <Status value={render.state} raw />
          <span className="note" style={{ margin: 0, flex: 1, minWidth: "16rem" }}>
            {render.detail}
          </span>
        </div>
      ))}
    </div>
  );
}

function IntegrityPanel({ integrity }: { integrity: Integrity }) {
  const [open, setOpen] = useState(false);

  /*
   * Warnings are grouped by kind, not listed one per block.
   *
   * Rendered flat, one unverified citation attached to six sentences produced
   * six identical cards and pushed the report itself below the fold. Repetition
   * is not emphasis — it buried the thing the reader came for while telling
   * them nothing they had not read in the first card. The count carries the
   * scale; the detail is one click away.
   */
  const grouped = new Map<string, { count: number; detail: string }>();
  for (const warning of integrity.warnings) {
    const existing = grouped.get(warning.kind);
    if (existing) existing.count += 1;
    else grouped.set(warning.kind, { count: 1, detail: warning.detail });
  }

  return (
    <div className="card card-tight">
      <div className="row" style={{ marginBottom: 6 }}>
        <h3 className="eyebrow" style={{ margin: 0 }}>Integrity</h3>
        {/* §118 — the state is a word, not only a colour. */}
        <Status value={integrity.publishable ? "passed" : "violated"} />
      </div>
      <p className="note" style={{ marginTop: 0 }}>
        {integrity.blocks_checked} blocks checked. Problems block export; warnings do not,
        because an unverified citation is an honest gap rather than an error.
      </p>

      {integrity.problems.map((problem, i) => (
        <div className="error" key={i} style={{ marginTop: 6 }}>
          <b>{problem.kind.replace(/_/g, " ")}</b> — {problem.detail}
        </div>
      ))}

      {[...grouped.entries()].map(([kind, group]) => (
        <div className="notice" key={kind}>
          <span>
            <b>{kind.replace(/_/g, " ")}</b>
            {group.count > 1 && <> · {group.count} blocks</>}
            {open && <div className="note" style={{ margin: "4px 0 0" }}>{group.detail}</div>}
          </span>
        </div>
      ))}

      {integrity.warnings.length > 0 && (
        <button className="block-trace" onClick={() => setOpen((v) => !v)}
                style={{ marginTop: 8 }} aria-expanded={open}>
          {open ? "Hide detail" : "What these mean"}
        </button>
      )}
    </div>
  );
}

/**
 * Which analysis methods a block's citations name, without repeating one.
 *
 * `value_provenance[].source` is an id — a connection, a run, a line of
 * enquiry (`communication.py:378-407`) — and an id is not a method. The method
 * is on the citation whose target is an `analysis_run`, which is the same
 * object `CitationLine` reads it from below. One block, one place that knows
 * where the word comes from.
 */
function methodsBehind(citations: Citation[]): string[] {
  const seen = new Set<string>();
  for (const citation of citations) {
    if (citation.target_kind !== "analysis_run") continue;
    const method = (citation.target as { method?: unknown }).method;
    if (typeof method === "string" && method) seen.add(method.replace(/_/g, " "));
  }
  return [...seen];
}

/**
 * What one block's provenance amounts to, in a line a reader does not press for
 * (§4.11.1).
 *
 * This file's opening paragraph says a guarantee nobody can see is
 * indistinguishable from a claim, and then made the guarantee visible only to
 * a reader who pressed a per-block toggle. The counts and the entailment words
 * were already on the block; printing them costs one line and is strictly more
 * honest. The chain itself stays exactly where it was, one press away — a
 * layer added, never a layer removed (`ResultCard.tsx:1-25`).
 *
 * Three rules the wording follows:
 *
 * * **The method is named only when there is one.** Two runs behind one
 *   sentence and "from pearson correlation" would attribute values to a method
 *   that did not produce all of them.
 * * **Every entailment other than `supported` is named**, not just
 *   `unverified`. A line that printed the one word this item happened to
 *   mention would be the same mistake in a smaller font: a reference list that
 *   only showed the checked ones implies the rest passed.
 * * **`supported` is stated too**, because "2 citations" alone leaves whether
 *   anyone checked them to the reader's optimism.
 *
 * Exported so the sentence is a value a test can hold, rather than a shape
 * assembled inside JSX where its two halves can drift apart.
 */
export function provenanceLine(block: Pick<ArtifactBlock, "value_provenance" | "citations">): string {
  const parts: string[] = [];

  const values = block.value_provenance.length;
  if (values > 0) {
    const methods = methodsBehind(block.citations);
    const noun = `${values} value${values === 1 ? "" : "s"}`;
    parts.push(methods.length === 1
      ? `${noun} from ${methods[0]}`
      : `${noun} read from recorded rows`);
  }

  const cited = block.citations.length;
  if (cited > 0) {
    const byState = new Map<string, number>();
    for (const citation of block.citations) {
      if (citation.entailment === "supported") continue;
      byState.set(citation.entailment, (byState.get(citation.entailment) ?? 0) + 1);
    }
    const states = [...byState.entries()]
      .map(([state, count]) => `${count} ${state.replace(/_/g, " ")}`);
    const noun = `${cited} citation${cited === 1 ? "" : "s"}`;
    parts.push(states.length > 0
      ? `${noun}, ${states.join(", ")}`
      : `${noun}, ${cited === 1 ? "supported" : "all supported"}`);
  }

  return parts.join(" · ");
}

function Block({ block }: { block: ArtifactBlock }) {
  const [open, setOpen] = useState(false);
  const heading = block.block_type === "heading" || block.block_type === "slide_title";
  const traceable = block.value_provenance.length > 0 || block.citations.length > 0;

  return (
    <div className="block" data-kind={block.block_type}>
      {heading ? <h3>{block.text}</h3> : <p className="block-text">{block.text}</p>}

      {traceable && (
        <>
          {/* Permanent, and above the control rather than inside its label:
              the counts used to be part of the button's text, so a reader
              learned that a citation was unverified only by finding the
              button first. */}
          <p className="note" style={{ margin: "3px 0 4px" }}>{provenanceLine(block)}</p>
          <button className="block-trace" onClick={() => setOpen((v) => !v)}
                  aria-expanded={open}>
            {open ? "Hide" : "Where this came from"}
          </button>
        </>
      )}

      {open && (
        <div className="block-prov">
          {block.value_provenance.map((ref) => (
            <div key={ref.name} className="mono">
              {ref.name} = {String(block.resolved[ref.name])}
              <span style={{ color: "var(--ink-faint)" }}> ← {ref.source}.{ref.path}</span>
            </div>
          ))}
          {block.citations.map((citation) => (
            <CitationLine key={citation.id} citation={citation} />
          ))}
          {block.value_provenance.length > 0 && (
            <p className="note" style={{ marginBottom: 0 }}>
              Read from the recorded row when this page loaded — not stored in the report.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function CitationLine({ citation }: { citation: Citation }) {
  const target = citation.target as Record<string, string | undefined>;
  const label = citation.target_kind === "analysis_run"
    ? `${target.id} (${(target.method ?? "analysis").replace(/_/g, " ")})`
    : target.source_title ?? citation.target_kind;

  return (
    <div style={{ marginTop: 6 }}>
      <Status value={citation.entailment} />{" "}
      <span className="mono" style={{ fontSize: 11.5 }}>{label}</span>
      {citation.locator && (
        <span style={{ color: "var(--ink-faint)" }}> · {citation.locator}</span>
      )}
      {citation.entailment_detail && (
        <div className="note" style={{ margin: "2px 0 0" }}>{citation.entailment_detail}</div>
      )}
    </div>
  );
}
