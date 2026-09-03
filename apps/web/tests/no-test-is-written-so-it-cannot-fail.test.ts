/**
 * The same guard on the interface side.
 *
 * Two Python tests in this repository were written so that they could not
 * fail, and both were hiding something real. Vitest has its own way to spell
 * the same mistake — `expect(true).toBe(true)`, `expect(x || true)` — and 2,600
 * tests is far too many to read for it.
 *
 * Narrow on purpose, for the reason the Python guard gives at length: this
 * reports only assertions that are true whatever the code does. A test with no
 * `expect` at all is not necessarily broken — it may be asserting that a render
 * does not throw, which `tests/setup.ts` turns into a failure — so that shape
 * is left alone rather than reported as a defect it usually is not.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const HERE = __dirname;
const SELF = "no-test-is-written-so-it-cannot-fail.test.ts";

/** `expect(<literal>).toBe(<the same literal>)`, and `|| true` inside expect. */
const TAUTOLOGY = /expect\(\s*(true|false|1|0)\s*\)\s*\.\s*toBe\(\s*\1\s*\)/g;
const OR_TRUE = /expect\([^)]*\|\|\s*true\s*\)/g;

function testFiles(): string[] {
  return readdirSync(HERE, { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(".test.ts") || name.endsWith(".test.tsx"))
    .filter((name) => !name.endsWith(SELF));
}

describe("no test is written so it cannot fail", () => {
  it("finds no assertion that is true by construction", () => {
    const offenders: string[] = [];
    for (const name of testFiles()) {
      const source = readFileSync(join(HERE, name), "utf8");
      source.split("\n").forEach((line, index) => {
        // A line quoting the pattern to explain it is not an offender; only a
        // line that actually runs one is.
        if (line.trimStart().startsWith("*") || line.trimStart().startsWith("//")) return;
        for (const pattern of [TAUTOLOGY, OR_TRUE]) {
          pattern.lastIndex = 0;
          if (pattern.test(line)) {
            offenders.push(`${name}:${index + 1} ${line.trim()}`);
          }
        }
      });
    }
    expect(offenders, "assertions that pass whatever the code does").toEqual([]);
  });

  it("still recognises the shapes it was written for", () => {
    // The guard's value is that it fires; a silent scanner and a clean
    // codebase look identical from here.
    TAUTOLOGY.lastIndex = 0;
    expect(TAUTOLOGY.test("expect(true).toBe(true);")).toBe(true);
    OR_TRUE.lastIndex = 0;
    expect(OR_TRUE.test("expect(thing.ok || true).toBeTruthy();")).toBe(true);
    // And leaves ordinary assertions alone.
    TAUTOLOGY.lastIndex = 0;
    expect(TAUTOLOGY.test("expect(ready).toBe(true);")).toBe(false);
    OR_TRUE.lastIndex = 0;
    expect(OR_TRUE.test("expect(a || b).toBeTruthy();")).toBe(false);
  });
});
