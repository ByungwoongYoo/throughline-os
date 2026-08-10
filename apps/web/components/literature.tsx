"use client";

/**
 * Literature search across several databases at once.
 *
 * The design problem here is not the search box, it is what to do when four
 * upstream APIs disagree — which they do constantly. arXiv has the preprint
 * year, Crossref the version of record; OpenAlex expands author initials,
 * PubMed does not.
 *
 * Two decisions follow from that.
 *
 * **A disagreement is shown, not resolved.** Where the databases differ, the
 * preferred value is displayed with the others underneath it and the source
 * named. Silently picking one is how a bibliography ends up with a date nobody
 * can defend to a reviewer.
 *
 * **A source that fails is reported beside the results that arrived**, never as
 * an error page. A researcher searching four databases should not lose three
 * because one is having an outage — and they need to know which one was
 * missing, because "no results in PubMed" and "PubMed did not answer" are
 * different facts.
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Empty, Failure, Loading } from "./primitives";
import { SourceChip, SourceMark } from "./SourceMark";

type Disagreement = {
  preferred: { value: unknown; source: string };
  also_reported: Array<{ value: unknown; source: string }>;
};

type Paper = {
  title: string;
  authors: string[];
  year: number | null;
  doi: string | null;
  arxiv_id: string | null;
  pmid: string | null;
  venue: string;
  abstract: string;
  url: string;
  pdf_url: string;
  open_access: boolean | null;
  cited_by: number | null;
  source: string;
  provenance: { [field: string]: string };
  disagreements: { [field: string]: Disagreement };
};

type Results = {
  query: string;
  results: Paper[];
  sources: { [name: string]: { ok: boolean; count: number; note: string | null } };
  found: number;
  returned_by_sources: number;
  note: string;
};

type Capability = {
  name: string; ready: boolean; polite: boolean; rate_per_second: number;
  note: string | null;
};

export function Literature({ projectId }: { projectId: string }) {
  const [query, setQuery] = useState("");
  const [capabilities, setCapabilities] = useState<Capability[] | null>(null);
  const [results, setResults] = useState<Results | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [imported, setImported] = useState<Set<string>>(new Set());

  useEffect(() => {
    api.get<{ sources: Capability[] }>("/api/literature/sources")
      .then((r) => setCapabilities(r.sources))
      .catch(() => setCapabilities(null));
  }, []);

  async function search() {
    if (query.trim().length < 2) return;
    setBusy(true); setError(null); setResults(null);
    try {
      setResults(await api.post<Results>("/api/literature/search",
                                         { query, limit: 20 }));
    } catch (err) { setError(err); } finally { setBusy(false); }
  }

  async function add(record: Paper) {
    const key = record.doi || record.arxiv_id || record.pmid || record.title;
    try {
      await api.post(`/api/projects/${projectId}/literature/import`, record);
      setImported((current) => new Set(current).add(key));
    } catch (err) { setError(err); }
  }

  return (
    <>
      <h1>Find papers</h1>
      <p className="lede">
        Searches OpenAlex, Crossref, arXiv and PubMed at once. Records that
        appear in more than one are merged — and where the databases disagree,
        every version is kept rather than quietly resolved.
      </p>

      <div className="lit-search">
        <label className="sr-only" htmlFor="lit-q">Search literature</label>
        <input
          id="lit-q"
          value={query}
          placeholder="antibiotic consumption and resistance"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") void search(); }}
        />
        <button className="nj-primary" disabled={busy} onClick={() => void search()}>
          {busy ? "Searching…" : "Search"}
        </button>
      </div>

      {capabilities && (
        <p className="lit-caps">
          {capabilities.map((c) => (
            <SourceChip key={c.name} name={c.name} polite={c.polite}
                        note={c.polite ? null
                              : "No contact address, so this source gives us a "
                                + "slower rate limit. Add one in Settings."} />
          ))}
        </p>
      )}

      {error ? <Failure error={error} /> : null}
      {busy && <Loading rows={4} label="Asking four databases" />}

      {results && (
        <>
          {/* Per-source status, always. "No results in PubMed" and "PubMed did
              not answer" are different facts and must not look alike. */}
          <div className="lit-status">
            {Object.entries(results.sources).map(([name, status]) => (
              <SourceChip key={name} name={name} ok={status.ok}
                          count={status.count} note={status.note} />
            ))}
          </div>

          {results.results.length === 0 ? (
            <Empty title="Nothing found"
                   hint="Try fewer or more general terms." />
          ) : (
            <>
              <p className="lit-summary">
                {results.found} papers from {results.returned_by_sources} records.{" "}
                {results.note}
              </p>

              <ol className="lit-results">
                {results.results.map((record, index) => {
                  const key = record.doi || record.arxiv_id
                    || record.pmid || record.title;
                  const disagreements = Object.entries(record.disagreements);
                  return (
                    <li key={index}>
                      <article className="lit-record">
                        <h3>{record.title}</h3>
                        <p className="lit-meta">
                          {record.authors.slice(0, 4).join(", ")}
                          {record.authors.length > 4 && " et al."}
                          {record.year && ` · ${record.year}`}
                          {record.venue && ` · ${record.venue}`}
                          {record.cited_by !== null && (
                            <span className="numeric">
                              {" "}· cited {record.cited_by.toLocaleString()}
                            </span>
                          )}
                        </p>

                        {record.abstract && (
                          <p className="lit-abstract">
                            {record.abstract.slice(0, 340)}
                            {record.abstract.length > 340 && "…"}
                          </p>
                        )}

                        {disagreements.length > 0 && (
                          // The half a citation manager throws away.
                          <details className="lit-disagree">
                            <summary>
                              The databases disagree on{" "}
                              {disagreements.map(([f]) => f).join(", ")}
                            </summary>
                            {disagreements.map(([field, value]) => (
                              <p key={field}>
                                <b>{field}</b>: using{" "}
                                <q>{String(value.preferred.value)}</q> from{" "}
                                {value.preferred.source}
                                {value.also_reported.map((other, i) => (
                                  <span key={i}>
                                    ; {other.source} says{" "}
                                    <q>{String(other.value)}</q>
                                  </span>
                                ))}
                              </p>
                            ))}
                          </details>
                        )}

                        <footer className="lit-actions">
                          <span className="lit-found">
                            {/* The mark of every database that returned this
                                record, so a merge is visible at a glance. */}
                            {record.source.split("+").map((name) => (
                              <SourceMark key={name} name={name.trim()} size={15} />
                            ))}
                            found via {record.source.replace(/\+/g, " + ")}
                          </span>
                          {record.open_access && (
                            <span className="lit-oa">open access</span>
                          )}
                          {record.url && (
                            <a href={record.url} target="_blank"
                               rel="noreferrer noopener">Open</a>
                          )}
                          <button
                            className="ct-dataset"
                            disabled={imported.has(key)}
                            onClick={() => void add(record)}
                          >
                            {imported.has(key) ? "In this project" : "Add"}
                          </button>
                        </footer>
                      </article>
                    </li>
                  );
                })}
              </ol>

              <p className="pat-foot">
                Only metadata is imported. Fetching a PDF is a separate,
                deliberate act — this never routes around a paywall, and where a
                paper is open access it says so rather than fetching it for you.
              </p>
            </>
          )}
        </>
      )}
    </>
  );
}
