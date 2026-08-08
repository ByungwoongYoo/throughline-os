# Phase 3 — Discovery

Per §131. **This phase completes the §137 MVP differentiator.**

```
PAPER + DATASET → CONNECTION → REAL ANALYSIS → VALIDATION → FINDING
→ EVIDENCE → PROVENANCE
```

`tests/test_mvp_end_to_end.py` walks that whole workflow over HTTP with a real
PDF, a real dataset, real sandboxed computation and real lifecycle gates. §125
says it "must work before the platform is considered successful". It works.

**Status: complete. 127 tests passing.**

## The decisive property: false positives are controlled

`test_pure_noise_yields_almost_no_exploratory_connections` feeds the engine 8
columns of pure random noise — 28 pairs. Uncorrected, one or two will look
significant at α = 0.05. Benjamini-Hochberg at FDR 0.05 promotes **zero**.

That is not theoretical. On live data with a genuine signal:

```
PAIR                              METHOD                ESTIMATE  q-VALUE    STATUS
consumption_ddd x resistance_pct  pearson_correlation    0.8784   7.44e-39   exploratory
resistance_pct x gdp_per_capita   pearson_correlation   -0.2089   6.61e-02   candidate
consumption_ddd x gdp_per_capita  pearson_correlation   -0.1866   8.27e-02   candidate
country x resistance_pct          anova                      -    8.25e-01   candidate
```

`resistance_pct × gdp_per_capita` has r = −0.209 at n = 120 — **p ≈ 0.022,
significant if reported alone**. Correction raises it to q = 0.066 and it stays a
candidate. A discovery engine that reported that as a finding would be
manufacturing confident nonsense.

Rejected candidates are *kept and visible*, not hidden. The tests were run; the
researcher can see them; they are simply not presented as discoveries.

## §49 in order, not brute force

1. **classify** — from the Phase 1 semantic profile
2. **compatible pairs** — a test that fits both variables' types
3. **eliminate** — identifiers, constants, personal fields, too-few observations,
   too-many levels, unsupported types. Every exclusion is recorded with a reason.
4. **generate candidates**
5. **choose methods** — Pearson vs Spearman by profiled skew; t-test vs
   Mann-Whitney; ANOVA vs Kruskal-Wallis. The rationale is recorded *before* the
   test runs, because choosing a method after seeing the result is p-hacking.
6. **compute** — one sandboxed analysis run per candidate (LAW 2)
7. **correct** — Benjamini-Hochberg across the whole family actually run
8. **evaluate robustness** — §51
9. **rank** — §50 composite, never p-value alone
10. **send to validation**

## §51 validation runs real analyses

Every check names the computation behind it — LAW 1 applied to validation itself:

```
confounder_adjustment  passed  Controlling for gdp_per_capita, the coefficient on
                               consumption_ddd is 0.7984 (p = 2.08e-30).
                               ↳ computed by arun_0e788dadc0524090
robustness             passed  100.0% of resamples kept the sign; interval excludes zero.
                               ↳ computed by arun_283bcebb1b7c435d
sensitivity            passed  Excluding outliers moved pearson_r from 0.8784 to
                               0.8513 (3.1% relative change).
                               ↳ computed by arun_c9985785b973485d
missingness            passed  0 of 120 rows (0.0%) dropped by listwise deletion.
multiple_comparison_correction passed  Benjamini-Hochberg q = 7.44e-39.
outliers               passed  2 variables contain points beyond 1.5×IQR, but excluding
                               them left the estimate essentially unchanged.
```

Two deliberate choices:

- **No confounders supplied is not a pass.** It records `not_tested` with
  "This is untested, not clean." Not knowing what to control for is a real
  limitation, not an absence of one.
- **Failing validation does not reject a connection.** It stays exploratory —
  which is exactly what it still is. Failing a robustness check is information,
  not a verdict.

## The Scientific Critic can demote (§57)

`critic.py` probes evidence balance and re-runs the robustness suite, then
returns one of §57's five verdicts. Crucially it *only demotes*: `disappears`
sends a finding to DEPRECATED, `weakens`/`uncertain` sends a validated finding to
CONFLICTED. Surviving a challenge earns nothing — promotion still requires the
§51 checks through `findings.transition`. A validation engine that can only
promote is not a validation engine.

## Bugs found while building this

1. **"Outliers exist" was treated as a validation failure.** In n = 120 normal
   data, a few points beyond 1.5×IQR are expected — so *every real dataset would
   have failed validation forever*. The scientific question is not whether
   outliers exist but whether the conclusion depends on them, so the sensitivity
   re-analysis now runs first and the outlier check is detection **plus impact**.
2. **A list of probes went into a JSONB column as a Postgres array.** psycopg
   cannot tell a JSON array from a Postgres array, and picks the latter —
   `column "probes" is of type jsonb but expression is of type jsonb[]`. This was
   the exact trap my own `db.py` comment warned about, so there is now an
   explicit `jsonb()` helper rather than a comment asking people to remember.

## Not implemented

- **Contradiction engine (§55).** The `contradictions` table exists in migration
  0004 and **nothing writes to it**. Detecting cross-source contradictions needs
  claim-level comparison between papers and datasets, which needs §22
  compatibility assessment — still absent from Phase 1.
- **Research gaps (§56)**, reviewer mode (§120), replication mode (§121) — Phase 7.
- **Replication lifecycle state.** `replicated` is reachable in the state machine
  but nothing promotes to it; that needs a second independent dataset (§121).
- **Causal reasoning (§52, §53).** Findings carry `causal_status` and it stays
  `not_assessed`; no code sets it. Deliberate — inferring causation is exactly
  what the spec forbids doing casually.
- **Bootstrap for non-correlation methods.** `robustness` reports "no bootstrap
  procedure is implemented for {method}" and fails closed rather than passing
  untested.

## Next

Phase 4 (§132) — visual intelligence: `ResearchVisualSpec`, automatic
visualization recommendation, the visualization critic, and the multi-renderer
architecture that lets one semantic result become web, publication and slide
output without duplicating analysis logic.
