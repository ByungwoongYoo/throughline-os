/**
 * Cumulative Layout Shift on the marketing page, attributed to the element
 * that caused it.
 *
 * D008 recorded CLS 0.083 over Slow 4G against 0.000 with the fonts blocked,
 * and named `div.l-layer` as the shifting element. A total is enough to know
 * there is a problem and not enough to fix one: the parallax layers, the hero
 * copy and everything below it all move when the webfont rewraps the heading,
 * and which of them carries the score decides whether the fix is a font
 * strategy or a geometry change.
 *
 * So this reports **per-source attribution** — every shifted node, with how
 * much score it contributed — rather than one number.
 *
 * Read the same caveat `measure-lcp.mjs` carries: this drives a local browser
 * against `next start`, so it measures the page rather than the internet. The
 * throttled profile is Chrome DevTools' own Slow 4G with a 4x CPU slowdown,
 * which is what Lighthouse's mobile preset uses. Enough to catch a regression,
 * not a substitute for field data.
 *
 * Playwright is deliberately not a dependency of apps/web, for the reason
 * `measure-lcp.mjs` gives. Install it where you run this:
 *
 *   npm i playwright && npx playwright install chromium
 *
 * Usage:
 *   cd apps/web && npm run build && npm start -- --port 3100 &
 *   node scripts/measure-cls.mjs --url http://localhost:3100 --runs 5
 *   node scripts/measure-cls.mjs --url http://localhost:3100 --block-fonts
 */

import { chromium } from "playwright";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};
const flag = (name) => args.includes(`--${name}`);

const url = option("url", "http://localhost:3100");
const runs = Number(option("runs", 5));
const blockFonts = flag("block-fonts");
const throttle = !flag("no-throttle");

/**
 * Collected inside the page before anything else runs.
 *
 * `hadRecentInput` shifts are excluded because those are the user's own doing —
 * counting them would blame the page for a scroll. Sources are resolved to a
 * readable selector at capture time: the node may be gone by the time the
 * result is read out.
 */
const COLLECT = () => {
  window.__cls = { total: 0, sources: {} };
  const describe = (node) => {
    if (!node || node.nodeType !== 1) return "(anonymous)";
    const classes = [...node.classList].map((c) => `.${c}`).join("");
    return `${node.tagName.toLowerCase()}${classes}`;
  };
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.hadRecentInput) continue;
      window.__cls.total += entry.value;
      for (const source of entry.sources ?? []) {
        const key = describe(source.node);
        window.__cls.sources[key] = (window.__cls.sources[key] ?? 0) + entry.value;
      }
    }
  }).observe({ type: "layout-shift", buffered: true });
};

async function measure() {
  const browser = await chromium.launch();
  const results = [];

  for (let run = 0; run < runs; run += 1) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },   // a mid-range phone
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    await page.addInitScript(COLLECT);

    if (blockFonts) {
      await page.route("**/*.woff2", (route) => route.abort());
    }

    const session = await context.newCDPSession(page);
    if (throttle) {
      await session.send("Network.enable");
      await session.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: 400,
        downloadThroughput: (400 * 1024) / 8,
        uploadThroughput: (400 * 1024) / 8,
      });
      await session.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    }

    await page.goto(url, { waitUntil: "networkidle" });
    // Fonts can swap after networkidle; the shift they cause is the one being
    // measured, so wait for them explicitly rather than racing.
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1500);

    results.push(await page.evaluate(() => window.__cls));
    await context.close();
  }

  await browser.close();
  return results;
}

const results = await measure();
const totals = results.map((r) => r.total).sort((a, b) => a - b);
const median = totals[Math.floor(totals.length / 2)];

const attributed = {};
for (const result of results) {
  for (const [selector, value] of Object.entries(result.sources)) {
    attributed[selector] = (attributed[selector] ?? 0) + value / results.length;
  }
}

console.log(`\nurl        ${url}`);
console.log(`runs       ${runs}   fonts ${blockFonts ? "BLOCKED" : "loaded"}` +
            `   ${throttle ? "Slow 4G + 4x CPU" : "unthrottled"}`);
console.log(`CLS        median ${median.toFixed(4)}   ` +
            `min ${totals[0].toFixed(4)}   max ${totals.at(-1).toFixed(4)}`);
console.log(`\nattributed to (mean per run):`);
for (const [selector, value] of Object.entries(attributed)
       .sort((a, b) => b[1] - a[1])) {
  console.log(`  ${value.toFixed(4)}  ${selector}`);
}
if (!Object.keys(attributed).length) console.log("  (nothing shifted)");
console.log();
