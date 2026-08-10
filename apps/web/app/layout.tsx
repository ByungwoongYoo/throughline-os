import type { Metadata } from "next";
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
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
