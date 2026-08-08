# Phase 2 — Scientific Compute

Per §130. **This phase closes LAW 2**: a number can now enter the research model
only as the output of a recorded run, executed outside the API process, from a
specification validated before execution.

**Status: complete. 113 tests passing**, including 11 that attack the sandbox and
17 that check statistical correctness against scipy directly.

## What the sandbox actually enforces (§43)

Honesty about isolation matters more than a reassuring claim, so
`policy_report()` returns three separate categories and is stored with **every
run**:

| Enforced | How |
|---|---|
| Separate OS process | `subprocess` with an argument vector, never a shell |
| No application secrets | Environment allowlisted; anything matching `KEY`/`TOKEN`/`SECRET`/`DATABASE`/`CREDENTIAL` is dropped |
| Isolated working directory | Fresh temp dir, destroyed in a `finally` |
| Read-only inputs | Copied in and `chmod 0o444` — an analysis describes data, it cannot rewrite it |
| Wall-clock timeout | Killed by process **group**, so children die too |
| CPU and memory limits | `setrlimit` RLIMIT_CPU / RLIMIT_AS, with RLIMIT_DATA fallback on macOS |
| Determinism | `PYTHONHASHSEED=0`, single-threaded BLAS, seeded RNG |

| Best-effort — labelled as such | Why |
|---|---|
| Network egress | `network_egress_disabled: "python_level_only"`. Sockets are blocked inside the process; that stops a library phoning home, but it is not a kernel boundary |

| Not enforced |
|---|
| Kernel-level filesystem isolation, GPU quota |

**Arbitrary code execution is refused outright.** `require_full_isolation()`
raises `IsolationUnavailable`, so whoever later adds model-authored code has to
confront the missing container boundary rather than discover it in production.
Phase 2 runs only whitelisted methods driven by a validated spec — that is what
makes "run an analysis" safe without a container.

## The §47 contract, working

A live run on 12 rows of AMR data:

```
estimate    : pearson_r = 0.999140  CI[0.9968, 0.9998]
p-value     : 3.69e-15   n=12
significance: True | magnitude: large | evidence: weak
```

**p = 3.7e-15 and the evidence is still graded weak**, because n = 12. That is
§47 working as specified: statistical significance, effect magnitude, practical
significance and evidence quality are four separate judgements, and the code
cannot collapse them.

Other §47 behaviour that is tested, not just intended:

- Unequal variances trigger Welch's correction **automatically**, and the
  adjustment is recorded.
- Non-normal data gets a warning naming the correct alternative — nothing is
  swapped behind the researcher's back.
- Outliers are reported and **never removed**; excluding them is a
  transformation and must be explicit (LAW 4).
- Every correlation carries "association, not causation" as a limitation (§52).
- A statistically significant but negligible association (n=20,000, r=0.03) is
  reported as `practical_significance: negligible`.

## Reproducibility (§44) and forking (§95)

Every run stores the spec hash, the dataset content hash, the random seed,
dependency versions, the sandbox policy, timings, logs and warnings. A completed
run is **immutable at the database level** — a Postgres trigger refuses to edit a
terminal run's result:

> `Analysis run arun_… is terminal (completed). Fork it instead of editing it.`

Forks record what they descend from and why, and `compare` states plainly whether
the conclusion survived:

```
base                         pearson_correlation   est=0.9991  p=3.7e-15  n=12
Rank-based sensitivity check spearman_correlation  est=1.0                n=12
Exclude highest consumption  pearson_correlation   est=0.9988  p=8.1e-12  n=10
conclusion_stable: True
```

## Methods (§46)

`descriptive`, `pearson_correlation`, `spearman_correlation`,
`linear_regression` (simple and multiple), `t_test` (Student/Welch, chosen by
Levene), `mann_whitney`, `chi_square`, `anova`, `kruskal_wallis`.

Assumption checks per method: Shapiro-Wilk normality, IQR outliers, Levene
variance equality, Breusch-Pagan homoscedasticity, Durbin-Watson independence,
VIF multicollinearity, expected cell counts.

## Bugs found while building this

1. **The network block broke the standard library.** Replacing `socket.socket`
   (a class) with a function made `class SSLSocket(socket)` in `ssl.py` fail with
   `TypeError: function() argument 'code' must be code, not str` — which took down
   every import chain touching ssl, including statsmodels. Now the *connect
   methods* are patched, leaving the class subclassable. Tested both ways: the
   connection is refused and `ssl` still imports.
2. **Shapiro-Wilk at large n is misleading.** scipy warns past n=5000, and at
   that size the test flags departures too small to affect inference while the
   CLT covers the mean anyway. Reporting "violated" would have been technically
   true and scientifically wrong; it now reports `not_applicable` with the sample
   skew.

## Not implemented

- **Logistic regression, PCA, clustering, time-series, survival, meta-analysis**
  (§46). The registry pattern makes each additive; they are absent, not stubbed.
- **Transformations** (§45 `transformations`). The field is accepted and stored
  but **nothing applies it** — declared here rather than left to look wired.
  Filters are fully implemented and declarative.
- **Multi-dataset analysis.** Refused with a specific reason: it needs §21
  variable harmonization, which does not exist. Joining on a guess would be worse
  than refusing.
- **Multiple-comparison correction** (§49). Belongs with Phase 3 discovery, where
  many tests are generated at once.

## Next

Phase 3 (§131) — connection discovery, the connection lifecycle, robustness
validation and the contradiction engine. The §51 checks that `findings.transition`
already demands are, as of this phase, computable: the sandbox can run the
sensitivity and confounder-adjustment analyses those gates require.
