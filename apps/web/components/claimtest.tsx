"use client";

/**
 * The claim test — paper ↔ dataset (Part I), wearing UI_01.
 *
 * The brief calls this the differentiator, and the reason nobody does it well
 * is that doing it well means refusing. Three steps, each able to fail loudly,
 * and the interface has to make failing look like an answer rather than a
 * malfunction — otherwise a researcher reads "not testable" as "broken" and
 * stops using the feature that was protecting them.
 *
 * So the three steps are drawn as a visible sequence and the one that failed is
 * marked, with what would fix it. A refusal here is the product working.
 *
 * **The reasoning master is a layout argument about attribution.** UI_01 puts
 * the researcher's judgment on the left, explicitly human, and the model's
 * reading on the right, explicitly model-generated and marked stored or fresh.
 * The working interpretation sits between them because it belongs to neither:
 * it is the recorded claim with its exposure and outcome, and the question the
 * screen exists to ask is whether the data can test it.
 *
 * That separation is the whole point of the master and it is easy to lose.
 * §09: source quote and model paraphrase must not share an unlabelled
 * quotation treatment. A reader who cannot tell the paper's words from a
 * model's summary of them is reading a generated sentence as a citable one.
 *
 * **The centre is not a text box.** §09 forbids an autosaving interpretation
 * field where no write contract exists, and there is none: a located claim is
 * not a node in the graph. A revision is written as a note, which is
 * append-only and keeps its author, rather than as a silent overwrite of what
 * the model or the paper said.
 */

import { useEffect, useState } from "react";
import { Source, api } from "@/lib/api";
import { currentView } from "@/lib/view-context";
import { Empty, Failure, Loading } from "./primitives";
import { RecordStudyContext } from "./StudyContext";
import { VerdictBody, VerdictCard } from "./Verdict";

type Claim = {
  claim_id?: string;
  /*
   * Which model read it, and at which prompt version. Two readings of one
   * paper can disagree — a different model, or the same model at a different
   * prompt, locates different claims — and when they do the disagreement has
   * to be attributable rather than argued about.
   */
  model?: string;
  prompt_name?: string;
  prompt_version?: number;
  statement: string;
  exposure: string;
  outcome: string;
  direction: string;
  claimed_design: string;
  claimed_effect?: string;
  population?: string;
  locator?: string;
  source_id?: string;
};

type Located = {
  source_title: string;
  claims: Claim[];
  note: string;
  model: string;
  prompt: string;
};

type Result = {
  verdict: VerdictBody;
  claim: Claim;
  dataset: { id: string; name: string; design: string; rows: number };
  testable: boolean;
  exposure_column: string | null;
  outcome_column: string | null;
  /** Checks that did not run. Never merged with checks that passed. */
  unchecked: string[];
};

/**
 * One note in an object's journal.
 *
 * Human and model notes are the same record with a different author kind, and
 * they are rendered in different columns for that reason alone: the left side
 * of this screen is what the researcher thought, the right is what a model
 * produced. §09 refuses them a shared unlabelled treatment, and so does the
 * journal that stores them.
 */
type JournalNote = {
  id: string;
  body: string;
  author_kind: "human" | "model";
  author: string;
  prompt?: string | null;
  model?: string | null;
  created_at: string;
};

type JournalContext = {
  object: { id: string; object_type: string; title: string };
  notes: JournalNote[];
};

/**
 * The notes on the paper, and the two ways of adding one.
 *
 * Anchored to the paper's research object because that is the object this
 * product actually has. A located claim is not a node in the graph — only the
 * paper and the dataset are — so a note "on the claim" would need an object
 * nothing creates, and inventing one here would put a second, unversioned
 * vocabulary beside the one the journal already keeps. What the researcher
 * writes is their reading of this paper, which is what the anchor says.
 *
 * Append-only, because the journal is: what somebody believed at the time is
 * evidence about how they reached a conclusion, and editing it away rewrites
 * the reasoning while leaving the conclusion standing.
 */
function useJournal(projectId: string, objectId: string | null) {
  const [context, setContext] = useState<JournalContext | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!objectId) { setContext(null); return; }
    let live = true;
    api.get<JournalContext>(
      `/api/projects/${projectId}/objects/${objectId}/journal`)
      .then((c) => { if (live) { setContext(c); setError(null); } })
      .catch((err) => { if (live) setError(err); });
    return () => { live = false; };
  }, [projectId, objectId]);

  /*
   * Each path literal sits at its own `api.post`, and that is not a style
   * choice.
   *
   * `test_routes_are_reachable` reads the interface's calls statically: it
   * finds a call, then looks for an `/api/...` literal within the next few
   * hundred characters. A helper that takes the path as a parameter puts the
   * literal out of that window — which is how a first attempt here reported
   * itself as calling `POST /api/proj`, a truncation nothing serves. Worse, a
   * path whose last segment is a variable becomes an unresolvable wildcard, so
   * a control that 404s on every press would ship looking checked.
   *
   * So the thunk carries the whole call and the helper carries only the state
   * around it.
   */
  async function run(call: () => Promise<JournalNote>, label: string) {
    if (!objectId) return false;
    setBusy(label); setError(null);
    try {
      const note = await call();
      setContext((c) => (c ? { ...c, notes: [...c.notes, note] } : c));
      return true;
    } catch (err) { setError(err); return false; } finally { setBusy(null); }
  }

  return {
    notes: context?.notes ?? [],
    objectType: context?.object.object_type ?? "paper",
    error, busy,
    append: (body: string, objectType: string) => run(
      () => api.post<JournalNote>(
        `/api/projects/${projectId}/objects/${objectId}/journal`,
        { body, object_type: objectType }),
      "Saving"),
    ask: (question: string) => run(
      () => api.post<JournalNote>(
        `/api/projects/${projectId}/objects/${objectId}/ask`,
        { question, view: currentView() }),
      "Asking"),
  };
}

/**
 * The convergence behind the three columns.
 *
 * UI_01's defining image: two fields of fine strands, one from the human side
 * and one from the model's, drawn into a single point behind the working
 * interpretation. It is the screen's argument made visible — two readings
 * meeting on one claim — which is why §08 allows this master "delicate static
 * filaments" and gives the cockpit none.
 *
 * Drawn as real curves rather than faked with gradients. A first attempt used
 * `repeating-conic-gradient`, and it produced two hard starbursts with visible
 * edges that converged on nothing: the strands have to *arrive* somewhere, and
 * a gradient has no somewhere. Every path here ends at the same point.
 *
 * Static and deterministic. The angles come from arithmetic rather than from
 * `Math.random`, so the server and the client draw the same field and React
 * does not report a hydration mismatch — and so the screen looks the same on
 * every visit, which a background that shuffles does not.
 */
function Filaments() {
  const W = 1000;
  const H = 620;
  const cx = W / 2;
  const cy = H * 0.42;
  const strands = 130;

  /*
   * A deterministic wobble.
   *
   * Strands at perfectly even spacing read as a printed starburst; the
   * reference's field is irregular, which is what makes it look like threads
   * rather than rays. `Math.random` cannot be used — the server and the client
   * would draw different fields and React would report a hydration mismatch —
   * so the irregularity comes from a cheap deterministic hash instead.
   */
  const jitter = (i: number, salt: number) =>
    ((Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453) % 1 + 1) % 1;

  const side = (from: "left" | "right") => {
    const dir = from === "left" ? -1 : 1;
    return Array.from({ length: strands }, (_, i) => {
      const t = (i + 0.5) / strands;
      // Densest through the middle, thinning towards the top and bottom, so
      // the field has a waist rather than an even wall of lines.
      // Nearly the full height at the rim: the reference's strands arrive at
      // the node from a wide range of angles, and a narrow rim produces the
      // flat bowtie a first attempt drew.
      const spread = Math.sin(Math.PI * t) ** 0.45;
      const y = cy + (t - 0.5) * H * 2.1 * spread
                  + (jitter(i, 1) - 0.5) * 30;
      const x = cx + dir * W * 0.56;
      /*
       * Two control points, both bowed AWAY from the straight line: the strand
       * leaves the rim almost horizontally, bellies out, and only turns into
       * the node at the last moment. A single control point gives a straight
       * ray, which is what the first attempt drew.
       */
      const belly = (jitter(i, 2) - 0.5) * 70;
      // The first control point stays out near the rim, so the strand keeps its
      // own angle for most of the run and only turns in at the end — which is
      // what gives the field its depth instead of a flat funnel.
      const c1x = cx + dir * W * 0.30;
      const c1y = y + (y - cy) * 0.22 + belly;
      const c2x = cx + dir * W * 0.06;
      const c2y = cy + (y - cy) * 0.06;
      return `M ${x.toFixed(1)} ${y.toFixed(1)} C ${c1x.toFixed(1)} ${c1y.toFixed(1)},`
           + ` ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${cx} ${cy}`;
    });
  };

  /** The motes the reference scatters through the field. */
  const motes = Array.from({ length: 26 }, (_, i) => {
    const dir = i % 2 ? 1 : -1;
    const a = jitter(i, 3);
    const b = jitter(i, 4);
    return {
      cx: cx + dir * (0.1 + a * 0.44) * W,
      cy: cy + (b - 0.5) * H * 1.1,
      r: 1.4 + jitter(i, 5) * 2.2,
      model: dir > 0,
    };
  });

  return (
    <svg
      className="rsn-field"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      <g className="rsn-field-human">
        {side("left").map((d, i) => <path key={i} d={d} />)}
      </g>
      <g className="rsn-field-model">
        {side("right").map((d, i) => <path key={i} d={d} />)}
      </g>
      {motes.map((m, i) => (
        <circle
          key={i}
          className={m.model ? "rsn-mote rsn-mote-model" : "rsn-mote"}
          cx={m.cx} cy={m.cy} r={m.r}
        />
      ))}
      {/* The node the two readings meet on. */}
      <circle className="rsn-field-node" cx={cx} cy={cy} r={5} />
    </svg>
  );
}

export function ClaimTest({ projectId, sources, onOpenSource }: {
  projectId: string;
  sources: Source[];
  /**
   * Open a source in the section that shows sources, keeping the way back.
   *
   * §09 asks that "View dataset and Open source preserve return context". The
   * address carries the section and the object, so going there is a place the
   * browser's own Back returns from — which is the return context, rather than
   * a remembered scroll position this screen would have to keep.
   */
  onOpenSource?: (sourceId: string) => void;
}) {
  const papers = sources.filter((s) => !s.dataset);
  const datasets = sources.filter((s) => s.dataset);

  const [paper, setPaper] = useState<string | null>(null);
  const [datasetId, setDatasetId] = useState<string | null>(null);
  const [located, setLocated] = useState<Located | null>(null);
  const [claim, setClaim] = useState<Claim | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /** Whether what is on screen came from the record rather than a fresh read. */
  const [fromRecord, setFromRecord] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [draft, setDraft] = useState("");
  const [question, setQuestion] = useState("");

  const chosenPaper = papers.find((p) => p.id === paper) ?? null;
  const chosenDataset = datasets.find((d) => d.id === datasetId) ?? null;
  const journal = useJournal(projectId, chosenPaper?.object_id ?? null);

  /**
   * Show what this paper already says, reading it only if nobody has.
   *
   * Selecting a paper used to re-read it every time, which cost a model call
   * per selection and — the part that matters — could quietly change the
   * claims a comparison already rested on. `GET /sources/{id}/claims` exists
   * for exactly this and had no caller: *"reading the record and re-reading
   * the paper are different acts, and only one of them can change what every
   * downstream comparison rests on."*
   *
   * A paper nobody has read is still read on selection: there is nothing to
   * show, and reading it is plainly what the researcher meant by choosing it.
   */
  async function locate(sourceId: string) {
    setPaper(sourceId);
    setLocated(null); setClaim(null); setResult(null); setError(null);
    setFromRecord(false);
    setBusy("Looking at what this paper already says");
    try {
      const stored = await api.get<{ source_id: string; claims: Claim[] }>(
        `/api/sources/${sourceId}/claims?project_id=${projectId}`);
      if (stored.claims.length > 0) {
        const first = stored.claims[0];
        setLocated({
          source_title: papers.find((p) => p.id === sourceId)?.title ?? sourceId,
          claims: stored.claims,
          note: "Read once already. These are the claims that reading found.",
          model: first.model ?? "",
          prompt: first.prompt_name
            ? `${first.prompt_name} v${first.prompt_version ?? "?"}`
            : "",
        });
        setFromRecord(true);
        return;
      }
    } catch {
      // No record is the ordinary answer for a paper nobody has read. Fall
      // through and read it, rather than reporting the absence as a failure.
    } finally { setBusy(null); }

    await read(sourceId);
  }

  /** Read the paper with a model. The act that can change what is recorded. */
  async function read(sourceId: string) {
    setError(null);
    setFromRecord(false);
    setBusy("Reading the paper");
    try {
      setLocated(await api.post<Located>(
        `/api/sources/${sourceId}/claims?project_id=${projectId}`, {}));
    } catch (err) { setError(err); } finally { setBusy(null); }
  }

  /**
   * Ask whether the data could test the claim. Never runs an analysis.
   *
   * §09 is explicit that this requests compatibility and nothing else, and the
   * caption beside the control says so where a researcher will read it — the
   * outcomes below distinguish compatible, conditionally compatible, refused,
   * unknown metadata and a failed request, and none of them is an estimate.
   */
  async function test(chosen: Claim, datasetVersionId: string) {
    setClaim(chosen); setResult(null); setError(null);
    setBusy("Checking whether this data can test it");
    try {
      setResult(await api.post<Result>(
        `/api/projects/${projectId}/claim-test`,
        { claim: chosen, dataset_version_id: datasetVersionId }));
    } catch (err) { setError(err); } finally { setBusy(null); }
  }

  if (papers.length === 0 || datasets.length === 0) {
    return (
      <Empty
        title="A paper and a dataset are needed"
        hint="The claim test reads what a paper asserts, then works out whether your data could test them — and says plainly when it could not."
      />
    );
  }

  /*
   * Which of the three steps the screen is on, from real state rather than
   * from a counter. The sequence is the master's — choose a claim, match a
   * dataset, review testability — and a step is complete when the thing it
   * names exists, never when a button was pressed.
   */
  const step = !claim ? 1 : !chosenDataset ? 2 : 3;
  /** Why the next step cannot be taken, or null when it can. §09 asks that a
   *  disabled control explain itself rather than sitting there greyed out. */
  const blocked = !claim
    ? "Choose a claim from the paper first."
    : !chosenDataset ? "Choose a dataset to check the claim against."
    : null;

  return (
    <>
      <h1 className="rsn-title">Can this claim be tested here?</h1>
      <p className="lede">
        Read the recorded claim, add your judgment, then check the dataset. The
        claims are quoted from the paper; checking asks whether your data can
        test one, and computes nothing.
      </p>

      {/* The source pair, above everything, because both halves qualify every
          word below them. */}
      {/*
        * One pill per half, not a labelled box around a full-width control.
        *
        * UI_01 puts the kind, the name and the identifying meta on a single
        * line each, and the two together are one band 44px tall. Drawn as
        * bordered boxes with the label above and the select below they were
        * 100px, and the pair is the least interesting thing on a screen whose
        * subject is the claim.
        */}
      <div className="rsn-pair">
        <label className="rsn-slot">
          <span className="rsn-slot-icon" aria-hidden>▤</span>
          <span className="rsn-slot-kind">Paper</span>
          <select className="rsn-slot-pick" value={paper ?? ""}
                  onChange={(e) => void locate(e.target.value)}>
            <option value="" disabled>Choose a paper…</option>
            {papers.map((source) => (
              <option key={source.id} value={source.id}>{source.title}</option>
            ))}
          </select>
          {chosenPaper?.paper?.page_count != null && (
            <span className="rsn-slot-meta mono">
              {chosenPaper.paper.page_count} pages
            </span>
          )}
        </label>

        <label className="rsn-slot">
          <span className="rsn-slot-icon" aria-hidden>▥</span>
          <span className="rsn-slot-kind">Dataset</span>
          <select className="rsn-slot-pick" value={datasetId ?? ""}
                  onChange={(e) => setDatasetId(e.target.value)}>
            <option value="" disabled>Choose a dataset…</option>
            {datasets.map((source) => (
              <option key={source.id} value={source.id}>{source.title}</option>
            ))}
          </select>
          {/* The version and size actually on record, not a label. A claim
              tested against v1 and a claim tested against v2 are different
              results, and the screen has to say which is in play. */}
          {chosenDataset?.dataset && (
            <span className="rsn-slot-meta mono">
              v{chosenDataset.dataset.version} ·{" "}
              {chosenDataset.dataset.row_count.toLocaleString()} rows
            </span>
          )}
        </label>
      </div>

      <ol className="rsn-steps">
        {[
          { n: 1, label: "Choose claim" },
          { n: 2, label: "Match dataset" },
          { n: 3, label: "Review testability" },
        ].map((s) => (
          <li key={s.n} data-state={s.n < step ? "done" : s.n === step ? "here" : "ahead"}>
            <span className="rsn-step-n" aria-hidden>{s.n < step ? "✓" : s.n}</span>
            <span>{s.label}</span>
            <span className="sr-only">
              {s.n < step ? " — done" : s.n === step ? " — you are here" : " — not yet"}
            </span>
          </li>
        ))}
      </ol>

      {error ? <Failure error={error} /> : null}
      {busy && <Loading rows={2} label={busy} />}

      {located && located.claims.length === 0 && (
        <Empty title="No testable claim found" hint={located.note} />
      )}

      <div className="rsn-columns">
        <Filaments />
        {/* ---- left: the human half ------------------------------------ */}
        <section className="rsn-judgment" aria-labelledby="rsn-judgment-h">
          <h2 id="rsn-judgment-h" className="rsn-col-title">Your judgment</h2>
          <p className="rsn-col-kind">Human · appended notes</p>

          {!chosenPaper && <p className="note">Choose a paper to write about it.</p>}

          {chosenPaper && !chosenPaper.object_id && (
            /* Honest about the gap rather than offering a control that would
               fail: a source has no node in the graph until ingestion makes
               one, and the journal is addressed by that node. */
            <p className="note">
              This paper has no entry in the research graph yet, so there is
              nowhere to append a note. It appears once ingestion has recorded it.
            </p>
          )}

          {journal.notes.filter((n) => n.author_kind === "human").map((note) => (
            <article key={note.id} className="rsn-note">
              <p>{note.body}</p>
              <span className="rsn-note-by mono">{note.author}</span>
            </article>
          ))}

          {chosenPaper?.object_id && (
            <div className="rsn-append">
              <label className="sr-only" htmlFor="rsn-draft">Add a thought</label>
              <textarea
                id="rsn-draft"
                rows={2}
                placeholder="Add a thought…"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              <button
                className="btn"
                type="button"
                disabled={!draft.trim() || journal.busy !== null}
                onClick={() => { void journal.append(draft, journal.objectType).then((ok) => { if (ok) setDraft(""); }); }}
              >
                Append note
              </button>
              <p className="note">
                Notes are append-only and keep their author. Correct one by
                writing another.
              </p>
            </div>
          )}
          {journal.error != null && (
            <p className="note" role="status">That note could not be saved.</p>
          )}
        </section>

        {/* ---- centre: the working interpretation ----------------------- */}
        <section className="rsn-working" aria-labelledby="rsn-working-h">
          <h2 id="rsn-working-h" className="rsn-col-title sr-only">
            The working interpretation
          </h2>

          {!located && !busy && (
            <p className="note">Choose a paper above and its claims appear here.</p>
          )}

          {located && located.claims.length > 0 && !claim && (
            <>
              <p className="eyebrow">Working interpretation · choose one</p>
              {located.claims.map((c, i) => (
                <article
                  key={c.claim_id ?? i}
                  className="rsn-claim"
                  data-chosen={false}
                >
                  {/* The paper's words, quoted. Never paraphrased into
                      something the paper did not say (LAW 4). */}
                  <blockquote>{c.statement}</blockquote>
                  <p className="rsn-constructs">
                    <span className="rsn-role">Exposure</span>
                    <b className="mono">{c.exposure.replace(/_/g, " ")}</b>
                    <span aria-hidden> → </span>
                    <span className="rsn-role">Outcome</span>
                    <b className="mono">{c.outcome.replace(/_/g, " ")}</b>
                  </p>
                  <button className="btn" type="button" onClick={() => setClaim(c)}>
                    Work with this claim
                  </button>
                </article>
              ))}
            </>
          )}

          {claim && (
            <article className="rsn-claim" data-chosen>
              <p className="eyebrow">Working interpretation · {claim.claimed_design.replace(/_/g, " ")}</p>
              {/*
                * The constructs, not the sentence again.
                *
                * The master's centre carries a working interpretation distinct
                * from the paper's words, and this product has no such text:
                * a located claim is stored verbatim and nothing writes a
                * paraphrase of it. §09 forbids inventing an autosaving field
                * here, so rather than printing the quote twice — once
                * unanchored, which is the copy a reader would cite — the
                * centre shows what the claim maps to and asks the question.
                * The quote itself is on the right, under its anchor.
                */}
              <p className="rsn-constructs">
                <span className="rsn-role">Exposure</span>
                <b className="mono">{claim.exposure.replace(/_/g, " ")}</b>
                <span aria-hidden> → </span>
                <span className="rsn-role">Outcome</span>
                <b className="mono">{claim.outcome.replace(/_/g, " ")}</b>
              </p>

              <div className="rsn-verbs">
                <button
                  className="btn btn-primary"
                  type="button"
                  disabled={blocked !== null || busy !== null}
                  onClick={() => chosenDataset?.dataset
                    && void test(claim, chosenDataset.dataset.dataset_version_id)}
                >
                  Check testability
                </button>
                {chosenDataset && onOpenSource && (
                  <button className="btn" type="button"
                          onClick={() => onOpenSource(chosenDataset.id)}>
                    View dataset
                  </button>
                )}
              </div>
              <p className="note">
                {blocked ?? "Checks whether the data can test the claim. No analysis has run."}
              </p>
            </article>
          )}
        </section>

        {/* ---- right: the model's half --------------------------------- */}
        <section className="rsn-reading" aria-labelledby="rsn-reading-h">
          <h2 id="rsn-reading-h" className="rsn-col-title">Throughline&rsquo;s reading</h2>
          <p className="rsn-col-kind">
            Model-generated · {fromRecord ? "stored reading" : located ? "fresh reading" : "nothing read yet"}
          </p>

          {located && located.claims.length > 0 && (
            <>
              {/*
                * The quote appears once a claim is in play, and not before.
                *
                * While the researcher is still choosing, the claims are in the
                * centre where they are being read and compared; repeating one
                * of them here would put the same sentence on screen twice, and
                * the copy carrying the anchor — the citable one — would be the
                * copy nobody was looking at.
                *
                * The quote and the paraphrase are marked differently on
                * purpose. §09 forbids them a shared unlabelled treatment,
                * because a reader who mistakes one for the other is reading a
                * model's words as the paper's.
                */}
              {claim && (
                <>
                  <p className="rsn-quote-label">Quoted from the paper</p>
                  <blockquote className="rsn-quote">{claim.statement}</blockquote>
                  {claim.locator && (
                    <p className="rsn-anchor mono">
                      {claim.source_id ?? ""} · {claim.locator}
                    </p>
                  )}
                </>
              )}

              {fromRecord && (
                /*
                 * Said before anything else is read: these are a record of one
                 * reading, not a fresh opinion, and the model that produced
                 * them is part of what they are.
                 */
                <p className="note">
                  Read once already{located.model ? ` by ${located.model}` : ""}
                  {located.prompt ? ` (${located.prompt})` : ""}. Reading it again
                  can locate different claims — a different model, or the same one
                  at a different prompt, does — and anything already tested against
                  these rested on this reading.{" "}
                  <button type="button" className="btn"
                          disabled={busy !== null || !paper}
                          onClick={() => void read(paper!)}>
                    Read it again
                  </button>
                </p>
              )}

              <p className="rsn-provenance">
                Located by {located.model} · {located.prompt}. Claims are quoted
                from the paper and recorded as proposed — they are not findings.
              </p>
            </>
          )}

          {journal.notes.filter((n) => n.author_kind === "model").map((note) => (
            <article key={note.id} className="rsn-note" data-model>
              {note.prompt && <p className="rsn-note-q">{note.prompt}</p>}
              <p>{note.body}</p>
              <span className="rsn-note-by mono">
                {note.model ?? "model"} — written by a model
              </span>
            </article>
          ))}

          <div className="rsn-verbs">
            {chosenPaper && onOpenSource && (
              <button className="btn" type="button"
                      onClick={() => onOpenSource(chosenPaper.id)}>
                Open source
              </button>
            )}
          </div>

          {chosenPaper?.object_id && (
            /*
              * The master's label is "Ask about this claim" and this one says
              * paper, deliberately.
              *
              * The contextual-AI contract that exists is object-scoped:
              * `POST /objects/{id}/ask` assembles what the node is and what it
              * is recorded as, with no retrieval step, because a model handed
              * semantically similar prose uses it as though it were about this
              * object. A located claim is not a node, so the object in play is
              * the paper — and a control promising to ask about the claim,
              * while the model reads the paper, would misdescribe the one
              * thing §09 asks this screen to keep straight. The acceptance
              * spec allows a deviation required by real content as long as the
              * reason is recorded; this is the record.
              */
            <div className="rsn-append">
              <label className="sr-only" htmlFor="rsn-ask">Ask about this paper</label>
              <textarea
                id="rsn-ask"
                rows={2}
                placeholder="Ask about this paper…"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
              />
              <button
                className="btn"
                type="button"
                disabled={!question.trim() || journal.busy !== null}
                onClick={() => { void journal.ask(question).then((ok) => { if (ok) setQuestion(""); }); }}
              >
                Ask about this paper
              </button>
              <p className="note">
                The model is given what this paper is recorded as, and not the
                claim you are working with. The answer is stored as a model
                note, never as yours.
              </p>
            </div>
          )}
        </section>
      </div>

      {/* The state of the pair, in one line, where the master puts it. */}
      <p className="rsn-footer mono">
        {claim?.claim_id ? `Source claim ${claim.claim_id}` : "No claim chosen"}
        {" · "}
        {chosenDataset?.dataset
          ? `Dataset v${chosenDataset.dataset.version}`
          : "No dataset chosen"}
        {" · "}
        {result ? `Testability ${result.verdict.outcome}` : "Testability pending"}
      </p>

      {result && claim && (
        <VerdictCard
          verdict={result.verdict}
          subject={<>against <b>{result.dataset.name}</b></>}
        >
          <Steps result={result} claim={claim} />
          {/* The refusal that names this control is the one directly above it.
              A remedy the researcher has to go and find somewhere else is a
              remedy most researchers do not carry out. */}
          {missingContext(result).length > 0 && (
            <RecordStudyContext
              datasetVersionId={result.dataset.id}
              datasetName={result.dataset.name}
              missing={missingContext(result)}
              onRecorded={() => void test(claim, result.dataset.id)}
            />
          )}
        </VerdictCard>
      )}
    </>
  );
}

/**
 * What this dataset does not say about itself, in the order the checks need it.
 *
 * Only ever what is actually absent: offering to record a period that is
 * already recorded would make the form look like busywork and hide the field
 * that is genuinely blocking the check.
 */
export function missingContext(result: Result): string[] {
  const missing: string[] = [];
  if (result.dataset.design === "unknown") missing.push("design");
  for (const unchecked of result.unchecked) {
    if (unchecked.includes("Population scope")
        && !unchecked.includes("not recorded on the paper.")) {
      missing.push("population");
    }
    if (unchecked.includes("Temporal scope")) missing.push("period");
  }
  return missing;
}

/**
 * The three steps of the claim test, drawn as a sequence.
 *
 * A researcher needs to see *which* step stopped it, because the three failures
 * mean completely different things: a missing mapping is a chore, a design
 * mismatch is a fact about the question, and circularity is a warning about the
 * paper. Collapsing them into one "no" would throw that away.
 */
function Steps({ result, claim }: { result: Result; claim: Claim }) {
  const code = result.verdict.outcome;
  const failedAt =
    code === "P7" ? 0 : code === "P8" ? 1 : code === "P9" || code === "D14" ? 2
    : code === "P10" || code === "P11" ? 3 : -1;

  const steps = [
    { name: "Written independently of this data",
      detail: code === "P7" ? result.verdict.sentence
        : claim.source_id ? "No sign the paper was written from this dataset."
        : "Not checked — the claim was not linked to a paper." },
    { name: "Constructs measured here",
      detail: result.exposure_column
        ? `${claim.exposure.replace(/_/g, " ")} → ${result.exposure_column}, `
          + `${claim.outcome.replace(/_/g, " ")} → ${result.outcome_column}`
        : result.verdict.sentence },
    { name: "Design can carry the claim",
      detail: `${claim.claimed_design.replace(/_/g, " ")} claim, `
        + `${result.dataset.design.replace(/_/g, " ")} data` },
    { name: "Scope overlaps",
      detail: result.unchecked.length
        ? result.unchecked.join(" ")
        : "Population and period overlap." },
  ];

  return (
    <ol className="ct-steps">
      {steps.map((step, index) => {
        const state = failedAt === index ? "failed"
          : failedAt >= 0 && index > failedAt ? "skipped"
          : step.detail.startsWith("Not checked") || step.detail.includes("not checked")
          ? "unchecked" : "passed";
        return (
          <li key={step.name} data-state={state}
              style={{ animationDelay: `${Math.min(index * 70, 300)}ms` }}>
            <span className="ct-mark" aria-hidden>
              {state === "passed" ? "✓" : state === "failed" ? "✕"
                : state === "unchecked" ? "·" : "–"}
            </span>
            <div>
              <b>{step.name}</b>
              <span className="sr-only">
                {state === "passed" ? " — passed"
                  : state === "failed" ? " — this is where it stopped"
                  : state === "unchecked" ? " — not checked"
                  : " — not reached"}
              </span>
              <p>{step.detail}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
