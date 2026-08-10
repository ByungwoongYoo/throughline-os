"use client";

/**
 * Patterns and key findings.
 *
 * The screen is laid out to be read in one order, and the order is the argument.
 *
 * **Multiplicity comes first.** How much looking produced these results changes
 * what every one of them means, and it is the single fact a researcher never
 * has to hand. Putting it at the top is not a caveat banner — it is the frame
 * the rest of the page is read inside.
 *
 * **Each key finding carries what argues against it, inline.** LAW 3. A caveat
 * in a separate section is a caveat nobody reads, so a near-perfect correlation
 * arrives already carrying "these are probably one quantity measured twice".
 *
 * **Every pattern shows why it is not a finding.** The most dangerous thing this
 * screen could do is look like a list of discoveries. It is a list of shapes.
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Empty, Failure, Loading } from "./primitives";
import { VerdictBody, VerdictCard } from "./Verdict";
import { SpecificationCurve } from "./speccurve";

type Pattern = {
  kind: string;
  variables: string[];
  headline: string;
  reading?: string;
  not_a_finding_because?: string;
  partners?: string[];
  third_variables?: string[];
  share_of_its_tests?: number;
  verdict?: VerdictBody;
  evidence_refs: string[];
};

type Multiplicity = {
  tests_run: number;
  survived_correction: number;
  false_discovery_rate: number;
  expected_false_among_survivors: number;
  discovery_runs: number;
  note: string;
};

type Detected = {
  multiplicity: Multiplicity;
  patterns: Record<string, Pattern[]>;
  pattern_count: number;
  connections_examined: number;
  canonical_coverage: number;
  note: string;
};

type KeyFinding = {
  connection_id: string;
  variables: string[];
  direction: string;
  lifecycle_status: string;
  evidence_quality: string;
  sample_size: number | null;
  canonical: boolean;
  supporting_patterns: Pattern[];
  contradicting_patterns: Pattern[];
  other_patterns: Pattern[];
  read_with: string;
};

type Findings = {
  multiplicity: Multiplicity;
  findings: KeyFinding[];
  survivors: number;
  note: string;
};

const GROUP_TITLE: Record<string, string> = {
  probably_the_same_quantity: "Probably one quantity, measured twice",
  recurring_variables: "Variables that keep turning up",
  across_datasets: "Across more than one dataset",
  candidate_confounders: "Third variables worth adjusting for",
  contradictions: "Results that disagree",
};

export function Patterns({ projectId, datasetVersionId, columns }: {
  projectId: string;
  datasetVersionId?: string | null;
  columns?: string[];
}) {
  // Two questions about the same thing: what shape do the results have, and
  // would any one of them survive a different covariate set. They belong on one
  // screen because a researcher who reads the first will immediately want the
  // second about whatever caught their eye.
  const [view, setView] = useState<"patterns" | "robustness">("patterns");
  const [detected, setDetected] = useState<Detected | null>(null);
  const [findings, setFindings] = useState<Findings | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    Promise.all([
      api.get<Detected>(`/api/projects/${projectId}/patterns`),
      api.get<Findings>(`/api/projects/${projectId}/key-findings`),
    ])
      .then(([d, f]) => { if (live) { setDetected(d); setFindings(f); } })
      .catch((err) => { if (live) setError(err); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [projectId]);

  const tabs = (
    <div className="cmp-verbs" role="tablist" aria-label="What to look at">
      {([["patterns", "Across the project"],
         ["robustness", "Would it survive?"]] as const).map(([id, label]) => (
        <button key={id} role="tab" aria-selected={view === id}
                className="cmp-verb" onClick={() => setView(id)}>
          {label}
        </button>
      ))}
    </div>
  );

  if (view === "robustness") {
    return (
      <>
        <h1>Patterns</h1>
        {tabs}
        <SpecificationCurve
          projectId={projectId}
          datasetVersionId={datasetVersionId ?? null}
          columns={columns ?? []}
        />
      </>
    );
  }

  if (loading) return <Loading rows={5} label="Reading every result in this project" />;
  if (error) return <Failure error={error} />;
  if (!detected || !findings) return null;

  const empty = detected.pattern_count === 0 && findings.findings.length === 0;

  return (
    <>
      <h1>Patterns</h1>
      {tabs}
      <p className="lede">
        What the shape of this project&rsquo;s results looks like taken together.
        Nothing here is a new test — every number was computed under correction
        already.
      </p>

      <Multiplicity context={detected.multiplicity} />

      {empty ? (
        <Empty
          title="Nothing to see yet"
          hint="Run discovery on a dataset and the patterns across its results will appear here."
        />
      ) : (
        <>
          {findings.findings.length > 0 && (
            <section className="pat-section">
              <h2>Worth your attention</h2>
              <p className="pat-sub">{findings.note}</p>
              {findings.findings.map((finding) => (
                <KeyFindingCard key={finding.connection_id} finding={finding} />
              ))}
            </section>
          )}

          {Object.entries(detected.patterns).map(([group, list]) =>
            list.length === 0 ? null : (
              <section className="pat-section" key={group}>
                <h2>{GROUP_TITLE[group] ?? group.replace(/_/g, " ")}</h2>
                {list.map((pattern, index) =>
                  pattern.verdict ? (
                    // A contradiction is a verdict, not an observation, so it
                    // renders as one — same card as every other adjudication.
                    <VerdictCard
                      key={index}
                      verdict={pattern.verdict}
                      subject={<>{pattern.variables.join(" and ")}</>}
                    />
                  ) : (
                    <PatternCard key={index} pattern={pattern} />
                  ))}
              </section>
            ))}

          <p className="pat-foot">
            {detected.connections_examined.toLocaleString()} results examined,{" "}
            {detected.canonical_coverage.toLocaleString()} of them in confirmed
            canonical variables. {detected.note}
          </p>
        </>
      )}
    </>
  );
}

/**
 * The frame, not a footnote. This is read before anything else on the page
 * because it changes what everything else means.
 */
function Multiplicity({ context }: { context: Multiplicity }) {
  if (!context.tests_run) {
    return <p className="pat-multiplicity pat-quiet">{context.note}</p>;
  }
  return (
    <aside className="pat-multiplicity">
      <div className="pat-counts">
        <span>
          <b className="numeric">{context.tests_run.toLocaleString()}</b>
          comparisons run
        </span>
        <span>
          <b className="numeric">{context.survived_correction}</b>
          survived correction
        </span>
        <span>
          {/* The number that makes this honest rather than impressive. */}
          <b className="numeric">
            ≈{context.expected_false_among_survivors}
          </b>
          expected to be noise
        </span>
      </div>
      <p>{context.note}</p>
    </aside>
  );
}

function KeyFindingCard({ finding }: { finding: KeyFinding }) {
  return (
    <article className="pat-finding">
      <header>
        <h3>
          {finding.variables[0].replace(/_/g, " ")}
          <span className="pat-arrow">
            {finding.direction === "negative" ? " ↘ " : " ↗ "}
          </span>
          {finding.variables[1].replace(/_/g, " ")}
        </h3>
        <p className="pat-meta">
          {finding.lifecycle_status.replace(/_/g, " ")} ·{" "}
          {finding.evidence_quality?.replace(/_/g, " ")}
          {finding.sample_size ? ` · n = ${finding.sample_size.toLocaleString()}` : ""}
          {!finding.canonical && (
            <span className="pat-warn">
              {" "}· named by column, not by a confirmed variable
            </span>
          )}
        </p>
      </header>

      <p className="pat-read">{finding.read_with}</p>

      {/* LAW 3 — what argues against it sits with it, not in an appendix. */}
      {finding.contradicting_patterns.length > 0 && (
        <div className="pat-against">
          <h4 className="eyebrow">What argues against this</h4>
          {finding.contradicting_patterns.map((pattern, i) => (
            <p key={i}>
              <b>{pattern.headline}.</b>{" "}
              {pattern.not_a_finding_because ?? pattern.reading}
            </p>
          ))}
        </div>
      )}

      {finding.supporting_patterns.length > 0 && (
        <div className="pat-for">
          <h4 className="eyebrow">What supports it</h4>
          {finding.supporting_patterns.map((pattern, i) => (
            <p key={i}>
              <b>{pattern.headline}.</b> {pattern.not_a_finding_because}
            </p>
          ))}
        </div>
      )}

      {finding.other_patterns.length > 0 && (
        <div className="pat-other">
          <h4 className="eyebrow">Also worth knowing</h4>
          {finding.other_patterns.map((pattern, i) => (
            <p key={i}>{pattern.headline}.</p>
          ))}
        </div>
      )}
    </article>
  );
}

function PatternCard({ pattern }: { pattern: Pattern }) {
  return (
    <article className="pat-card">
      <h3>{pattern.headline}</h3>
      {pattern.reading && <p className="pat-reading">{pattern.reading}</p>}

      {pattern.partners && pattern.partners.length > 0 && (
        <p className="pat-partners">
          with {pattern.partners.map((p) => p.replace(/_/g, " ")).join(", ")}
        </p>
      )}
      {pattern.third_variables && pattern.third_variables.length > 0 && (
        <p className="pat-partners">
          via {pattern.third_variables.map((p) => p.replace(/_/g, " ")).join(", ")}
        </p>
      )}

      {/* Never optional. The most dangerous thing this screen could do is look
          like a list of discoveries. */}
      {pattern.not_a_finding_because && (
        <p className="pat-why-not">
          <span className="eyebrow">Why this is not a finding</span>
          {pattern.not_a_finding_because}
        </p>
      )}
    </article>
  );
}
