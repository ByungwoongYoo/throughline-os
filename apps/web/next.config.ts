import type { NextConfig } from "next";

const API = process.env.THROUGHLINE_API ?? "http://127.0.0.1:8080";

const nextConfig: NextConfig = {
  /**
   * Where the build output goes, overridable by environment.
   *
   * This exists because of a real incident rather than a preference: running
   * `next build` while the dev server was serving from the same `.next`
   * corrupted it, and every page began returning 500. The symptom looked like a
   * broken application, the cause was two processes writing one directory, and
   * the fix was `rm -rf .next` — which nobody would guess from the error.
   *
   * With this, a build can be verified without touching what is being served:
   *
   *     NEXT_DIST_DIR=.next-check npm run build
   *
   * The default is unchanged, so nothing about the normal path differs.
   *
   * One side effect to discard afterwards: Next adds the chosen directory to
   * `tsconfig.json`'s `include` during the build, so a check build leaves a
   * reference to a directory that is then deleted. `git checkout
   * apps/web/tsconfig.json` after verifying.
   */
  /**
   * A folder of HTML, CSS and JavaScript — no Node process at runtime.
   *
   * The interface was a Node server because `next start` was how it ran, and
   * that made Node a *runtime* dependency of the product: `serve.sh` started it,
   * and without it the API came up and the researcher got a warning line instead
   * of an application. Shipping a second language runtime to every machine, and
   * fetching, checksumming and updating it, is a large amount of machinery to
   * carry for pages that turned out to be entirely static.
   *
   * They are entirely static. Every route in this app already prerendered as
   * static content, there are no route handlers, no middleware, no dynamic
   * segments and no server components doing data fetching — the whole thing is a
   * client app that talks to a local API. Exported, it is **35 MB** against
   * 812 MB of `node_modules` plus a 204 MB Node runtime.
   *
   * What this gives up, stated plainly: server-side rendering, route handlers
   * and middleware are now permanently unavailable. None are used today, and an
   * architecture whose server is a local FastAPI process is unlikely to want
   * them — but it is a door closing, not a free win.
   */
  output: "export",
  distDir: process.env.NEXT_DIST_DIR || ".next",

  /**
   * Same-origin, by two different mechanisms.
   *
   * The session cookie is httpOnly and SameSite=strict, so a cross-origin call
   * drops it **silently** — no error, just a researcher who appears logged out.
   * Every request the browser makes therefore has to share an origin with the
   * API, and there are two ways that happens here.
   *
   * In development, `next dev` serves the pages and proxies `/api` to the API,
   * which is what these rewrites are for. Next warns that they "will not
   * automatically work with output: export" and it is right — the export drops
   * them, which is exactly the intent. They are a development-only device.
   *
   * In production there is no proxy to get wrong: FastAPI serves the exported
   * bundle *and* the API from one process on one port, so same-origin holds by
   * construction rather than by configuration. See
   * `throughline_api/interface.py`.
   */
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${API}/api/:path*` },
      { source: "/health", destination: `${API}/health` },
    ];
  },
};

export default nextConfig;
