/**
 * Typed client for the Throughline API (§111).
 *
 * Every request is same-origin: Next rewrites /api to the FastAPI server, so the
 * httpOnly SameSite=strict session cookie is sent. A cross-origin fetch would
 * silently drop it and every call would 401.
 */

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/**
 * The server's words, whichever shape it sent them in.
 *
 * A hand-raised `HTTPException` carries a string. A *validation* failure
 * carries a list of objects — FastAPI's own shape:
 *
 *     {"detail":[{"type":"string_too_short","loc":["body","password"],
 *                 "msg":"String should have at least 12 characters", ...}]}
 *
 * `String(detail)` on that is `[object Object]`, which is what a researcher
 * setting up a new machine saw if they mistyped the password — on the first
 * screen of the product, where the field and the rule are both in the
 * response and were both being discarded at the last step.
 *
 * Every field is named, not just the first: a form with two bad fields that
 * reports one teaches somebody to fix and resubmit twice.
 */
function readDetail(detail: unknown, status: number): string {
  if (typeof detail === "string") return detail;

  if (Array.isArray(detail)) {
    const said = detail
      .map((item) => {
        const e = item as { loc?: unknown[]; msg?: unknown };
        const msg = typeof e.msg === "string" ? e.msg : "";
        // `loc` is ["body", "password"] — the first element names where it
        // came from, which a reader does not need, and the rest is the field.
        const where = Array.isArray(e.loc)
          ? e.loc.slice(1).filter((p) => typeof p === "string" || typeof p === "number")
              .join(".")
          : "";
        if (msg && where) return `${where}: ${msg}`;
        return msg || where;
      })
      .filter(Boolean);
    // Separated, because two messages run together read as one run-on
    // sentence: "…at least 1 character password: String should have…". The
    // messages do not carry their own punctuation, so this supplies it.
    if (said.length > 0) return said.join(". ") + ".";
  }

  // An object, or something with no words in it at all: better a plain
  // statement than the string "[object Object]".
  return `Request failed (${status}).`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: init?.body instanceof FormData
      ? undefined
      : { "Content-Type": "application/json" },
    cache: "no-store",
    ...init,
  });

  const text = await response.text();

  /*
   * Parsed inside a guard, and after the status is read — `requestBytes`
   * below already does both, and this one did neither.
   *
   * `JSON.parse` ran first and unguarded, so any body that is not JSON threw
   * a `SyntaxError` straight past every handler in the product. A researcher
   * with no API running saw "Unexpected token '<', \"<!DOCTYPE \"... is not
   * valid JSON" as the failure — a message about a parser, printed directly
   * above the panel's own correct note that the API is not answering. It
   * sends somebody to debug JSON when nothing is serving the address.
   *
   * Running before the status check made it worse: a 502 from a proxy or a
   * 500 rendered as an HTML error page threw on the parse, so §104's rule
   * that the server's own words reach the researcher was skipped for exactly
   * the failures where those words matter most.
   */
  let payload: { detail?: unknown; message?: unknown } | null = null;
  let parsed = true;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    parsed = false;
  }

  if (!parsed) {
    /*
     * Not JSON at all, whatever the status. Something other than this API
     * answered — a dev server handing back its own page, a proxy replying for
     * a backend that is not running, a sign-in redirect — and the useful
     * thing to say is that, not the body.
     *
     * **`requestBytes`' judgement does not transfer here, and copying it made
     * this worse before the page showed me.** That function slices the body
     * into the message because its two endpoints return short plain-text
     * errors. A general client meets whole HTML documents, and my first fix
     * put three hundred characters of `<!DOCTYPE HTML> <html lang="en">…`
     * where a sentence belongs — which is less use than the parser error it
     * replaced.
     *
     * So markup is never quoted. A short single-line body is, because that is
     * a gateway saying something like `upstream connect error` and those
     * words are worth having; the status travels either way, so a screen that
     * branches on it still can.
     */
    const body = text.trim();
    const quotable = body.length > 0 && body.length <= 200
      && !body.startsWith("<") && !body.includes("\n");
    throw new ApiError(
      response.status,
      quotable
        ? `The server answered "${body}" rather than data (HTTP `
          + `${response.status}).`
        : "This address answered with a page rather than data, so nothing is "
          + `serving the API there (HTTP ${response.status}). Start it with `
          + "./scripts/dev.sh.");
  }

  if (!response.ok) {
    // §104 — surface what the server actually said, never "something went wrong".
    const detail =
      payload?.detail ?? payload?.message ?? `Request failed (${response.status})`;
    throw new ApiError(response.status, readDetail(detail, response.status));
  }

  return payload as T;
}

/**
 * A response that is bytes rather than JSON.
 *
 * Separate from `request` because that one parses every body as JSON, which is
 * right for the whole API except the two endpoints that carry a file. The error
 * path is deliberately identical: a failure still arrives as JSON with a
 * `detail`, and §104's rule that the server's own words reach the researcher
 * applies just as much when the success case was a PDF.
 */
async function requestBytes(path: string, init?: RequestInit): Promise<Uint8Array> {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    ...init,
  });

  if (!response.ok) {
    const text = await response.text();
    let detail = `Request failed (${response.status})`;
    try {
      const payload = text ? JSON.parse(text) : null;
      detail = payload?.detail ?? payload?.message ?? detail;
    } catch {
      // A non-JSON error body is still better than a status code alone.
      if (text) detail = text;
    }
    throw new ApiError(response.status, String(detail));
  }
  return new Uint8Array(await response.arrayBuffer());
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  /** GET that returns a file. See `requestBytes`. */
  getForBytes: (path: string) => requestBytes(path),
  /** POST that returns a file. See `requestBytes`. */
  postForBytes: (path: string, body?: unknown) =>
    requestBytes(path, {
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  // `delete` is a reserved word, so the method is `del`.
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  upload: <T>(path: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<T>(path, { method: "POST", body: form });
  },
  /**
   * A file plus structured fields, in one multipart request.
   *
   * `upload` covers the common case where the file is the whole request. A
   * figure being digitised is not that: the calibration travels with it, and a
   * multipart body cannot also be a JSON body — so the fields go alongside as
   * form values and the server parses them.
   */
  uploadWith: <T>(path: string, file: File, fields: Record<string, unknown>) => {
    const form = new FormData();
    form.append("file", file);
    for (const [name, value] of Object.entries(fields)) {
      form.append(name, typeof value === "string" ? value : JSON.stringify(value));
    }
    return request<T>(path, { method: "POST", body: form });
  },
};

// --- types mirroring the API contracts -------------------------------------

export type Project = {
  id: string;
  name: string;
  research_question: string;
  description: string;
  status: string;
  created_at: string;
};

export type Source = {
  id: string;
  title: string;
  source_type: string;
  ingestion_status: string;
  ingestion_detail: string;
  trust_level: string;
  created_at: string;
  passage_count?: number;
  /**
   * What ingestion noticed about the source itself. `injection_signals` holds
   * phrases in the document addressed to an AI system rather than describing
   * research — recorded, never acted on.
   */
  metadata?: { injection_signals?: string[] } & Record<string, unknown>;
  /**
   * Where a dataset came from, when it was not a file somebody dropped on the
   * window (D211).
   *
   * Find data brings a record in from a repository, and the import records all
   * four: which connector fetched it, the record at its origin, the
   * repository's name and the licence it stated. An uploaded file has none of
   * them and every one arrives null — not "", which would print as a
   * provenance line with nothing in it. `original_uri` is what makes the
   * provenance checkable rather than merely asserted: the researcher can open
   * the record and read it themselves.
   */
  connector_id?: string | null;
  original_uri?: string | null;
  repository?: string | null;
  licence?: string | null;
  /**
   * When this source was withdrawn upstream, and why.
   *
   * Harvesting marks a source withdrawn rather than deleting it, because
   * deleting would destroy both the reference and the evidence that it was
   * withdrawn. The API has always sent both fields and this type named
   * neither, so the one page about a source could not say that the source has
   * been retracted — a reader saw its trust level and its ingestion status and
   * nothing else. `withdrawals.py` asks "what of mine is now standing on
   * something withdrawn"; this is that question for one source, at the moment
   * somebody is reading it.
   */
  withdrawn_at?: string | null;
  withdrawn_reason?: string | null;
  paper?: {
    id: string;
    title: string;
    page_count: number;
    /**
     * What the parser recorded about reading it.
     *
     * `columns` is `"detected"` when each page's column split was found, and
     * `"spliced"` when it was not on at least one page — in which case
     * `spliced_pages` names them. A whole-page read of a two-column paper
     * interleaves the columns, so a sentence on one of those pages can be two
     * halves of two different sentences, and this product quotes passages
     * verbatim for citation.
     */
    metadata?: {
      parser?: string;
      columns?: string;
      spliced_pages?: number[];
    } | null;
  } | null;
  dataset?: {
    dataset_id: string;
    dataset_version_id: string;
    version: number;
    row_count: number;
    column_count: number;
    quality_report: Record<string, unknown>;
  } | null;
};

/**
 * The §24 ingestion pipeline, in order.
 *
 * Mirrors IngestionStatus in throughline_schemas.enums. Keeping the real stage
 * names means the interface can say "parsing, step 5 of 9" instead of a spinner
 * — a true statement of position, not an invented percentage.
 */
export const INGESTION_STAGES = [
  "uploaded", "validated", "scanned", "extracting",
  "parsing", "structuring", "indexing", "enriching", "ready",
] as const;

/** In flight means: started, and neither finished nor failed. */
export function isIngesting(status: string): boolean {
  return status !== "ready" && status !== "failed";
}

/** 1-based position in the pipeline, or null for a status outside it. */
export function ingestionStep(status: string): number | null {
  const index = (INGESTION_STAGES as readonly string[]).indexOf(status);
  return index < 0 ? null : index + 1;
}

export type Connection = {
  id: string;
  left_variable: string;
  right_variable: string;
  method: string;
  lifecycle_status: string;
  estimate: number | null;
  p_value: number | null;
  q_value: number | null;
  effect_size: number | null;
  effect_size_name: string;
  sample_size: number | null;
  evidence_quality: string;
  rank_score: number;
  analysis_run_id: string | null;
  /**
   * The addressable object for the run that produced this, or null.
   *
   * What "where did this come from" starts from. Deliberately not the
   * connection's own `object_id` — nothing sets that column, while every
   * analysis run gets an ANALYSIS object, so this is the anchor the provenance
   * chain can actually walk.
   */
  analysis_object_id?: string | null;
  /** Null when the connection did not come from a discovery run. */
  dataset_version_id: string | null;
  /** The dataset's own name. The id above is not readable, and two datasets
   *  in one project produce two answers for the same pair. */
  dataset_name?: string | null;
};

export type Finding = {
  id: string;
  title: string;
  statement: string;
  finding_type: string;
  lifecycle_status: string;
  causal_status: string;
  confidence: number | null;
  created_at: string;
  /**
   * The caveats stated on the claim, sent with every finding in the list.
   *
   * Named here so the list can say a finding has them. Without it every claim
   * in the list read identically — one carrying three stated limits looked
   * exactly like one carrying none — and the caveats appeared only once the
   * reader had already opened the finding they were deciding about.
   */
  limitations?: string[];
};

/**
 * One of the ten strongest connections, as the discovery map sends it.
 *
 * A projection, not a `Connection`: `graphs.discovery_map` selects ten columns
 * for its top ten, and this list was typed as the full fifteen-field record —
 * so the interface was promised `p_value`, `sample_size`, `analysis_run_id`,
 * `dataset_version_id` and `effect_size_name`, which the server never sends.
 * Nothing read them, which is the only reason nothing broke; the nested
 * contract check found it (D353). Written out rather than as
 * `Pick<Connection, …>` so that check can read it.
 */
export type TopConnection = {
  id: string;
  left_variable: string;
  right_variable: string;
  method: string;
  lifecycle_status: string;
  estimate: number | null;
  q_value: number | null;
  effect_size: number | null;
  evidence_quality: string;
  rank_score: number;
};

/**
 * What the recommendation is about, chosen on the same rung as its sentence.
 *
 * The step says which of six screens; this says which object on it. It used
 * to be chosen by the client from the ranked connections — a second ladder —
 * so on three rungs a sentence about findings put a button under it that
 * opened an unrelated connection. Only `kind`, `id` and `verb` are always
 * present; the rest describe whichever kind this is.
 */
export type RecommendedTarget = {
  kind: "connection" | "finding";
  id: string;
  /** The act the rung asks for; the button's words come from this. */
  verb: "validate" | "record" | "evidence" | "promote" | "challenge";
  left_variable?: string;
  right_variable?: string;
  title?: string;
};

export type DiscoveryMap = {
  counts: Record<string, number>;
  findings: Record<string, number>;
  connections: Record<string, number>;
  top_connections: TopConnection[];
  recommended_next_action: string;
  /**
   * Which loop step the recommendation is about, as an id the interface can
   * act on (`lib/loop.ts`), beside the sentence a person reads. Absent from
   * older servers, and null when nothing is left to do or work is in flight.
   */
  recommended_step?: "sources" | "profile" | "discover" | "validate" | "record" | "communicate" | null;
  /**
   * The object the recommended step's control opens, from the same rung as
   * the sentence. Absent from older servers; null where the rung is about a
   * whole screen rather than one object.
   */
  recommended_target?: RecommendedTarget | null;
};

/**
 * What the analysis sandbox actually enforces, and what it does not.
 *
 * Typed rather than left as `Record<string, unknown>`, and the difference is
 * the point. The API composes this report carefully — naming what is enforced,
 * what is only best-effort, and what is not attempted — with a comment saying
 * it is "surfaced here rather than glossed over". Nothing surfaced it. An
 * opaque bag is a field nobody can render, so the honest disclosure was
 * computed on every request and shown to no researcher.
 *
 * `not_enforced` matters most and is therefore not optional: a reader deciding
 * whether to run an analysis over sensitive data needs to know that the
 * filesystem isolation is not kernel-level and that blocking network egress is
 * done in Python, which a determined library can step around.
 */
import type { DatasetFormats } from "./formats";

export type SandboxPolicy = {
  /*
   * Every field optional, and not from timidity: this same shape is both the
   * live report from `/api/system/capabilities` and the copy stored with every
   * analysis run, and a run recorded by an older version carries whichever
   * fields that version wrote. A required field would make a historical run
   * fail to parse, which is the wrong way to discover that a report grew.
   */
  platform?: string;
  mechanism?: string;
  enforced?: Record<string, boolean>;
  /** Attempted, but not guaranteed by the operating system. */
  best_effort?: Record<string, string>;
  /** Deliberately not attempted. The honest half, and the half worth reading. */
  not_enforced?: Record<string, boolean>;
  limits?: { timeout_seconds: number; memory_mb: number; cpu_seconds: number };
  note?: string;
};

export type Capabilities = {
  retrieval: { lexical: boolean; semantic: boolean; model: string | null; note: string | null };
  analysis: {
    sandbox: boolean;
    methods: string[];
    /*
     * Which variables each method needs, and whether each takes one column or
     * several. Served rather than held here: the domain owns the map, and a
     * copy in the client is a second thing to keep in step. Optional because
     * an older server does not send it, and a form is better off saying it
     * cannot ask than guessing the shape.
     */
    method_variables?: Record<string, Array<{ role: string; takes: "one" | "many" }>>;
    isolation: SandboxPolicy;
  };
  llm: { configured: boolean; note: string };
  /**
   * Which dataset formats this installation can read.
   *
   * Absent from this type until now, which is the whole reason the upload
   * picker carried a literal: a field the client cannot name is a field the
   * client cannot use, so the server reported twenty-two readable formats and
   * the dialog offered eight. Optional because an older server does not send
   * it, and `uploadAccept` offers everything rather than guessing when it is
   * missing.
   */
  formats?: DatasetFormats;
};

export type SearchResult = {
  query: string;
  strategy: string;
  retrieval_event_id: string;
  lexical_candidates: number;
  semantic_candidates: number;
  results: Array<{
    passage_id: string;
    source_id: string;
    content: string;
    locator: string;
    page: number | null;
    section: string;
    lexical_score: number | null;
    semantic_score: number | null;
    fused_score: number;
    rank: number;
  }>;
};

/** The §47 statistical result contract, mirrored so the UI cannot misread it. */
export type StatisticalResult = {
  method: string;
  method_rationale: string;
  sample_size: number;
  estimate: number | null;
  estimate_name: string;
  ci_low: number | null;
  ci_high: number | null;
  confidence_level: number;
  p_value: number | null;
  effect_size: { name: string; value: number; interpretation?: string } | null;
  limitations: string[];
  warnings: string[];
  // §47 keeps these four apart, and so does this type.
  statistically_significant: boolean | null;
  practical_significance: string;
  evidence_quality: string;
  interpretation: string;
  extra?: Record<string, unknown>;
};

export type AnalysisRun = {
  id: string;
  status: string;
  method: string;
  research_question: string;
  method_rationale: string;
  variables: Record<string, unknown>;
  result: StatisticalResult | null;
  error: string | null;
  random_seed: number;
  dependency_versions: Record<string, string>;
  sandbox_policy: SandboxPolicy;
  /**
   * What the run warned about, stored in its own column as well as inside the
   * result.
   *
   * Absent from this type while the API returned it — `SELECT r.*` has always
   * included the column — which is why nothing displayed it. Optional, because
   * the same content also arrives inside `result` and an older run may carry
   * only one of the two.
   */
  warnings?: string[];
  /**
   * What the sandbox wrote to stderr, capped at 8000 characters.
   *
   * Stored on every run and named by nothing, so a failed analysis showed
   * `error` alone — which is `"Analysis failed"` whenever the runtime could not
   * say better — and the traceback that would explain it sat in the database.
   * A failure a researcher cannot diagnose is one they retry blindly or
   * abandon, and neither is a use of their time.
   */
  logs?: string | null;
  input_hashes: Record<string, string>;
  duration_ms: number | null;
  assumption_checks: Array<{
    name: string; outcome: string; detail: string;
    statistic: number | null; p_value: number | null; severity: string;
  }>;
};

export type ValidationReport = {
  id: string;
  status: string;
  passed: boolean | null;
  summary: string;
  created_at: string;
  checks: Record<string, boolean>;
  check_details: Array<{
    name: string; outcome: string; detail: string; analysis_run_id: string | null;
  }>;
};

/**
 * The profiled schema (§20, §26).
 *
 * The confounder picker is built from this rather than from a text field. Asking
 * a researcher to type a column name means asking them to remember whether the
 * header was `gdp_per_capita` or `GDP per capita` — and a typo there is silently
 * recorded as "confounder not tested", which reads on the report as though the
 * adjustment was considered and skipped.
 */
/**
 * A row in the project's list of analysis runs.
 *
 * `origin` matters when reading. A run that came out of a sweep was corrected
 * inside a family of tests; one a researcher specified stands alone; a fork is
 * a variant of another rather than an independent look.
 */
export type AnalysisRunRow = {
  id: string;
  status: string;
  error: string | null;
  created_at: string;
  origin: "discovery" | "specified" | "fork";
  method: string;
  variables: Record<string, unknown>;
  research_question: string;
  fork_reason: string;
  forked_from_run_id: string | null;
  left_variable: string | null;
  right_variable: string | null;
  estimate: number | null;
  estimate_name: string | null;
  p_value: number | null;
  sample_size: number | null;
};

import type { ColumnStatistics } from "./column-notices";

export type DatasetColumn = {
  ordinal: number;
  name: string;
  original_name: string;
  physical_type: string;
  semantic_type: string;
  unit: string | null;
  missing_count: number;
  unique_count: number;
  /**
   * The profiler's record for this column.
   *
   * Typed `Record<string, number | null>` until it wasn't true: the profile
   * also carries `top_values` (a list), `possible_sentinel_values` (a list of
   * numbers) and `reads_as_number_with_decimal_comma` (an object). A type that
   * describes the data as flatter than it is invites a reader to index into it
   * as a number and get an object back.
   */
  statistics: ColumnStatistics & Record<string, unknown>;
  sensitivity: string;
};

export type EvidenceItem = {
  id: string;
  evidence_type: string;
  direction: string;
  strength: number | null;
  source_document: string | null;
  source_title: string | null;
};

export type EvidenceGraph = {
  finding: Finding & { limitations: string[] };
  claims: Array<{
    id: string; statement: string; claim_type: string;
    supporting: EvidenceItem[];
    contradicting: EvidenceItem[];
  }>;
  analyses: Array<{ id: string; method: string; result: StatisticalResult | null }>;
  connections: Connection[];
  challenges: Array<{ id: string; verdict: string; summary: string }>;
  balance: { supporting: number; contradicting: number };
  /**
   * The causal reading, and what it means.
   *
   * `causal_status` has always been on the finding and no screen read it, so
   * the field this product treats as its central commitment — association is
   * not causation — appeared on the findings list as a bare token and nowhere
   * on the finding a researcher had opened to decide what it establishes.
   *
   * The sentence is written by the server rather than here on purpose. The
   * same vocabulary already exists in `library_note`, where a second copy had
   * drifted into describing `associational` for a status really called
   * `association_only`; a copy in this client would be the third place to
   * keep in step.
   */
  causal_reading: { status: string; note: string };
  /**
   * The finding's own caveats, sent beside `note` and shown with it.
   *
   * `graphs.evidence_graph` returns these at the top level, next to the
   * sentence explaining that no contradicting evidence is not the same as none
   * existing — the whole response is shaped around what a reader should not
   * conclude. This field was the one part of that shape the type never named,
   * so it arrived on every request and reached no screen.
   */
  limitations: string[];
  note: string | null;
};

export type Provenance = {
  artifact: { id: string; object_type: string; title: string; created_at: string };
  direct_inputs: Array<{ source_artifact_id: string; lineage_type: string }>;
  ancestors: Array<{ artifact_id: string; depth: number; object_type: string; title: string }>;
  /*
   * Whether the chain is derived, starts here, or was never written down.
   * Decided by the domain, which owns the list of types that enter a project
   * from outside — an interface deciding it needs its own copy of that list,
   * and the copy that drifts is the one that starts calling a finding a
   * source. Optional because an older server does not send it, and the screen
   * says less rather than guessing.
   */
  origin?: "derived" | "uploaded" | "unrecorded";
};

// --- Phase 5: communication (§79) and citation integrity (§58) -------------

export type Citation = {
  id: string;
  locator: string;
  entailment: "unverified" | "supported" | "unsupported" | "not_checkable";
  entailment_detail: string;
  target_kind: "passage" | "source" | "analysis_run";
  target: Record<string, unknown>;
};

export type ArtifactBlock = {
  id: string;
  sequence: number;
  block_type: string;
  text: string;
  notes: string;
  resolved: Record<string, unknown>;
  /** Where each displayed value was read from, at render time (LAW 1). */
  value_provenance: Array<{ name: string; source: string; path: string }>;
  citations: Citation[];
};

export type Integrity = {
  publishable: boolean;
  blocks_checked: number;
  problems: Array<{ block_id: string; kind: string; detail: string }>;
  warnings: Array<{ block_id: string; kind: string; detail: string }>;
};

export type Artifact = {
  id: string;
  artifact_type: string;
  title: string;
  purpose: string;
  status: string;
  version: number;
  blocks: ArtifactBlock[];
  findings: Array<{ id: string; title: string; lifecycle_status: string }>;
  integrity: Integrity;
  renders: Array<{
    id: string; fmt: string; storage_key: string; byte_size: number;
    resolved_hash: string; artifact_version: number; created_at: string;
  }>;
};

export type ArtifactSummary = {
  id: string;
  artifact_type: string;
  title: string;
  status: string;
  version: number;
  block_count: number;
  render_count: number;
  created_at: string;
};

export type CitationReport = {
  total: number;
  resolved: number;
  dangling: Array<{ citation_id: string; reason: string }>;
  by_entailment: Record<string, number>;
  note: string;
};

/**
 * What to call a research object on screen.
 *
 * The board prints `object_type` straight from the API, and a CSV somebody
 * uploaded appears there labelled **citation**. That is not a data error: the
 * domain creates one object per raw source file and gives it `ObjectType
 * .CITATION`, and `_source_object` is the only place that type is ever
 * created — so every "citation" in this system is a file the researcher added,
 * not a reference in a bibliography. The word is internal shorthand that
 * escaped onto a screen, and a researcher reading "citation" under
 * `amr_surveillance.csv` has been told something false about their own data.
 *
 * Renaming the enum is a migration for a display problem. This is the display.
 *
 * The fallback de-underscores rather than inventing a word, so a type added
 * later reads as itself instead of silently becoming something else.
 */
export function objectTypeName(objectType: string): string {
  const NAMES: Record<string, string> = {
    citation: "source file",
    visualization: "figure",
    dataset_variable: "variable",
    research_gap: "gap",
    time_period: "period",
  };
  return NAMES[objectType] ?? objectType.replace(/_/g, " ");
}
