/**
 * Walk the product as a first-time tester, and check the hand-offs between
 * screens rather than merely record what they show.
 *
 * `scripts/measure-provenance.mjs` is the precedent this follows: drive the
 * running product with Playwright and report what it finds, against a
 * scratch instance only. This walks landing -> the sign-in gate -> the
 * first-project screen -> the worked example -> the screens a first-time
 * researcher reaches from there, and turns six defects a plain walkthrough
 * found (TASKS.md rows D194-D199) into PASS/FAIL checks that encode the
 * *intended* behaviour, so the fixes for those rows can be proven rather
 * than eyeballed:
 *
 *   C1  the overview catches up on its own once the example's pipeline
 *       finishes, with no click and no reload
 *   C2  a finding's "Computations behind it" link opens the analysis, not
 *       the Findings list it started from
 *   C3  the browser's Back from that analysis returns to the finding or the
 *       list it came from (either is acceptable; the report says which)
 *   C4  recording a finding from a connection lands on the finding, not the
 *       connection it was recorded from
 *   C5  a newly created project becomes the current one, and survives a
 *       reload
 *   C6  switching back to another project and reloading keeps that project,
 *       even from deep inside a section
 *   C7  the machine pages (/gesture-check, /air-ink) link back to /workspace
 *   C8  informational only: distinct console errors, page errors and HTTP
 *       >= 400 responses seen along the way -- this one never fails the run
 *
 * Needs the full stack, and it signs up a brand-new account and creates
 * projects on it -- NEVER point it at a real corpus. Run it against a
 * scratch instance:
 *
 *   THROUGHLINE_HOME=/tmp/walk .venv/bin/python scripts/manage.py dev \
 *     --api-port 8099 --web-port 3100
 *
 * then, in another terminal (Playwright itself comes from `npm install` in
 * apps/web -- there is nothing further to install at the repo root; Chromium
 * is expected to already be downloaded to ~/.cache/ms-playwright):
 *
 *   node scripts/walk-the-flow.mjs
 *
 * Environment variables:
 *   WALK_URL       the running web app                default http://localhost:3100
 *   WALK_OUT       dir for screenshots + report.txt    default <os.tmpdir()>/throughline-walk
 *   WALK_EMAIL     account to sign up                  default walk-<timestamp>@local.test
 *   WALK_PASSWORD  its password                        default a long throwaway
 *
 * A fresh, unique WALK_EMAIL on every run matters, not just for hygiene: the
 * gate only shows the first-project screen (and so the worked example) to an
 * account with no projects yet, and re-running against an account that
 * already has one would skip past everything C1 checks.
 *
 * Every check (C1-C7) is wrapped so one failure does not abort the rest: on
 * a failure the script catches it, records a FAIL with the observed values,
 * and navigates back to `${WALK_URL}/workspace` before continuing. C8 never
 * fails the run. The process exits 1 if any non-informational check failed
 * (or if the walkthrough could not get far enough to run them at all).
 *
 * Other sessions may be editing the web app while this runs, and the dev
 * server hot-reloads -- a transient Next.js compile-error overlay is
 * possible on a fresh navigation. `gotoSafe` below waits five seconds and
 * retries once if it sees one.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { chromium } = await import(
  new URL("../apps/web/node_modules/playwright/index.mjs", import.meta.url).href
);

const WALK_URL = process.env.WALK_URL ?? "http://localhost:3100";
const WALK_OUT = process.env.WALK_OUT ?? join(tmpdir(), "throughline-walk");
const WALK_EMAIL = process.env.WALK_EMAIL ?? `walk-${Date.now()}@local.test`;
const WALK_PASSWORD = process.env.WALK_PASSWORD ?? "walk-only-local-throwaway-2026";

mkdirSync(WALK_OUT, { recursive: true });

const out = [];
const log = (...a) => { const s = a.join(" "); out.push(s); console.log(s); };
let n = 0;

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.setDefaultNavigationTimeout(120000);
page.setDefaultTimeout(30000);

const consoleIssues = [];
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") {
    consoleIssues.push(`[${m.type()}] ${m.text().slice(0, 300)}`);
  }
});
page.on("pageerror", (e) => consoleIssues.push(`[pageerror] ${String(e).slice(0, 300)}`));
page.on("response", (r) => {
  if (r.status() >= 400) consoleIssues.push(`[http ${r.status()}] ${r.request().method()} ${r.url()}`);
});

const shot = async (name) => {
  const file = join(WALK_OUT, `${String(n++).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: file }).catch((e) => log(`   (screenshot failed: ${e.message})`));
  return file;
};

/** Is a Next.js dev-mode compile-error overlay currently on screen? */
const hasCompileErrorOverlay = () => page.evaluate(() => {
  return !!document.querySelector(
    "[data-nextjs-dialog-overlay], #nextjs__container_errors_label, nextjs-portal");
}).catch(() => false);

/** `page.goto`, but retries once after 5s if a hot-reload compile error is showing. */
async function gotoSafe(url) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  if (await hasCompileErrorOverlay()) {
    log(`   compile-error overlay at ${url} -- waiting 5s and retrying once`);
    await page.waitForTimeout(5000);
    await page.goto(url, { waitUntil: "domcontentloaded" });
  }
}

const state = async () => page.evaluate(() => {
  const t = (el) => (el?.textContent ?? "").trim().replace(/\s+/g, " ");
  return {
    url: location.href.replace(location.origin, ""),
    h1: [...document.querySelectorAll("h1")].map(t).slice(0, 3),
    crumbs: [...document.querySelectorAll("nav.crumbs .crumb")].map(t),
    project: t(document.querySelector(".pm-name")) || null,
    railCurrent: t(document.querySelector(".rail-item[aria-current='true']")) || null,
    meters: [...document.querySelectorAll(".meters > *")].map(t),
    steps: [...document.querySelectorAll("ol.steps li")].map((li) =>
      `${t(li.querySelector("b"))} = ${t(li.querySelector(".step-state"))}`),
    railCounts: [...document.querySelectorAll(".rail-item")]
      .filter((b) => b.querySelector(".rail-count"))
      .map((b) => t(b)),
    mainButtons: [...(document.querySelector("main") ?? document.body)
      .querySelectorAll("button, a")].map(t).filter(Boolean).slice(0, 40),
  };
});

const say = async (label) => {
  const s = await state();
  log(`\n## ${label}`);
  log(`   url=${s.url}`);
  log(`   project=${s.project}  rail=${s.railCurrent}  h1=${JSON.stringify(s.h1)}`);
  log(`   crumbs=${JSON.stringify(s.crumbs)}`);
  if (s.meters.length) log(`   meters=${JSON.stringify(s.meters)}`);
  if (s.steps.length) log(`   steps=${JSON.stringify(s.steps)}`);
  if (s.railCounts.length) log(`   railCounts=${JSON.stringify(s.railCounts)}`);
  return s;
};

const settle = (ms) => page.waitForTimeout(ms);

const railClick = async (prefix) => {
  await page.locator("button.rail-item").filter({ hasText: new RegExp(`^${prefix}`) }).click();
};

/** The leading integer off a meter/rail string like "6Analyses" or "0Contradictions". */
function meterCount(strings, prefix) {
  for (const m of strings) {
    const match = /^(\d+)(\D.*)$/.exec(m);
    if (match && match[2].toLowerCase().startsWith(prefix.toLowerCase())) {
      return parseInt(match[1], 10);
    }
  }
  return 0;
}

/** h1[0] is present and is not `forbidden` -- guards against an empty h1 counting as "not X". */
const h1IsNot = (s, forbidden) => s.h1.length > 0 && s.h1[0] !== forbidden;

/**
 * Poll `probe()` (which returns `{ ok, ...details }`) until it says `ok` or
 * `timeoutMs` elapses, whichever comes first. Always probes at least once.
 */
async function pollUntil(probe, timeoutMs, intervalMs = 500) {
  const start = Date.now();
  for (;;) {
    const result = await probe();
    const elapsedMs = Date.now() - start;
    if (result.ok || elapsedMs >= timeoutMs) return { ...result, elapsedMs };
    await page.waitForTimeout(intervalMs);
  }
}

const results = [];

/** Run one check; a thrown error becomes a FAIL, and either way we recover to /workspace. */
async function check(id, description, fn) {
  try {
    const detail = await fn();
    results.push({ id, description, status: "PASS", detail: detail ?? "" });
    log(`\nPASS ${id} -- ${description}\n   ${detail ?? ""}`);
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    results.push({ id, description, status: "FAIL", detail: msg });
    log(`\nFAIL ${id} -- ${description}\n   ${msg}`);
    try {
      await gotoSafe(`${WALK_URL}/workspace`);
      await settle(1000);
    } catch (recoverErr) {
      log(`   (recovery navigation also failed: ${recoverErr.message})`);
    }
  }
}

let lastFindingTitle = null;
let fatal = null;

try {
  // ---------------------------------------------------------------- 1. landing
  await gotoSafe(`${WALK_URL}/`);
  await shot("landing");
  const ctas = await page.evaluate(() =>
    [...document.querySelectorAll("a.l-btn")].map((a) => `${a.textContent.trim()} -> ${a.getAttribute("href")}`));
  log("landing CTAs:", JSON.stringify(ctas));
  await page.locator("a.l-btn-primary").first().click();
  await page.waitForSelector(".gate, .shell, .first", { timeout: 30000 });
  await say("after clicking Open the workspace");
  await shot("gate");

  // ---------------------------------------------------------------- 2. gate (three modes)
  let gateH1 = (await page.locator(".gate h1").textContent()).trim();
  log("gate heading:", gateH1);
  if (/Welcome back/i.test(gateH1)) {
    await page.locator(".gate").getByRole("button", { name: "Create an account" }).click();
    gateH1 = (await page.locator(".gate h1").textContent()).trim();
    log("gate heading after switching to sign-up:", gateH1);
  }
  if (await page.locator(".gate input[type=text]").count()) {
    await page.locator(".gate input[type=text]").fill("Walk Tester");
  }
  await page.locator(".gate input[type=email]").fill(WALK_EMAIL);
  await page.locator(".gate input[type=password]").fill(WALK_PASSWORD);
  await page.locator(".gate button[type=submit]").click();
  await page.waitForSelector(".shell, .first", { timeout: 30000 });
  await say("after creating the account");
  await shot("first-project");

  // ---------------------------------------------------------------- 3. worked example
  const t0 = Date.now();
  await page.getByRole("button", { name: /Open a worked example/ }).click();
  await page.waitForSelector(".shell", { timeout: 60000 });
  log(`shell appeared ${Date.now() - t0}ms after clicking the example`);
  await say("immediately after the example opens");
  await shot("after-example-0s");

  // ---------------------------------------------------------------- C1
  await check("C1", "the overview catches up on its own", async () => {
    const start = Date.now();
    const result = await pollUntil(async () => {
      const s = await state();
      const ok = meterCount(s.meters, "dataset") >= 1
        && meterCount(s.meters, "analys") >= 1
        && meterCount(s.meters, "finding") >= 1;
      return { ok, meters: s.meters };
    }, 90000, 3000);
    await shot(result.ok ? "overview-caught-up" : "overview-still-stale");
    if (!result.ok) {
      throw new Error(`meters never caught up within 90s (no click, no reload): last seen ${JSON.stringify(result.meters)}`);
    }
    return `caught up after ~${Math.round((Date.now() - start) / 1000)}s: meters=${JSON.stringify(result.meters)}`;
  });

  // ---------------------------------------------------------------- C2
  await check("C2", "a finding's computation opens the analysis", async () => {
    await railClick("Findings");
    await settle(1000);
    await shot("findings-list");
    const card = page.locator("main .card").first();
    if (!(await card.count())) throw new Error("no finding card in the Findings list");
    await card.click();
    await settle(1000);
    const findingState = await say("finding detail, before opening its analysis");
    lastFindingTitle = findingState.h1[0] ?? null;
    await shot("finding-detail");

    const methodButton = page.locator("main .card-tight button").first();
    if (!(await methodButton.count())) {
      throw new Error("no computation button under \"Computations behind it\" on the finding detail");
    }
    const label = (await methodButton.textContent()).trim();
    await methodButton.click();
    await settle(1500);
    const s = await say(`after clicking the computation "${label}" on the finding`);
    await shot("finding-open-analysis");

    const pass = (s.railCurrent ?? "").startsWith("Analyses")
      && s.url.includes("section=analyses")
      && h1IsNot(s, "Findings");
    const detail = `rail=${s.railCurrent} url=${s.url} h1=${JSON.stringify(s.h1)}`;
    if (!pass) throw new Error(detail);
    return detail;
  });

  // ---------------------------------------------------------------- C3
  await check("C3", "back from a detail returns to the list", async () => {
    await page.goBack();
    // Polled rather than read once: Back changes the address at once, but the
    // finding's detail is fetched before it has a heading, and on a loaded
    // machine that gap is long enough to read an empty screen as a failure.
    const where = (s) =>
      lastFindingTitle && s.h1[0] === lastFindingTitle
        ? `returned to the finding detail ("${lastFindingTitle}")`
        : s.h1[0] === "Findings" ? "returned to the Findings list" : null;
    const outcome = await pollUntil(async () => {
      const s = await state();
      return { ok: where(s) !== null, s };
    }, 15000);
    const s = await say("after page.goBack() from the analysis detail");
    await shot("back-from-analysis");
    if (!outcome.ok) {
      throw new Error(`neither the finding detail nor the Findings list -- h1=${JSON.stringify(s.h1)} url=${s.url}`);
    }
    return `${where(outcome.s)} after ~${outcome.elapsedMs}ms`;
  });
  // Back to a clean, known screen before the next check, regardless of C3's outcome.
  await railClick("Overview").catch((e) => log(`   (returning to Overview via the rail failed: ${e.message})`));
  await settle(500);

  // ---------------------------------------------------------------- C4
  await check("C4", "recording a finding shows the finding", async () => {
    await railClick("Connections");
    await settle(1000);
    await shot("connections-list");
    const row = page.locator("main tbody tr").first();
    if (!(await row.count())) throw new Error("no connection row in the Connections list");
    const rowButton = row.locator("button").first();
    if (await rowButton.count()) await rowButton.click(); else await row.click();
    await settle(1000);
    await say("connection detail");
    await shot("connection-detail");

    const recordButton = page.getByRole("button", { name: "Record a finding", exact: true });
    if (!(await recordButton.count())) throw new Error("no \"Record a finding\" button on the connection detail");
    await recordButton.click();
    await settle(500);
    await shot("record-finding-form");

    const textarea = page.locator("main textarea").last();
    if (!(await textarea.count())) throw new Error("no textarea in the record-a-finding form");
    await textarea.fill("Recorded by the walk-the-flow harness.");
    const submit = page.locator("main button").filter({ hasText: /record it/i }).last();
    if (!(await submit.count())) throw new Error("no submit button matching /record it/i");
    await submit.click();

    const result = await pollUntil(async () => {
      const s = await state();
      const ok = (s.railCurrent ?? "").startsWith("Findings")
        && s.url.includes("section=findings")
        && s.url.includes("item=")
        && h1IsNot(s, "Connections");
      return { ok, s };
    }, 5000, 300);
    await shot("after-record-finding");
    const detail = `rail=${result.s.railCurrent} url=${result.s.url} h1=${JSON.stringify(result.s.h1)}`;
    if (!result.ok) throw new Error(detail);
    return detail;
  });

  // ---------------------------------------------------------------- C5
  let newProjectName = null;
  await check("C5", "a new project becomes the current one", async () => {
    await page.locator(".pm-trigger").click();
    await settle(500);
    await shot("project-menu");
    await page.getByRole("menuitem", { name: /New project/ }).click();
    await settle(500);
    await shot("new-project-form");

    const question = `Does the walk-the-flow harness's new project become current, at ${Date.now()}?`;
    newProjectName = question.slice(0, 60);
    await page.locator("textarea").fill(question);
    await page.getByRole("button", { name: /Create project/ }).click();

    const result = await pollUntil(async () => {
      const s = await state();
      return { ok: s.project === newProjectName && s.url.includes("project="), s };
    }, 5000, 300);
    await shot("after-new-project");
    const detail1 = `project=${result.s.project} url=${result.s.url} (expected "${newProjectName}")`;
    if (!result.ok) throw new Error(`part 1 (immediately after creating): ${detail1}`);

    await page.reload({ waitUntil: "domcontentloaded" });
    await settle(1500);
    const s2 = await say("after reloading the new project");
    await shot("after-new-project-reload");
    if (s2.project !== newProjectName) {
      throw new Error(`part 1 passed (${detail1}) but part 2 (after reload) failed: project=${s2.project}`);
    }
    return `part 1: ${detail1}; part 2 (after reload): project=${s2.project}`;
  });

  // ---------------------------------------------------------------- C6
  await check("C6", "the project survives a reload from deep inside", async () => {
    await page.locator(".pm-trigger").click();
    await settle(500);
    await shot("project-menu-switch-back");
    const exampleItem = page.getByRole("menuitemradio", { name: /Example/i }).first();
    if (!(await exampleItem.count())) throw new Error("no menuitemradio matching /Example/i in the project menu");
    await exampleItem.click();
    await settle(1000);
    await railClick("Findings");
    await settle(1000);
    await say("back in the example project, on Findings (before reload)");
    await shot("example-findings-before-reload");

    await page.reload({ waitUntil: "domcontentloaded" });
    await settle(1500);
    const after = await say("after reloading from deep inside the example project");
    await shot("example-findings-after-reload");

    const pass = /Example/i.test(after.project ?? "") && (after.railCurrent ?? "").startsWith("Findings");
    const detail = `project=${after.project} rail=${after.railCurrent} url=${after.url}`;
    if (!pass) throw new Error(detail);
    return detail;
  });

  // ---------------------------------------------------------------- C7
  await check("C7", "the machine pages lead back", async () => {
    const missing = [];
    for (const path of ["/gesture-check", "/air-ink"]) {
      await gotoSafe(`${WALK_URL}${path}`);
      await settle(1000);
      await shot(path.slice(1));
      const hasLink = await page.locator('a[href="/workspace"]').count();
      log(`   ${path}: a[href="/workspace"] count=${hasLink}`);
      if (!hasLink) missing.push(path);
    }
    if (missing.length) throw new Error(`no a[href="/workspace"] found on: ${missing.join(", ")}`);
    return "both machine pages link back to /workspace";
  });
} catch (err) {
  fatal = err;
  log(`\nFATAL -- the walkthrough could not continue: ${err && err.stack ? err.stack : err}`);
}

// ---------------------------------------------------------------- C8 (informational; never fails)
log("\n## C8 -- console / network issues seen (informational only, does not affect pass/fail)");
const distinctIssues = [...new Set(consoleIssues)];
for (const line of distinctIssues) log("   " + line);
results.push({
  id: "C8",
  description: "console/network issues seen",
  status: "INFO",
  detail: `${distinctIssues.length} distinct issue(s)`,
});

// ---------------------------------------------------------------- summary
log("\n## Summary");
for (const r of results) {
  log(`${r.status.padEnd(4)} ${r.id.padEnd(3)} ${r.description}${r.detail ? `  (${r.detail})` : ""}`);
}
if (fatal) log(`\nFATAL ${String(fatal.message ?? fatal)}`);

const anyFail = fatal != null || results.some((r) => r.status === "FAIL");

const reportPath = join(WALK_OUT, "report.txt");
writeFileSync(reportPath, out.join("\n"));
console.log(`\nFull report written to ${reportPath}`);

await browser.close();
process.exit(anyFail ? 1 : 0);
