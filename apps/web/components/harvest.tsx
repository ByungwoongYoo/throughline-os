"use client";

/**
 * Harvesting a repository that speaks OAI-PMH.
 *
 * The other way into this screen's territory is search: type words, get papers.
 * This is not that, and the difference is the first thing the interface has to
 * teach. OAI-PMH cannot be searched — the protocol lists records by date range
 * and set, and a search box over it would have to download an entire repository
 * to answer while still missing whatever it skipped. So there is no query field
 * here, and the copy says why rather than leaving a researcher hunting for one.
 *
 * Three decisions follow from what harvesting actually is.
 *
 * **Identify runs first, separately.** It is one cheap request that answers "is
 * this an OAI-PMH endpoint, and whose?" — before a harvest that may pull
 * hundreds of records from an address somebody typed by hand. Discovering a URL
 * was wrong after three pages is a worse experience than discovering it before
 * the first.
 *
 * **The ceiling is visible and editable.** An unbounded harvest will pull a
 * national repository onto a laptop. Showing the limit as a number the
 * researcher sets is more honest than a hidden default, and truncation is
 * reported afterwards rather than passed off as completeness.
 *
 * **Withdrawals are surfaced, not counted.** A harvest that reports "12 stored"
 * while silently marking a source withdrawn buries the one fact that needed a
 * person. If anything was withdrawn, this says so and points at the panel that
 * explains what still rests on it.
 */

import { useState } from "react";
import { api } from "@/lib/api";
import { Failure } from "./primitives";

type Identity = {
  name: string;
  base_url: string;
  protocol: string;
  admin_email: string;
  earliest: string;
  deleted_record_policy: string;
};

type Harvested = {
  added: number;
  already_held: number;
  withdrawn: Array<{ source_id: string; title: string }>;
  pages: number;
  truncated: boolean;
  note: string;
  repository: string;
};

export function Harvest({ projectId }: { projectId: string }) {
  const [url, setUrl] = useState("");
  const [set, setSet] = useState("");
  const [since, setSince] = useState("");
  const [limit, setLimit] = useState(200);

  const [identity, setIdentity] = useState<Identity | null>(null);
  const [result, setResult] = useState<Harvested | null>(null);
  const [busy, setBusy] = useState<"identify" | "harvest" | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function identify() {
    setBusy("identify");
    setError(null);
    setIdentity(null);
    setResult(null);
    try {
      setIdentity(await api.get<Identity>(
        `/api/projects/${projectId}/harvest/identify?base_url=${encodeURIComponent(url)}`));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  async function harvest() {
    setBusy("harvest");
    setError(null);
    setResult(null);
    try {
      setResult(await api.post<Harvested>(`/api/projects/${projectId}/harvest`, {
        base_url: url, set_spec: set, since, max_records: limit,
      }));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="harvest-heading" style={{ marginTop: 28 }}>
      <h2 id="harvest-heading">Harvest a repository</h2>
      <p className="note">
        Institutional repositories, thesis archives and national libraries speak
        OAI-PMH. This lists their records by date and set — it cannot be searched
        by keyword, because the protocol has no search. Harvest first, then
        search what arrived.
      </p>

      <div className="row" style={{ gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <input
          aria-label="Repository base URL"
          placeholder="https://export.arxiv.org/oai2"
          value={url}
          style={{ minWidth: 280 }}
          onChange={(event) => setUrl(event.target.value)}
        />
        <button type="button" className="btn" onClick={identify} disabled={!url || busy !== null}>
          {busy === "identify" ? "Asking…" : "Identify"}
        </button>
      </div>

      {identity && (
        <div className="card" style={{ marginBottom: 12 }}>
          <p style={{ fontWeight: 560, margin: "0 0 4px" }}>{identity.name}</p>
          <p className="mono" style={{ fontSize: 12, color: "var(--ink-faint)", margin: 0 }}>
            OAI-PMH {identity.protocol} · records from {identity.earliest || "an unstated date"}
            {identity.deleted_record_policy &&
              ` · deletions: ${identity.deleted_record_policy}`}
          </p>
        </div>
      )}

      <div className="row" style={{ gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <input aria-label="Set" placeholder="set (optional)" value={set}
               onChange={(event) => setSet(event.target.value)} />
        <input aria-label="From date" placeholder="from (YYYY-MM-DD)" value={since}
               onChange={(event) => setSince(event.target.value)} />
        <input aria-label="Maximum records" type="number" min={1} max={5000}
               value={limit} style={{ width: 110 }}
               onChange={(event) => setLimit(Number(event.target.value))} />
        <button type="button" className="btn" onClick={harvest} disabled={!url || busy !== null}>
          {busy === "harvest" ? "Harvesting…" : "Harvest"}
        </button>
      </div>

      {error ? <Failure error={error} /> : null}

      {result && (
        <div className="card">
          <p style={{ margin: "0 0 6px" }}>{result.note}</p>

          {/*
            The one fact that needs a person. A harvest reporting "12 stored"
            while quietly marking something withdrawn buries exactly the part
            somebody has to act on.
          */}
          {result.withdrawn.length > 0 && (
            <p style={{ fontSize: 12, margin: "0 0 6px" }}>
              {result.withdrawn.length} source
              {result.withdrawn.length === 1 ? "" : "s"} you already hold
              {result.withdrawn.length === 1 ? " has" : " have"} been withdrawn
              upstream. The Sources screen lists what still rests on them.
            </p>
          )}

          <p className="mono" style={{ fontSize: 12, color: "var(--ink-faint)", margin: 0 }}>
            {result.pages} page{result.pages === 1 ? "" : "s"} fetched
            {result.truncated && " · stopped at the ceiling, there is more"}
          </p>
        </div>
      )}
    </section>
  );
}
