/**
 * A screen that tells server answers apart must be tested with those answers.
 *
 * Three screens collapsed every way a request could end into one sentence —
 * a method that cannot be converted, a source that is not a database, an
 * analysis that has not finished — and told researchers something definite
 * about their own work that nothing had established. All three had tests, and
 * all three passed, because every fixture rejected with a bare `Error`.
 *
 * No path in the product produces one. `api.get` throws `ApiError` for every
 * response it hears back, and only something like a dropped connection arrives
 * as anything else — so a bare `Error` exercises the transport case and skips
 * every status-dependent branch silently.
 *
 * `test_fixtures_use_values_the_product_can_produce.py` catches the other half
 * of this class, where a fixture uses a status string no state machine can
 * produce. It says in its own docstring that the mocked-exception half needs a
 * different instrument. This is it.
 *
 * **What it does not do.** It reads literal three-digit comparisons, so a
 * branch on a status held in a constant is invisible to it. It matches a
 * component to its tests by import rather than by filename, because test files
 * here are named for the behaviour they pin — `fragility.tsx` is tested by
 * `how-fragile-is-this.test.tsx` — and a name-based mapping would have found
 * nothing while looking thorough.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..");

function sources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(join(WEB, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) sources(path, found);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      found.push(path);
    }
  }
  return found;
}

/** `err.status === 409`, `error.status >= 500` — a branch on what came back. */
const BRANCH = /\b(?:err|error|refused|failure)\w*\.status\s*(?:===|!==|>=|<=|>|<)\s*(\d{3})/g;
const CONSTRUCTED = /new ApiError\(\s*(\d{3})/g;

const TESTS = readdirSync(join(WEB, "tests"))
  .filter((f) => /\.test\.tsx?$/.test(f))
  .map((f) => [`tests/${f}`, readFileSync(join(WEB, "tests", f), "utf8")] as const);

function branchesIn(file: string): { statuses: string[]; tests: string[] } {
  const source = readFileSync(join(WEB, file), "utf8");
  const statuses = [...new Set([...source.matchAll(BRANCH)].map((m) => m[1]))];
  const stem = file.replace(/\.tsx?$/, "").replace(/^(components|app)\//, "");
  const tests = TESTS
    .filter(([, body]) => body.includes(`/components/${stem}"`)
                       || body.includes(`/${stem}"`))
    .map(([name]) => name);
  return { statuses, tests };
}

const BRANCHING = [...sources("components"), ...sources("app")]
  .map((file) => ({ file, ...branchesIn(file) }))
  .filter((entry) => entry.statuses.length > 0);

describe("a screen that branches on a status", () => {
  it("finds some, so an empty scan cannot pass", () => {
    expect(BRANCHING.length).toBeGreaterThan(2);
    // And the import mapping resolves, or every status would read as untested
    // and this file would be a guard against nothing.
    expect(BRANCHING.every((e) => e.tests.length > 0),
      `no test file imports: ${BRANCHING.filter((e) => !e.tests.length)
        .map((e) => e.file).join(", ")}`).toBe(true);
  });

  it("is exercised with that status, not with a bare Error", () => {
    const gaps: string[] = [];
    for (const { file, statuses, tests } of BRANCHING) {
      const covered = new Set<string>();
      for (const name of tests) {
        const body = TESTS.find(([n]) => n === name)![1];
        for (const m of body.matchAll(CONSTRUCTED)) covered.add(m[1]);
      }
      for (const status of statuses) {
        if (!covered.has(status)) {
          gaps.push(`${file} branches on ${status}; ${tests.join(", ") || "no test"} `
            + "never constructs an ApiError with it");
        }
      }
    }
    expect(gaps, "a status-dependent branch no test reaches:\n  "
      + gaps.join("\n  ")).toEqual([]);
  });
});
