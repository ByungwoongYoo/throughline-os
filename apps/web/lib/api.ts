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
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    // §104 — surface what the server actually said, never "something went wrong".
    const detail =
      payload?.detail ?? payload?.message ?? `Request failed (${response.status})`;
    throw new ApiError(response.status, String(detail));
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
  paper?: { id: string; title: string; page_count: number } | null;
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
};

export type DiscoveryMap = {
  counts: Record<string, number>;
  findings: Record<string, number>;
  connections: Record<string, number>;
  top_connections: Connection[];
  recommended_next_action: string;
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
    isolation: Record<string, unknown>;
  };
  llm: { configured: boolean; note: string };
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

export type SandboxPolicy = {
  enforced?: Record<string, boolean>;
  best_effort?: Record<string, string>;
  not_enforced?: Record<string, boolean>;
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

export type DatasetColumn = {
  ordinal: number;
  name: string;
  original_name: string;
  physical_type: string;
  semantic_type: string;
  unit: string | null;
  missing_count: number;
  unique_count: number;
  statistics: Record<string, number | null>;
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
