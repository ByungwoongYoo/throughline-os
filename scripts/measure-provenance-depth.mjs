/**
 * How deep is provenance, in clicks — and is the path there at all?
 *
 * The brief sets a five-click target for getting from a finding to what
 * produced it. This drives the real workspace against a real seeded example
 * and counts, rather than reasoning about the routes.
 *
 * It walks with the KEYBOARD deliberately. A path that exists only for a mouse
 * is not five clicks deep for everybody, and the first run of this found
 * exactly that: the finding card was a bare `div` with `cursor: pointer`, so
 * the one click that mattered had no tab stop at all.
 *
 * Usage: ./scripts/dev.sh, then
 *   node scripts/measure-provenance-depth.mjs
 * Needs playwright installed where you run it (it is deliberately not a
 * dependency of apps/web — see scripts/measure-lcp.mjs).
 */
import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const text = () => page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));

await page.goto(BASE + "/workspace", { waitUntil: "networkidle" });
await page.getByRole("button", { name: /create an account/i }).click();
await page.waitForTimeout(500);
const inputs = page.locator("form input");
await inputs.nth(0).fill("Keyboard Test");
await inputs.nth(1).fill(`kb${Date.now() % 100000}@lab.local`);
await inputs.nth(2).fill("throughline-depth-local");
await page.getByRole("button", { name: /create account and continue/i }).click();
await page.waitForTimeout(2500);
await page.getByRole("button", { name: /worked example/i }).click();
for (let i = 0; i < 60; i++) {
  const n = await page.evaluate(async () => {
    const ps = await (await fetch("/api/projects")).json();
    const p = ps.find((x) => x.name.startsWith("Example"));
    if (!p) return 0;
    const r = await fetch(`/api/projects/${p.id}/findings`);
    return r.ok ? (await r.json()).length : 0;
  });
  if (n) break;
  await page.waitForTimeout(2000);
}
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1500);

// Reach the Findings rail item with the keyboard.
await page.getByRole("button", { name: /^Findings/ }).focus();
await page.keyboard.press("Enter");
await page.waitForTimeout(1200);
console.log("after Enter on Findings:", (await text()).slice(300, 420));

// Now Tab until focus lands on the finding card, then activate it with Enter.
let landed = false;
for (let i = 0; i < 40; i++) {
  await page.keyboard.press("Tab");
  const focused = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return null;
    return {
      tag: el.tagName.toLowerCase(),
      cls: (el.className || "").toString().split(" ")[0],
      role: el.getAttribute("role"),
      text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 45),
    };
  });
  if (focused && focused.cls === "card" && focused.role === "button") {
    console.log(`\nTab ${i + 1}: focus reached the finding card`, focused);
    landed = true;
    break;
  }
}
console.log("\nkeyboard reached the finding card:", landed);

if (landed) {
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1300);
  const after = await text();
  const opened = after.includes("Claims and their evidence");
  console.log("Enter opened the finding:", opened);
  console.log("evidence on screen:",
    after.includes("supporting") ? after.slice(after.indexOf("CANDIDATE"), after.indexOf("CANDIDATE") + 180) : "(none)");
}
await browser.close();
