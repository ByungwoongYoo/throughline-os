/**
 * A page nothing links to is a page nobody opens.
 *
 * This codebase already guards the API against exactly this — every route is
 * checked against the calls the interface makes, and an unreachable one has to
 * be listed with a reason. The pages had no such guard, and the consequence was
 * `/charts-3d`: two hundred and fifty-three catalogued visualizations, a
 * browser to draw any of them, and no way to arrive there short of typing the
 * URL.
 *
 * The rule is the same one the routes follow. A page is reachable, or it is
 * named here with the reason it is not.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const APP = join(__dirname, "..", "app");

/** Every route the app serves, as a path. */
function pages(dir = APP, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (!statSync(full).isDirectory()) continue;
    const route = `${prefix}/${entry}`;
    if (readdirSync(full).includes("page.tsx")) out.push(route);
    out.push(...pages(full, route));
  }
  return out;
}

/** The text of one page and everything the workspace shell can render. */
function sourceFor(route: string): string {
  const parts: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (/\.tsx?$/.test(entry)) parts.push(readFileSync(full, "utf8"));
    }
  };
  const segments = route.split("/").filter(Boolean);
  if (segments.length === 0) {
    // The landing page's own file, which is where a visitor starts.
    parts.push(readFileSync(join(APP, "page.tsx"), "utf8"));
  } else {
    walk(join(APP, ...segments));
  }
  // The shell and its panels are reachable from any workspace page, so their
  // links count as links from it.
  if (route === "/workspace") walk(join(__dirname, "..", "components"));
  return parts.join("\n");
}

/** Which pages this one links to. */
function linksFrom(route: string, all: string[]): string[] {
  const text = sourceFor(route);
  return all.filter((other) => other !== route
    && new RegExp(`["'\`]${other}["'\`/]`).test(text));
}

/**
 * Every page you can arrive at by clicking, starting at the front door.
 *
 * Reachability rather than mention. `/charts-3d` was linked — from
 * `/case-compare`, which nothing linked to — so a guard asking "is this
 * referenced anywhere" called both of them fine while neither could be opened.
 */
function reachable(all: string[]): Set<string> {
  const seen = new Set<string>(["/"]);
  const queue = ["/"];
  while (queue.length) {
    for (const next of linksFrom(queue.shift()!, all)) {
      if (!seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  return seen;
}

/**
 * Pages that are deliberately not linked, and why.
 *
 * Short on purpose. Every entry is a claim that nobody needs to find this by
 * clicking.
 */
const WITHOUT_A_LINK: Record<string, string> = {
  "/workspace": "The product itself. The landing page opens it.",
  "/case-compare":
    "A deep link, not a destination: it opens CaseCompare directly so a "
    + "researcher handed a case does not have to find a tab first. Everything "
    + "on it is reachable from Compare → Scan ↔ scan.",
};

describe("every page can be reached by clicking", () => {
  it("finds the pages this app serves", () => {
    // A walk that found nothing would pass by checking nothing.
    expect(pages().length).toBeGreaterThan(3);
  });

  it("can be reached from the front door by clicking", () => {
    const all = ["/", ...pages()];
    const arrived = reachable(all);
    const orphans = all.filter((route) => route !== "/"
      && !arrived.has(route) && !(route in WITHOUT_A_LINK));

    expect(orphans, orphans.length
      ? `nothing reachable links to ${orphans.join(", ")} — a page nobody can `
        + "open is a page nobody uses. Add a link from somewhere reachable, or "
        + "list it in WITHOUT_A_LINK with the reason."
      : "").toEqual([]);
  });

  it("has no stale exemption", () => {
    const live = new Set(pages());
    expect(Object.keys(WITHOUT_A_LINK).filter((r) => !live.has(r))).toEqual([]);
  });
});
