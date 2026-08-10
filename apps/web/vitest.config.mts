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
  },
});
