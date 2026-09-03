import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

/**
 * The frontend suite runs in jsdom, not a browser.
 *
 * That is a deliberate limit and worth naming: jsdom has no layout engine, so
 * nothing here can test that a chart is legible or that a focus ring is
 * visible. What it *can* test is the part of this interface that carries
 * scientific meaning — which word is chosen for a verdict, whether a caveat is
 * rendered at all, whether a null degrades to a dash instead of crashing the
 * page. Those are the failures that mislead a researcher, and they are all
 * reachable from the DOM.
 */
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": resolve(__dirname, ".") } },
  test: {
    // happy-dom rather than jsdom: jsdom drags in a CSS colour parser whose
    // chain is ESM-only and cannot be require()d on this Node, and none of
    // these tests need a CSS engine — they assert words and structure, not
    // computed styles.
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.tsx", "tests/**/*.test.ts"],
    /**
     * Every run leaves a record, whether or not anybody thought to pipe it.
     *
     * D048 is open because a run of 1430 reported `1 failed` and the output was
     * not captured, so which test flaked is still unknown — the defect is
     * literally "can fail one test in a way that leaves no name behind". The
     * remedy recorded there was to remember `vitest run 2>&1 | tee` next time,
     * and a step somebody has to remember is one that eventually gets skipped:
     * the same reasoning that put `_headers` into the release build rather than
     * into an upload checklist.
     *
     * `default` stays first, so the terminal is unchanged. The file is written
     * on success too, which is the point — a green run is the baseline the next
     * red one is compared against, and comparing needs both.
     */
    reporters: ["default", "json"],
    outputFile: { json: "./.vitest-last-run.json" },
  },
});
