import type { Metadata } from "next";
import "./fonts.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Throughline",
  description: "An AI-native research operating system",
};

/**
 * Applied before first paint.
 *
 * Reading the stored theme in an effect would mean a dark-mode user sees a
 * white page for one frame on every navigation — the flash that makes a theme
 * toggle feel broken even when it works. This runs synchronously in the head,
 * before the body renders, which is the only way to avoid it.
 *
 * Kept deliberately tiny and dependency-free: it must not be able to throw, or
 * the page never paints at all.
 */
const THEME_SCRIPT = `
try {
  var t = localStorage.getItem("throughline-theme");
  if (t === "light" || t === "dark") {
    document.documentElement.setAttribute("data-theme", t);
  }
} catch (e) {}
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Tells the browser which form controls and scrollbars to draw, so
            native UI matches the page rather than staying stubbornly light. */}
        <meta name="color-scheme" content="light dark" />
        {/* The two families that draw text above the fold: the interface sans
            and the serif the landing headline and the sign-in screen are set
            in. Without a preload the browser only discovers them after the
            stylesheet parses, which is late enough to swap visibly. The Latin
            subsets only — Latin-Extended is for glyphs that may never appear,
            and preloading a file the page never uses is a wasted round trip.
            `crossOrigin` is required on font preloads even same-origin; omit
            it and the browser fetches the file a second time. */}
        <link rel="preload" href="/fonts/inter-latin.woff2" as="font"
              type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/source-serif-4-latin.woff2" as="font"
              type="font/woff2" crossOrigin="anonymous" />
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
