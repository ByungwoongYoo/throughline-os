/**
 * The two advisories that came in through Next, and why they are pinned here.
 *
 * `npm audit` reported three high-severity vulnerabilities, all transitive
 * through `next`: four `postcss` issues (XSS via unescaped `</style>`, and
 * arbitrary `.map` file reads via an attacker-controlled `sourceMappingURL`)
 * and libvips CVEs in `sharp`. npm's own advice was `npm audit fix --force`,
 * which installs `next@16` — a major upgrade, offered as the fix for a
 * dependency this application does not call.
 *
 * The exposure analysis said neither is reachable today: there is no
 * `next/image` and no `<img>` anywhere, so Next's image optimizer — sharp's
 * only entry point here — is never invoked, and postcss only ever processes
 * this project's own stylesheets at build time. Nothing untrusted reaches
 * either.
 *
 * "Unreachable today" is a weak guarantee, though. It stops being true the
 * first time somebody adds `next/image`, and that person will have no reason to
 * think about libvips. So the patched versions are pinned through `overrides`
 * instead: the advisories are resolved rather than argued with, and no major
 * framework upgrade was smuggled into a feature branch to do it.
 *
 * This test exists because an override is invisible. Nothing fails if it is
 * removed — `npm audit` is not part of CI — and the vulnerability simply comes
 * back.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));

/** The first version of each that carries the fix. */
const PATCHED = {
  postcss: 8_005_023,   // 8.5.23
  sharp: 35_000,        // 0.35.0
};

function comparable(range: string): number {
  const [major, minor, patch] = range.replace(/^[^\d]*/, "").split(".").map(Number);
  return major * 1_000_000 + minor * 1_000 + (patch ?? 0);
}

describe("advisories that arrived through a dependency", () => {
  it("pins a patched postcss", () => {
    const pinned = pkg.overrides?.postcss;
    expect(pinned, "overrides.postcss").toBeTruthy();
    expect(comparable(pinned)).toBeGreaterThanOrEqual(PATCHED.postcss);
  });

  it("pins a patched sharp", () => {
    const pinned = pkg.overrides?.sharp;
    expect(pinned, "overrides.sharp").toBeTruthy();
    expect(comparable(pinned)).toBeGreaterThanOrEqual(PATCHED.sharp);
  });

  it("still has no image optimizer to reach sharp through", () => {
    /**
     * Not a requirement — adding `next/image` is a perfectly reasonable thing
     * to do. It records the premise the exposure analysis rested on, so that if
     * it ever stops holding, the person who changed it sees why it was written
     * down rather than discovering the reasoning is stale.
     */
    const usesImage = ["app", "components"].some((directory) => {
      try {
        execSync(`grep -rl "next/image" ${directory}`, { stdio: "pipe" });
        return true;
      } catch {
        // grep exits non-zero when it finds nothing, which is the answer here.
        return false;
      }
    });

    // If this fails, nothing is broken — but sharp is now genuinely reachable,
    // so the pin above has stopped being belt-and-braces and become load-bearing.
    expect(usesImage).toBe(false);
  });
});
