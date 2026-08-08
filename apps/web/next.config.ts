import type { NextConfig } from "next";

const API = process.env.THROUGHLINE_API ?? "http://127.0.0.1:8080";

const nextConfig: NextConfig = {
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
