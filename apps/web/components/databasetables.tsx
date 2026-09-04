"use client";

/**
 * Choosing a table out of an uploaded database.
 *
 * A dataset is one table and a database is several, so ingestion refuses a
 * multi-table file rather than guessing — picking the largest or the first
 * would produce a dataset that looks entirely right and is the wrong one.
 * That refusal needs somewhere to go, or the researcher is left holding a file
 * the system can read and no way to say which part of it they meant. This is
 * that somewhere.
 *
 * It appears on a source whose ingestion failed, because that is exactly when
 * it is wanted, and it says what importing does before anybody presses it: the
 * rows are copied into a dataset of their own and the database file is left
 * alone. A control whose effect is unclear gets pressed twice.
 */

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Failure, Loading } from "./primitives";

type Table = { name: string; kind: string; rows: number; columns: string[] };

type Listing = { filename: string; tables: Table[]; note: string };

export function DatabaseTables({ projectId, sourceId, onImported }: {
  projectId: string;
  sourceId: string;
  onImported?: (sourceId: string) => void;
}) {
  const base = `/api/projects/${projectId}/sources/${sourceId}/tables`;
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState<string | null>(null);
  const [imported, setImported] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    setLoading(true);
    api.get<Listing>(base)
      .then((body) => { setListing(body); setError(null); })
      .catch((failure) => setError(failure))
      .finally(() => setLoading(false));
  }, [base]);

  useEffect(load, [load]);

  async function importTable(name: string) {
    setImporting(name);
    setError(null);
    try {
      const body = await api.post<{ source_id: string; rows: number; note: string }>(
        `${base}/${encodeURIComponent(name)}`);
      setImported((current) => ({ ...current, [name]: body.note }));
      onImported?.(body.source_id);
    } catch (failure) {
      setError(failure);
    } finally {
      setImporting(null);
    }
  }

  if (loading) return <Loading rows={3} label="Reading the database" />;
  // Not a failure banner: the usual reason this cannot list tables is that the
  // source is not a database at all, which is not an error on this screen.
  if (error && !listing) return null;
  if (!listing || listing.tables.length === 0) return null;

  return (
    <section className="dbtables">
      <h2>Tables in this database</h2>
      <p className="lede">
        A dataset is one table, so it will not choose for you. Import the one
        you meant.
      </p>
      {error != null && <Failure error={error} retry={load} />}
      <table>
        <thead>
          <tr><th>Table</th><th>Rows</th><th>Columns</th><th /></tr>
        </thead>
        <tbody>
          {listing.tables.map((table) => (
            <tr key={table.name}>
              <td>
                {table.name}
                {table.kind === "view" && <span className="tag"> view</span>}
              </td>
              <td className="num">{table.rows}</td>
              <td className="cols">{table.columns.join(", ")}</td>
              <td>
                {imported[table.name] ? (
                  <span className="done">Imported</span>
                ) : (
                  <button type="button" className="btn"
                          disabled={importing !== null}
                          onClick={() => importTable(table.name)}>
                    {importing === table.name ? "Importing…" : "Import"}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {Object.entries(imported).map(([name, note]) => (
        <p key={name} className="note">{note}</p>
      ))}
      <p className="note">{listing.note}</p>
    </section>
  );
}
