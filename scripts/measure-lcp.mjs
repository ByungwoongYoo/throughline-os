/**
 * Largest Contentful Paint on the marketing page, measured.
 *
 * The brief sets an LCP target for the first screen a visitor sees. A target
 * with no number against it is a wish, so this produces the number.
 *
 * **Read the caveat before quoting the result.** This drives a headless
 * Chromium against a local `next start`, so it measures the page, not the
 * internet: no DNS, no TLS handshake, no contended bandwidth, and a CPU that is
 * not a mid-range phone. The unthrottled figure is a floor — the best the page
 * could ever do. The throttled figure applies Chrome DevTools' own Slow 4G
 * profile and a 4x CPU slowdown, which is what Lighthouse's mobile preset uses
 * and is far closer to a field number. Neither is a substitute for real user
 * monitoring; both are enough to catch a regression.
 *
 * Playwright is deliberately NOT a dependency of apps/web. Adding it would put
 * a browser download inside `npm ci` and the Docker build for the sake of a
 * measurement that runs occasionally. Install it where you run this:
 *
 *   npm i playwright && npx playwright install chromium
 *
 * Usage:
 *   cd apps/web && npm run build && npm start &
 *   node scripts/measure-lcp.mjs --url http://localhost:3000 --runs 5
 */

import { chromium } from "playwright";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : args[at + 1];
};

const URL = option("url", "http://localhost:3000");
const RUNS = Number(option("runs", 5));

/**
 * Collected inside the page.
 *
 * LCP is reported repeatedly as larger elements paint, and only the last entry
 * before the first interaction counts — so this keeps taking entries until the
 * page has been quiet for a moment rather than reading the first one.
 */
const COLLECT = `
new Promise((resolve) => {
  const result = { lcp: 0, element: "", fcp: 0, cls: 0 };

  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      result.lcp = entry.startTime;
      const node = entry.element;
      result.element = node
        ? node.tagName.toLowerCase()
          + (node.className ? "." + String(node.className).split(" ")[0] : "")
        : "(none)";
    }
  }).observe({ type: "largest-contentful-paint", buffered: true });

  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.name === "first-contentful-paint") result.fcp = entry.startTime;
    }
  }).observe({ type: "paint", buffered: true });

  // Layout shift matters here specifically: a webfont that swaps in late moves
  // text, and this page's headline is set in the serif.
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (!entry.hadRecentInput) result.cls += entry.value;
    }
  }).observe({ type: "layout-shift", buffered: true });

  setTimeout(() => resolve(result), 4000);
});
`;

async function measure({ throttle }) {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  if (throttle) {
    const session = await context.newCDPSession(page);
    await session.send("Network.enable");
    // Chrome DevTools' Slow 4G profile, as Lighthouse's mobile preset uses it.
    await session.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 150,
      downloadThroughput: (1.6 * 1024 * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8,
    });
    await session.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  }

  await page.goto(URL, { waitUntil: "commit" });
  const result = await page.evaluate(COLLECT);
  await browser.close();
  return result;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

for (const throttle of [false, true]) {
  const results = [];
  for (let i = 0; i < RUNS; i++) results.push(await measure({ throttle }));

  const label = throttle ? "Slow 4G + 4x CPU" : "localhost, unthrottled";
  console.log(`\n${label} — ${RUNS} runs of ${URL}`);
  console.log(`  LCP     median ${median(results.map((r) => r.lcp)).toFixed(0)}ms`
    + `  (worst ${Math.max(...results.map((r) => r.lcp)).toFixed(0)}ms)`);
  console.log(`  FCP     median ${median(results.map((r) => r.fcp)).toFixed(0)}ms`);
  console.log(`  CLS     median ${median(results.map((r) => r.cls)).toFixed(3)}`);
  console.log(`  element ${results[0].element}`);
  // Google's "good" thresholds, quoted so the number has something to mean.
  const lcp = median(results.map((r) => r.lcp));
  console.log(`  verdict ${lcp <= 2500 ? "good" : lcp <= 4000 ? "needs improvement" : "poor"}`
    + " (good ≤2500ms, poor >4000ms)");
}
