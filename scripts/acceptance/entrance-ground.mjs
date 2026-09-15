/**
 * The ring alone, with every panel's copy hidden.
 *
 * Measuring contrast from the normal screenshot samples the glyphs, so white
 * type over a bright band reports white against white. Hiding `.panel` leaves
 * exactly the ground the type sits on, and the text boxes are reported with it
 * so the measurement knows where to look.
 */
import { createRequire } from "module";
import { mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
const require = createRequire(resolve("/home/phenyl/throughline-os", "apps/web/node_modules/"));
const { chromium } = require("playwright");
const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1584, height: 993 } });
await page.goto("http://localhost:3111/", { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(3500);
// The chapters live in the runway; the document continues past them now.
const height = await page.evaluate(() => {
  const r = document.querySelector(".runway");
  return r ? r.offsetHeight : document.body.scrollHeight;
});
// The four chapters, then the traced chain below them: its cards sit on the
// same ring and carry the same risk.
const names = ["1A", "1B", "1C", "1D", "trace"];
const boxes = {};
for (let i = 0; i < names.length; i++) {
  const y = i < 4
    ? Math.round((height - 993) * (i / 3))
    // Far enough into the chain that every stop has arrived.
    : await page.evaluate(() => {
        const el = document.querySelector(".trace-runway");
        return el ? Math.round(el.getBoundingClientRect().top + window.scrollY
                               + el.offsetHeight - window.innerHeight - 40) : 0;
      });
  await page.evaluate((v) => window.scrollTo(0, v), y);
  await page.waitForTimeout(2000);
  // Where the type is, before it is hidden.
  boxes[names[i]] = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll(
      ".panel h1, .panel h2, .panel .lede, .panel p, .panel blockquote,"
      + " .trace-head .display, .trace-head .lede,"
      + " .trace-title, .trace-note, .trace-facts dd")
      .forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width > 40 && r.height > 10 && r.top > -20 && r.bottom < 1010
            && getComputedStyle(el).visibility !== "hidden") {
          out.push({ t: (el.textContent || "").trim().slice(0, 34),
                     box: [Math.round(r.left), Math.round(r.top),
                           Math.round(r.right), Math.round(r.bottom)] });
        }
      });
    return out;
  });
    /*
   * The glyphs go, the ground stays.
   *
   * `visibility: hidden` on the panel removed the scrim behind the text along
   * with the text, so the measurement reported the bare band and said a fixed
   * block still failed. Transparent type leaves every background, rule and
   * scrim exactly where it is, which is the ground the contrast is against.
   */
  await page.addStyleTag({ content:
    ".panel, .panel *, .trace-section, .trace-section * { color: transparent !important;"
    + " text-shadow: none !important; -webkit-text-fill-color: transparent !important; }" });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${names[i]}.png` });
  await page.evaluate(() => {
    document.querySelectorAll("style").forEach((s) => {
      if (s.textContent?.includes("color: transparent !important")) s.remove();
    });
  });
  await page.waitForTimeout(300);
}
writeFileSync(`${OUT}/boxes.json`, JSON.stringify(boxes, null, 1));
console.log("ground captured");
await browser.close();
