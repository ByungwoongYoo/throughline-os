"use client";

/**
 * Searching dataset repositories.
 *
 * Kept separate from `literature.tsx` rather than added as more sources to it,
 * because a dataset and a paper are different objects and the difference is the
 * whole point of this screen. A paper is cited; a dataset is computed on. So
 * the row here leads with licence, file formats and embargo status rather than
 * with authors and venue — those are the fields that decide whether the data
 * can answer anything, and a repository search that returns titles and DOIs
 * looks helpful while telling the researcher nothing.
 *
 * Two display rules follow from that.
 *
 * **Unusable records are shown, not filtered out.** A researcher needs to know
 * that the promising-looking record is a PDF supplement, or is embargoed until
 * 2027 — filtering it would make the search look thinner while hiding the
 * reason. They are shown, dimmed, with the blocker stated.
 *
 * **"Not stated" is never drawn as "no".** Dryad does not list files in its
 * search response, so an empty file list there means the repository did not
 * say, not that the record has none. Those are rendered as an open question in
 * different words from a real blocker.
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Empty, Failure, Loading } from "./primitives";
import { SourceChip, SourceMark } from "./SourceMark";

type Usability = {
  usable: boolean;
  blockers: string[];
  unknown: string[];
  readable_files: number;
};

type Dataset = {
  title: string;
  repository: string;
  authors: string[];
  year: number | null;
  doi: string | null;
  description: string;
  url: string;
  licence: string;
  files: Array<{ name: string; format: string; bytes: number | null }>;
  files_listed: boolean;
  variables: string[];
  rows: number | null;
  embargoed: boolean;
  curated: boolean;
  related_paper_doi: string | null;
  usability: Usability;
};

type Results = {
  query: string;
  results: Dataset[];
  sources: { [name: string]: { ok: boolean; count: number; note: string | null } };
  found: number;
  usable: number;
  unchecked: number;
  note: string;
};

type Repository = { name: string; curated: boolean; note: string };

function bytes(value: number | null): string {
  if (!value) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = value;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

export function DataSearch() {
  const [query, setQuery] = useState("");
  const [repositories, setRepositories] = useState<Repository[] | null>(null);
  const [results, setResults] = useState<Results | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api.get<{ repositories: Repository[] }>("/api/datasets/repositories")
      .then((r) => setRepositories(r.repositories))
      .catch(() => setRepositories(null));
  }, []);

  async function search() {
    if (query.trim().length < 2) return;
    setBusy(true); setError(null); setResults(null);
    try {
      setResults(await api.post<Results>("/api/datasets/search",
                                         { query, limit: 20 }));
    } catch (err) { setError(err); } finally { setBusy(false); }
  }

  return (
    <>
      <h1>Find data</h1>
      <p className="lede">
        Searches Zenodo, Dryad, Dataverse and Figshare at once. Every result
        leads with its licence, its file formats and whether it is embargoed —
        because those decide whether the data can answer a question, and a title
        and a DOI do not.
      </p>

      <div className="lit-search">
        <label className="sr-only" htmlFor="ds-q">Search dataset repositories</label>
        <input
          id="ds-q"
          value={query}
          placeholder="antimicrobial resistance surveillance"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") void search(); }}
        />
        <button className="nj-primary" disabled={busy} onClick={() => void search()}>
          {busy ? "Searching…" : "Search"}
        </button>
      </div>

      {repositories && (
        <p className="lit-caps">
          {repositories.map((r) => (
            <SourceChip key={r.name} name={r.name} note={r.note} />
          ))}
        </p>
      )}

      {error ? <Failure error={error} /> : null}
      {busy && (
        /*
         * Counted from the list the chips above are built from, not written
         * in the sentence. "Asking four repositories" was true when it was
         * written and is one connector away from being false — which is
         * exactly how the Find papers header came to say it searched four
         * sources while searching ten, and why that count was made structural
         * rather than corrected. The same repair, before the same rot.
         *
         * Without the list — the request for it can fail — the sentence drops
         * the number rather than guessing one.
         */
        <Loading rows={4} label={repositories
          ? `Asking ${repositories.length} repositories`
          : "Asking the dataset repositories"} />
      )}

      {results && (
        <>
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
              <p className="lit-summary">{results.note}</p>

              <ol className="lit-results">
                {results.results.map((record, index) => {
                  const use = record.usability;
                  const formats = [...new Set(record.files.map((f) => f.format)
                    .filter(Boolean))];
                  return (
                    <li key={`${record.repository}-${record.doi ?? index}`}>
                      {/* Unusable records stay visible and dimmed. Filtering
                          them would hide the reason a promising title is
                          not actually usable. */}
                      <article className="lit-record ds-record"
                               data-usable={use.usable}>
                        <h3>{record.title}</h3>
                        <p className="lit-meta">
                          <SourceMark name={record.repository} size={15} />
                          {record.repository}
                          {record.curated ? " · curated" : " · open deposit"}
                          {record.year && ` · ${record.year}`}
                          {record.authors.length > 0
                            && ` · ${record.authors.slice(0, 3).join(", ")}`}
                          {record.authors.length > 3 && " et al."}
                        </p>

                        <dl className="ds-facts">
                          <div>
                            <dt>Licence</dt>
                            <dd>
                              {record.licence || (
                                <em>not stated — not the same as permissive</em>
                              )}
                            </dd>
                          </div>
                          <div>
                            <dt>Files</dt>
                            <dd>
                              {!record.files_listed ? (
                                <em>not listed by this repository</em>
                              ) : record.files.length === 0 ? (
                                <em>none listed</em>
                              ) : (
                                <>
                                  {record.files.length} ({formats.join(", ")})
                                  {use.readable_files > 0 && (
                                    <> · <b>{use.readable_files} readable here</b></>
                                  )}
                                </>
                              )}
                            </dd>
                          </div>
                          {record.rows !== null && (
                            <div>
                              <dt>Rows</dt>
                              <dd className="numeric">{record.rows.toLocaleString()}</dd>
                            </div>
                          )}
                          {record.related_paper_doi && (
                            <div>
                              <dt>Paper</dt>
                              <dd>
                                <a href={`https://doi.org/${record.related_paper_doi}`}
                                   target="_blank" rel="noreferrer noopener">
                                  {record.related_paper_doi}
                                </a>
                              </dd>
                            </div>
                          )}
                        </dl>

                        {record.variables.length > 0 && (
                          <p className="ds-vars">
                            Variables: {record.variables.slice(0, 12).join(", ")}
                            {record.variables.length > 12
                              && ` … and ${record.variables.length - 12} more`}
                          </p>
                        )}

                        {use.blockers.length > 0 && (
                          <p className="ds-blocked">
                            <b>Not usable here:</b> {use.blockers.join("; ")}.
                          </p>
                        )}
                        {/* Stated separately from a blocker: something not
                            checked is not something ruled out. */}
                        {use.unknown.length > 0 && (
                          <p className="ds-unknown">{use.unknown.join("; ")}.</p>
                        )}

                        {record.description && (
                          <p className="lit-abstract">
                            {record.description.replace(/<[^>]*>/g, "").slice(0, 300)}
                            {record.description.length > 300 && "…"}
                          </p>
                        )}

                        <footer className="lit-actions">
                          {record.files.length > 0 && (
                            <span className="lit-found numeric">
                              {bytes(record.files.reduce(
                                (sum, f) => sum + (f.bytes ?? 0), 0))}
                            </span>
                          )}
                          {record.embargoed && (
                            <span className="ds-embargo">embargoed</span>
                          )}
                          {record.url && (
                            <a href={record.url} target="_blank"
                               rel="noreferrer noopener">Open record</a>
                          )}
                        </footer>
                      </article>
                    </li>
                  );
                })}
              </ol>

              <p className="pat-foot">
                Nothing is downloaded by searching. Records are not merged
                across repositories — the same data deposited in two places is
                two records with different licences, files and versions, and
                collapsing them would hide the difference that matters.
              </p>
            </>
          )}
        </>
      )}
    </>
  );
}
