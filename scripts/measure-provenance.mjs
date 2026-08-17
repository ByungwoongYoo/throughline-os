/**
 * How many clicks from a finding back to the source it rests on.
 *
 * `ROADMAP.md` claimed a five-click provenance depth and nothing had ever
 * counted it. This counts it against the running product, with the worked
 * example loaded, by enumerating every interactive element on each screen and
 * following the ones that lead toward the evidence.
 *
 * The answer it produced is that there is no such path (D018): a finding links
 * to nothing. The script is kept so the claim can be re-checked once provenance
 * navigation exists, and so the enumeration is reproducible rather than a
 * recollection of what somebody saw on screen.
 *
 * Needs the full stack. Do NOT point it at a real corpus — it signs in and
 * clicks around. Run it against a scratch instance:
 *
 *   THROUGHLINE_HOME=/tmp/measure .venv/bin/python -m uvicorn \
 *     throughline_api.app:app --port 8099
 *   THROUGHLINE_HOME=/tmp/measure .venv/bin/python -m throughline_workers
 *   cd apps/web && THROUGHLINE_API=http://127.0.0.1:8099 npm run build \
 *     && npm start -- --port 3100
 *
 * then create an account and POST /api/projects/example, and:
 *
 *   npm i playwright && node scripts/measure-provenance.mjs
 */
import { chromium } from "playwright";

const EMAIL = process.env.MEASURE_EMAIL ?? "measure@local.test";
const PASSWORD = process.env.MEASURE_PASSWORD ?? "measure-only-local-throwaway";
const URL = process.env.MEASURE_URL ?? "http://localhost:3100";

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

await page.goto(`${URL}/workspace`, { waitUntil: "networkidle" });
await page.locator("input").first().fill(EMAIL);
await page.locator("input[type=password]").fill(PASSWORD);
await page.getByRole("button", { name: /sign in/i }).click();
await page.waitForTimeout(2500);

/** Every element a researcher could actually click in the working pane. */
const affordances = () => page.evaluate(() => {
  const main = document.querySelector("main") ?? document.body;
  return [...main.querySelectorAll("button,a,[role=button]")]
    .map((element) => (element.innerText || "").trim().slice(0, 70))
    .filter(Boolean);
});

let clicks = 0;
const step = async (locator, label) => {
  await locator.click();
  await page.waitForTimeout(1500);
  clicks += 1;
  console.log(`  click ${clicks}: ${label}`);
};

console.log("\nFrom the overview, the screen a researcher lands on.\n");
await step(page.locator("button.rail-item").filter({ hasText: /^Findings/ }),
           "Findings in the rail");
await step(page.getByText(/tracks/).first(), "the finding");
console.log("\n  the finding offers:", JSON.stringify(await affordances()));

console.log("\nSideways, through Connections.\n");
clicks = 0;
await step(page.locator("button.rail-item").filter({ hasText: /^Connections/ }),
           "Connections in the rail");
await step(page.getByText(/×|tracks/).first(), "the connection");
console.log("\n  the connection offers:", JSON.stringify(await affordances()));

console.log("\nA route to the source exists only if one of those lists names it.\n");
await browser.close();
