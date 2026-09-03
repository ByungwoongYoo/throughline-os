/**
 * The project's citations, as a `.bib` file a researcher can take away.
 *
 * `bibliography.py` has produced this for some time: stable keys so two
 * exports of an unchanged project are byte-identical, missing fields omitted
 * rather than guessed, and braces escaped since a scraped title with one
 * unmatched brace was found to swallow every entry after it. Nothing called
 * it. No route, no control — a researcher who had done the reading could not
 * get their references into the thing they write in.
 *
 * Shown rather than downloaded. A `.bib` that turns out to be a comment saying
 * nothing was cited is better discovered on screen than in a submission, and
 * the incomplete entries are worth reading before the file is saved.
 */

import { useState } from "react";
import { Failure, Loading } from "./primitives";
import { useApi } from "@/lib/useApi";

type Bibliography = {
  bibtex: string;
  entries: number;
  citations: number;
  incomplete: Array<{ key: string; title: string; missing: string[] }>;
};

/**
 * The results themselves, as data rather than as a document.
 *
 * §75 asked for a spreadsheet export and had none. It sits here rather than on
 * the Connections screen because this is where a researcher comes to take
 * things away — the .bib is next to it, and both answer "how do I get this
 * out". A plain link, because the browser already knows how to save a file the
 * server marks as an attachment; fetching it into a Blob would add a copy in
 * memory and a filename this code would have to invent.
 */
export function ResultsTable({ projectId }: { projectId: string }) {
  return (
    <section className="bib">
      <h2>Results table</h2>
      <p className="lede">
        Every candidate that was tested, with its estimate, its p-value and the
        q-value after correction — as CSV, for a paper's table or for
        re-plotting elsewhere. Everything tested is a row, not only what
        survived: the family that was tested is what makes a q-value mean
        anything.
      </p>
      <a className="btn" href={`/api/projects/${projectId}/results.csv`} download>
        Download the results table (CSV)
      </a>
    </section>
  );
}


export function BibliographyPanel({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const bibliography = useApi<Bibliography>(
    open ? `/api/projects/${projectId}/bibliography` : null, [open]);

  return (
    <section className="bib">
      <h2>Bibliography</h2>
      <p className="lede">
        Every paper this project cites, as BibTeX. Ordered so that two exports
        of an unchanged project are identical — a bibliography that reshuffles
        itself makes a diff unreadable.
      </p>

      {!open ? (
        <button type="button" className="btn" onClick={() => setOpen(true)}>
          Show the .bib
        </button>
      ) : (
        <>
          {bibliography.error && (
            <Failure error={bibliography.error} retry={bibliography.reload} />
          )}
          {bibliography.loading && (
            <Loading rows={3} label="Gathering the citations" />
          )}
          {bibliography.data && (
            <>
              <p className="note">
                {bibliography.data.entries} reference
                {bibliography.data.entries === 1 ? "" : "s"} from{" "}
                {bibliography.data.citations} citation
                {bibliography.data.citations === 1 ? "" : "s"}.
              </p>

              {/* Named before the file is saved, because a reference short a
                  year renders as "Lovelace, ?" and is otherwise found in the
                  proofs. */}
              {bibliography.data.incomplete.length > 0 && (
                <div className="bib-gaps">
                  <h3 className="eyebrow">Short of a field</h3>
                  <ul>
                    {bibliography.data.incomplete.map((entry) => (
                      <li key={entry.key}>
                        {entry.title || entry.key} — no{" "}
                        {entry.missing.join(", no ")}
                      </li>
                    ))}
                  </ul>
                  <p className="note">
                    Left blank rather than guessed. BibTeX will render these
                    incomplete, which is more honest than a year nobody
                    recorded.
                  </p>
                </div>
              )}

              <textarea
                className="bib-text mono"
                readOnly
                rows={14}
                aria-label="BibTeX for this project"
                value={bibliography.data.bibtex}
              />
            </>
          )}
        </>
      )}
    </section>
  );
}
