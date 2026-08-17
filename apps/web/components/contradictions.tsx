"use client";

/**
 * Results in this project that disagree, and why they might (§55).
 *
 * The overview has always carried a **Contradictions** meter. It read from a
 * table nothing ever wrote to, so it displayed zero for every project that has
 * ever existed. Zero reads as "nothing here disagrees"; the truth was "nobody
 * checked". Of the two, the false one was the reassuring one, which is the worst
 * way round for a number to be wrong.
 *
 * **The ranked explanations carry their own state, and it is not decoration.**
 * The adjudicator stops at the first check that fires, so of the seven possible
 * reasons two results differ, some were genuinely excluded and the rest were
 * never examined. Rendering those the same way would tell a researcher the
 * system had ruled out a possibility it never considered — the most misleading
 * thing this screen could do, and invisible unless the states are drawn apart.
 *
 * **Nothing offers to pick a winner.** A contradiction under multiplicity says
 * how much looking produced these results, not which one to keep. A "use this
 * one" button would be the software inventing the most useful-looking answer,
 * which is exactly what the verdict taxonomy exists to prevent.
 *
 * **Closing one requires typing why.** The reason is the whole value of the
 * record: a contradiction closed with a reason is research, and one closed
 * without is a badge being cleared. The button stays disabled until there is
 * something in the box, so the difference is not left to good intentions.
 */

import { useState } from "react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { Failure, Loading } from "./primitives";

type Explanation = {
  rank: number;
  code: string;
  explanation: string;
  state: "the_explanation" | "ruled_out" | "not_examined";
};

type Contradiction = {
  id: string;
  description: string;
  explanations: Explanation[];
  status: string;
  resolved_note: string;
  left_ref_id: string;
  right_ref_id: string;
};

type Ledger = {
  contradictions: Contradiction[];
  open: number;
  note: string;
};

export function Contradictions({ projectId }: { projectId: string }) {
  const { data, error, loading, reload } = useApi<Ledger>(
    `/api/projects/${projectId}/contradictions`, [projectId],
  );
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);

  async function sweep() {
    setBusy(true);
    setFailure(null);
    try {
      await api.post(`/api/projects/${projectId}/contradictions/sweep`, {});
      reload();
    } catch (err) {
      setFailure(err);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <Failure error={error} retry={reload} />;
  if (loading || !data) {
    return <Loading rows={2} label="Reading recorded disagreements" />;
  }

  return (
    <section aria-labelledby="contradictions-heading" style={{ marginTop: 20 }}>
      <h3 id="contradictions-heading" className="eyebrow">Disagreements</h3>
      <p style={{ fontSize: 13, margin: "0 0 12px", color: "var(--ink-faint)" }}>
        {data.note}
      </p>

      {failure != null && <Failure error={failure} retry={sweep} />}

      {/*
        The sweep is offered rather than run on load. It compares every pair of
        results in the project, and a read that silently did that would make
        opening a screen an expensive write.
      */}
      <button type="button" className="btn" onClick={sweep} disabled={busy}>
        {busy ? "Comparing results…" : "Compare results now"}
      </button>

      <ul style={{ listStyle: "none", padding: 0, margin: "16px 0 0" }}>
        {data.contradictions.map((item) => (
          <li key={item.id} className="card" style={{ marginBottom: 12 }}>
            <p style={{ margin: "0 0 8px" }}>{item.description}</p>
            <Explanations items={item.explanations} />
            <Close projectId={projectId} contradiction={item} onDone={reload} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Explanations({ items }: { items: Explanation[] }) {
  const examined = items.filter((item) => item.state !== "not_examined");
  const unexamined = items.filter((item) => item.state === "not_examined");

  return (
    <div style={{ fontSize: 12, marginBottom: 10 }}>
      <p style={{ fontWeight: 560, margin: "0 0 4px" }}>
        Why these might differ, most likely first:
      </p>
      <ol style={{ margin: "0 0 6px 16px", padding: 0 }}>
        {examined.map((item) => (
          <li key={item.code}
              style={{ color: item.state === "the_explanation"
                         ? "inherit" : "var(--ink-faint)" }}>
            {item.explanation}
            {item.state === "ruled_out"
              ? " — checked, does not apply"
              : " — this is the one that holds"}
          </li>
        ))}
      </ol>

      {/*
        Kept out of the ranked list entirely, not greyed inside it. These were
        never evaluated, because something above them already explained the
        divergence — and a reader skimming a single list would take every line
        in it as a check that ran.
      */}
      {unexamined.length > 0 && (
        <p style={{ color: "var(--ink-faint)", margin: 0 }}>
          Not examined, because the explanation above settles it:{" "}
          {unexamined.map((item) => item.explanation).join("; ")}.
        </p>
      )}
    </div>
  );
}

function Close({ projectId, contradiction, onDone }: {
  projectId: string;
  contradiction: Contradiction;
  onDone: () => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);

  if (contradiction.status !== "open") {
    return (
      <p style={{ fontSize: 12, color: "var(--ink-faint)", margin: 0 }}>
        Closed: {contradiction.resolved_note}
      </p>
    );
  }

  async function close() {
    setBusy(true);
    setFailure(null);
    try {
      await api.post(
        `/api/projects/${projectId}/contradictions/${contradiction.id}`,
        { status: "resolved", note });
      onDone();
    } catch (err) {
      setFailure(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {failure != null && <Failure error={failure} retry={close} />}
      <label style={{ fontSize: 12, display: "block", marginBottom: 4 }}>
        Why is this not a disagreement?
        <input value={note} onChange={(event) => setNote(event.target.value)}
               style={{ display: "block", width: "100%", marginTop: 4 }} />
      </label>
      {/*
        Disabled until there is a reason. The domain refuses an empty one and
        would return a 400, but a button that can be pressed and then fails
        teaches people the reason is a formality — which is exactly the habit
        that turns closing a contradiction into clearing a badge.
      */}
      <button type="button" className="btn" onClick={close}
              disabled={busy || !note.trim()}>
        Close this
      </button>
    </div>
  );
}
