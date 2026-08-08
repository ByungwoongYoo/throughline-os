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

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
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
  analysis: { sandbox: boolean; methods: string[]; isolation: Record<string, unknown> };
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
  passed: boolean | null;
  summary: string;
  checks: Record<string, boolean>;
  check_details: Array<{
    name: string; outcome: string; detail: string; analysis_run_id: string | null;
  }>;
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
};
