"use client";

/**
 * What the critic argued against a finding, and what it checked to get there.
 *
 * The critic already ran, recorded a verdict, and could move a finding's
 * lifecycle. None of that was visible. A researcher saw a finding quietly
 * marked weaker with no way to ask why — the system had taken the judgement and
 * kept the argument, which is the failure the critic exists to prevent rather
 * than perform.
 *
 * The probes are the point. A verdict is a conclusion, and a conclusion without
 * its working is something you either accept or ignore; neither is what a
 * researcher should do with it. Showing which checks ran and what each found is
 * what makes it arguable — and a critic you can argue with is one you can
 * overrule when it is wrong, which it sometimes will be.
 *
 * The verdict word is deliberately not colour-coded to a severity scale. The
 * critic's own vocabulary — holds, weakens, uncertain, disappears — is more
 * precise than any three-colour mapping, and turning "uncertain" amber trains a
 * reader to scan for red rather than to read the sentence.
 */

import { useState } from "react";
import { ApiError, api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { Empty, Failure, Fold, Loading } from "./primitives";

type Probe = {
  name?: string;
  outcome?: string;
  detail?: string;
};

type Challenge = {
  id: string;
  verdict: string | null;
  summary: string;
  probes: Probe[];
  lifecycle_before: string | null;
  lifecycle_after: string | null;
  created_at: string;
  finished_at: string | null;
};

type Report = { finding_id: string; challenges: Challenge[]; note: string };

/**
 * Ask the critic to argue against this finding.
 *
 * `POST /findings/{id}/challenge` had no caller, so the empty state below —
 * *"No critic has run against it yet. That is not the same as it having
 * survived one."* — was permanently true and nothing could change it. The
 * screen displayed an adversarial process nobody could start.
 *
 * The run happens in a worker, so this polls rather than waiting: the critic
 * runs several sandboxed analyses and a request that blocked on all of them
 * would time out long before they finished.
 */
function RunChallenge({ findingId, onFinished }: {
  findingId: string;
  onFinished: () => void;
}) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    try {
      await api.post(`/api/findings/${findingId}/challenge`, { confounders: [] });
      for (let i = 0; i < 20; i += 1) {
        await new Promise((r) => setTimeout(r, 2000));
        onFinished();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div>
      <button className="btn" disabled={running} onClick={() => void run()}>
        {running ? "The critic is working…" : "Argue against this finding"}
      </button>
      {error && <div className="notice" role="alert">{error}</div>}
    </div>
  );
}

export function Challenges({ projectId, findingId }: {
  projectId: string;
  findingId: string;
}) {
  const { data, error, loading, reload } = useApi<Report>(
    `/api/projects/${projectId}/findings/${findingId}/challenges`,
  );

  if (error) return <Failure error={error} retry={reload} />;
  if (loading || !data) {
    return <Loading rows={2} label="Reading what has been argued against this" />;
  }

  if (data.challenges.length === 0) {
    return (
      // "none" on the summary, which is the fact; the sentence that keeps it
      // from being read as "this finding is sound" is the first thing inside.
      <Fold summary="Challenges to this finding" count={0}>
      <Empty
        title="Nothing has challenged this finding"
        // Not "this finding is sound". Nobody has argued against it, which is a
        // different and much weaker statement — and conflating the two is how a
        // finding acquires authority it was never given.
        hint="No critic has run against it yet. That is not the same as it having survived one."
        action={<RunChallenge findingId={findingId} onFinished={reload} />}
      />
      </Fold>
    );
  }

  return (
    <section aria-labelledby="challenges-heading">
      <h2 id="challenges-heading">Challenges</h2>
      <Fold summary="What a challenge is, and what surviving one means"
            count={data.challenges.length}>
        <p className="note" style={{ marginTop: 0 }}>{data.note}</p>
      </Fold>

      {/* Running it again is legitimate: the evidence behind a finding changes,
          and a verdict from before that change is a verdict about a different
          finding. */}
      <div style={{ marginBottom: 12 }}>
        <RunChallenge findingId={findingId} onFinished={reload} />
      </div>

      {data.challenges.map((challenge) => (
        <article className="card" key={challenge.id} style={{ marginBottom: 12 }}>
          <div className="row" style={{ marginBottom: 6 }}>
            <span className="mono" style={{ fontWeight: 560 }}>
              {challenge.verdict ?? "in progress"}
            </span>
            {/*
              A lifecycle change is the consequential part: it is the moment the
              system acted on its own argument. Shown next to the verdict rather
              than buried, so the reader sees what it did and not only what it
              thought.
            */}
            {challenge.lifecycle_after &&
             challenge.lifecycle_after !== challenge.lifecycle_before && (
              <span className="mono" style={{ color: "var(--ink-faint)" }}>
                moved {challenge.lifecycle_before} → {challenge.lifecycle_after}
              </span>
            )}
          </div>

          {challenge.summary && (
            <p style={{ margin: "0 0 10px" }}>{challenge.summary}</p>
          )}

          {challenge.probes.length > 0 ? (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
              {challenge.probes.map((probe, index) => (
                <li key={index} style={{ marginBottom: 4 }}>
                  <span className="mono">{probe.name ?? "check"}</span>
                  {probe.outcome && (
                    <span style={{ color: "var(--ink-faint)" }}> · {probe.outcome}</span>
                  )}
                  {probe.detail && <div>{probe.detail}</div>}
                </li>
              ))}
            </ul>
          ) : (
            // Says which half is missing. "No detail recorded" would leave the
            // reader unable to tell an unargued verdict from a display bug.
            <p style={{ fontSize: 12, color: "var(--ink-faint)", margin: 0 }}>
              This challenge recorded a verdict without the checks behind it.
            </p>
          )}
        </article>
      ))}
    </section>
  );
}
