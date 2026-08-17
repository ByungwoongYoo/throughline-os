"use client";

/**
 * Sources the world has taken back, and what in this project still rests on them.
 *
 * The system already knew this and could not tell anyone. Harvesting marks a
 * source withdrawn instead of deleting it — right, because by then it may be
 * quoted or cited, and deleting it destroys both the reference and the evidence
 * that it was withdrawn — but the mark had no reader, then no route, and until
 * now no screen. A retracted paper could sit in a corpus, be quoted verbatim,
 * be cited in an exported report, and nothing anywhere would say so.
 *
 * Three decisions about how it appears, each of which could reasonably have gone
 * the other way.
 *
 * **Drafts are named, not counted.** "3 artifacts affected" is a number to
 * scroll past. "Draft for Lancet ID" is a document somebody has to open before
 * they submit it. The count is what you skim; the title is what makes you act.
 *
 * **This is not styled as an alarm.** No red, no siren, no modal. A withdrawal
 * is usually an embargo or a correction, and a screen that shouts retraction
 * gets dismissed the first time it is wrong — after which it is furniture, and
 * the one time it matters it will be dismissed too.
 *
 * **Nothing here offers to fix it.** There is no "remove this source" button,
 * because the right response depends entirely on why the record was withdrawn,
 * and this software does not know why. Deciding that on the researcher's behalf
 * would be exactly the kind of confident wrong move the rest of the system
 * refuses to make.
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Empty, Failure, Loading } from "./primitives";

type Artifact = { id: string; title: string };

type Withdrawn = {
  id: string;
  title: string;
  withdrawn_at: string | null;
  withdrawn_reason: string;
  oai_identifier: string | null;
  citations: number;
  extractions: number;
  artifacts: Artifact[];
  artifacts_count: number;
};

type Report = { withdrawn: Withdrawn[]; note: string };

export function WithdrawnSources({ projectId }: { projectId: string }) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let live = true;
    setReport(null);
    setError(null);
    api.get<Report>(`/api/projects/${projectId}/withdrawn`)
      .then((body) => { if (live) setReport(body); })
      .catch((err) => { if (live) setError(err); });
    return () => { live = false; };
  }, [projectId]);

  if (error) return <Failure error={error} />;
  if (!report) return <Loading label="Checking what has been withdrawn upstream" />;

  if (report.withdrawn.length === 0) {
    return (
      <Empty
        title="Nothing here has been withdrawn"
        // Deliberately not "all clear". This is only as true as the last
        // harvest — repositories are not asked between runs, and implying
        // otherwise would be a claim the data cannot support.
        hint={report.note}
      />
    );
  }

  return (
    <section aria-labelledby="withdrawn-heading">
      <h3 id="withdrawn-heading" className="eyebrow">Withdrawn upstream</h3>
      <p style={{ fontSize: 13, margin: "0 0 16px", color: "var(--ink-faint)" }}>
        {report.note}
      </p>

      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {report.withdrawn.map((source) => (
          <li key={source.id} className="card" style={{ marginBottom: 12 }}>
            <p style={{ fontWeight: 560, margin: "0 0 4px" }}>{source.title}</p>

            <p style={{ fontSize: 12, color: "var(--ink-faint)", margin: "0 0 8px" }}>
              {source.withdrawn_reason}
            </p>

            {/*
              The blast radius, most consequential first. A source cited in a
              draft is a different problem from one nothing references, and
              collapsing them into a single "withdrawn" badge loses the only
              part a researcher has to act on.
            */}
            {source.artifacts.length > 0 ? (
              <div>
                <p style={{ fontSize: 12, margin: "0 0 4px", fontWeight: 560 }}>
                  Cited in written work:
                </p>
                <ul style={{ margin: "0 0 8px 16px", padding: 0, fontSize: 12 }}>
                  {source.artifacts.map((artifact) => (
                    <li key={artifact.id}>{artifact.title}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p style={{ fontSize: 12, margin: "0 0 8px", color: "var(--ink-faint)" }}>
                Not cited in any written work yet.
              </p>
            )}

            <p style={{ fontSize: 12, color: "var(--ink-faint)", margin: 0 }}>
              {source.citations} citation{source.citations === 1 ? "" : "s"}
              {source.extractions > 0 &&
                ` · read into ${source.extractions} extraction${source.extractions === 1 ? "" : "s"}`}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
