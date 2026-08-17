/**
 * D006 — canvas rasterisation on the knowledge graph, measured.
 *
 * D005 measured the JavaScript on the critical path (force ticks, hit-testing)
 * and said in as many words that those numbers are not a frame rate, because
 * they exclude the compositor actually painting the canvas. This is that
 * missing half: a DevTools trace, with the raster and paint work summed while
 * the graph is dragged and genuinely redrawing.
 *
 * What it found: RasterTask 0.57ms at its worst against a 16.67ms frame budget.
 * Rasterisation is not a cost here and never was.
 *
 * That result generalises further than the sample does, and the reason is worth
 * keeping. Raster work scales with the canvas *area*, not with how much is drawn
 * into it — a 794x518 canvas costs the same to rasterise whether it holds ten
 * nodes or five thousand. What scales with node count is the JS draw and the
 * force ticks, and D005 measured those. So a small graph is a fair sample for
 * this question and a useless one for that.
 *
 * Needs the full stack and a signed-in workspace. Run it against a scratch
 * instance, never a real corpus — see `measure-provenance.mjs` for the setup.
 */
import { chromium } from "playwright";

const EMAIL = process.env.MEASURE_EMAIL ?? "measure@local.test";
const PASSWORD = process.env.MEASURE_PASSWORD ?? "measure-only-local-throwaway";
const URL = process.env.MEASURE_URL ?? "http://localhost:3100";

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
await p.goto(`${URL}/workspace`, { waitUntil: "networkidle" });
await p.locator("input").first().fill(EMAIL);
await p.locator("input[type=password]").fill(PASSWORD);
await p.getByRole("button", { name: /sign in/i }).click();
await p.waitForTimeout(2500);

await p.locator("button.rail-item").filter({ hasText: /^Evidence graph/ }).click();
await p.waitForTimeout(2000);

const canvases = await p.evaluate(() =>
  [...document.querySelectorAll("canvas")].map(c => ({
    w: c.width, h: c.height, cssW: Math.round(c.getBoundingClientRect().width),
    cssH: Math.round(c.getBoundingClientRect().height) })));
console.log("canvases on the graph view:", JSON.stringify(canvases));
if (!canvases.length) { console.log("NO CANVAS — nothing to rasterise here"); await b.close(); process.exit(0); }


const session = await ctx.newCDPSession(p);
await session.send("Tracing.start", {
  categories: "disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.frame,devtools.timeline",

});

// Provoke real repaints: drag across the canvas so the graph redraws.
const box = await p.locator("canvas").first().boundingBox();
for (let i = 0; i < 30; i += 1) {
  await p.mouse.move(box.x + 100 + i * 8, box.y + 100 + (i % 7) * 10);
  await p.waitForTimeout(16);
}
await p.waitForTimeout(1500);

const events = [];
session.on("Tracing.dataCollected", (d) => events.push(...d.value));
session.on("Tracing.dataCollected", (d) => events.push(...d.value));
await new Promise(async (resolve) => {
  session.on("Tracing.tracingComplete", resolve);
  await session.send("Tracing.end");
});


const byName = {};
for (const e of events) {
  if (e.ph !== "X" || !e.dur) continue;
  byName[e.name] = byName[e.name] ?? { count: 0, totalMs: 0, maxMs: 0 };
  const ms = e.dur / 1000;
  byName[e.name].count += 1;
  byName[e.name].totalMs += ms;
  byName[e.name].maxMs = Math.max(byName[e.name].maxMs, ms);
}
const interesting = ["RasterTask", "Paint", "PaintImage", "Layerize", "UpdateLayer",
                     "CompositeLayers", "Commit", "DrawFrame", "GPUTask",
                     "FunctionCall", "Layout", "UpdateLayoutTree"];
console.log("\nname                 count   total ms   mean ms   max ms");
for (const name of interesting) {
  const s = byName[name];
  if (!s) continue;
  console.log(`${name.padEnd(20)} ${String(s.count).padStart(5)}   ${s.totalMs.toFixed(1).padStart(8)}  ${(s.totalMs/s.count).toFixed(2).padStart(8)}  ${s.maxMs.toFixed(2).padStart(7)}`);
}
await b.close();
