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
  distDir: process.env.NEXT_DIST_DIR || ".next",

  // The API is proxied through the Next server so the browser makes same-origin
  // requests. The session cookie is httpOnly and SameSite=strict, so a
  // cross-origin call would silently drop it.
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${API}/api/:path*` },
      { source: "/health", destination: `${API}/health` },
    ];
  },
};

export default nextConfig;
