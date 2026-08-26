// Headless screenshot rig for the landing page. Resolves Playwright from
// apps/web (the one place it is installed) regardless of where this script
// lives, so it runs from anywhere:
//
//   node frontend/tools/shot.mjs frontend/dist/harness.html frontend/shots 0 2268 2950 3550
//
// Args: <harness.html> <outdir> [scrollY...]  (defaults below if none given)
import { createRequire } from "module";
import { mkdirSync } from "fs";
import { resolve } from "path";
const require = createRequire(resolve(process.cwd(), "apps/web/node_modules/"));
const { chromium } = require("playwright");

const [harness, outdir, ...ys] = process.argv.slice(2);
const scrolls = ys.length ? ys.map(Number) : [0, 1300, 2268, 2950, 3550];
mkdirSync(outdir, { recursive: true });

const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (e) => console.log("pageerror:", e.message));
await page.goto("file://" + resolve(harness));
await page.waitForTimeout(2500);
for (const sy of scrolls) {
  await page.evaluate((y) => window.scrollTo(0, y), sy);
  await page.waitForTimeout(700);
  await page.screenshot({ path: outdir + "/sy" + sy + ".png" });
}
await page.setViewportSize({ width: 390, height: 844 });
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(700);
await page.screenshot({ path: outdir + "/mobile.png" });
await browser.close();
console.log("shots written to", outdir);
