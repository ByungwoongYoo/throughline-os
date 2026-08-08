# Phase 1 — Research Core

Per §129. As in Phase 0, this states exactly what works and what does not (§123).

**Status: ingestion, profiling and hybrid retrieval complete. 75 tests passing.
Verified end-to-end on three real periodontal-disease PDFs and a CSV: 480
passages parsed, all embedded, hybrid search returning both rankers' scores.**

## Implemented

| §129 requirement | Where | Proven by |
|---|---|---|
| PDF ingestion | `throughline_ingestion.documents` | Column-aware block ordering; anchors verified at parse time |
| CSV / XLSX / JSON ingestion | `throughline_ingestion.datasets` | Delimiter sniffing, no coercion, source never mutated |
| Paper parsing | `documents.parse_document` | Sections, pages, paragraphs, tables, exact char spans |
| Dataset profiling | `datasets.profile_dataset` | 14 semantic types, sentinel detection, quality report |
| Hybrid retrieval | `throughline_domain.retrieval` | Postgres FTS + pgvector fused by RRF |
| Retrieval provenance (§30) | `retrieval_events` / `retrieval_results` | Every search reconstructible with per-ranker scores |
| **Trust boundary (§35)** | `throughline_domain.trust` | Nonce-fenced untrusted content; forged closing tags neutralised |
| Ingestion state machine (§24) | `objects.advance_ingestion` | Forward-only; failure preserves the stored file |

## Decisions worth knowing

**Semantic search is real and fully local.** `model2vec` static embeddings
(`potion-base-8M`, 256-d, ~30 MB, no torch, no API key) run on the researcher's
machine. A test asserts semantic search finds "We enrolled 1,240 participants"
for the query *"how many people took part in the trial"* — which lexical search
misses entirely. If no model is installed, `strategy` reports `lexical` and
`/api/system/capabilities` says so, rather than quietly returning worse results.

**RRF, not score normalisation.** `ts_rank_cd` and cosine similarity are not on a
common scale. Fusing *ranks* avoids inventing a comparability that does not
exist.

**A dataset's searchable surface is its schema, not its rows** (§106). Schema
passages describe rather than quote, so they deliberately carry no source span —
only quoted text gets an anchor.

**Anchors are verified before indexing.** `ParsedDocument.verify_anchors()` runs
on every parse and ingestion refuses a document whose spans do not resolve. An
anchor that does not resolve is not evidence (LAW 1).

## Bugs found and fixed while building this

1. **Content-addressed storage broke format detection.** Files are stored under
   their hash with no extension, so parsers re-deriving the suffix from the
   storage path rejected every upload. Format now comes from the filename
   recorded at upload.
2. **Failure records were rolled back by their own re-raise.** The handler wrote
   `FAILED` and re-raised for retry — which rolled the write back, leaving
   sources stuck at `uploaded` after a crash. Transient failures now record on a
   separate connection; permanent ones (unsupported format, empty file) return
   instead of burning the retry budget.
3. **`python -m throughline_workers.runner` silently handled nothing.** It
   imports the package (registering handlers) then re-executes `runner` as
   `__main__`, creating a second module object with an empty registry. Fixed
   with a proper `__main__.py`; the old invocation is documented as the trap it is.
4. **The worker died permanently on a fresh database.** It started before
   migrations existed and exited on the first error. It now migrates on start and
   backs off instead of exiting — a worker that dies on one hiccup is not durable.
5. **`strategy` misreported a search that found nothing.** It said `lexical`
   whenever the semantic ranker returned no rows, even though it had run.
6. **Bare year columns typed as `continuous`.** Extremely common in research
   data, and it would let a year be correlated against an outcome as if it were a
   measurement. Now semantically `date` while staying physically `number`.
7. **`patient_name` was not flagged as personal.** The sensitivity pattern only
   matched exact names. It now allows a qualifier prefix while excluding
   structural words, so `patient_name` flags and `column_name` does not.

## Not implemented

- **Research copilot, paper understanding, dataset semantic understanding.**
  These require a model provider (§40) and structured output (§41). The trust
  boundary they depend on is built and tested; the provider layer is not.
- **Compare mode (§23) and compatibility assessment (§22).** The
  `compatibility_assessments` table exists in migration 0002 and **nothing writes
  to it yet** — flagged here rather than left to look implemented.
- **Variable harmonization (§21).** `canonical_variables` and `variable_mappings`
  likewise exist as schema with no code path yet.
- **Reranking.** `retrieval_results.rerank_score` is always NULL.
- **OCR.** Scanned PDFs yield no text; there is no fallback.

Per §139-FIFTH these are named, not disguised. The three unused tables are the
one thing in this repository that resembles the schema-as-aspiration problem
found in the previous codebase, and they are called out for that reason.

## Next

Phase 2 (§130) is the scientific compute sandbox — **now complete**, see PHASE_2.md.
