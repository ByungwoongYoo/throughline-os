/**
 * The literature sheet (§204, §205).
 *
 * A route of its own rather than a panel inside the workspace, because reading
 * a paper is a different posture from working with a chart: it wants the whole
 * window, and the workspace's spatial controls have nothing to do while a PDF
 * is on screen. §186 says as much from the other direction — a PDF panel should
 * not rotate into arbitrary three-dimensional perspective while somebody is
 * reading it.
 *
 * Everything heavy is behind the component: PDF.js is imported on first use, so
 * a researcher who never opens a paper never downloads a megabyte of parser.
 */

import { PaperReader } from "@/components/literature/PaperReader";

export const metadata = {
  title: "Literature — Throughline",
  description: "Read and mark research papers, on this machine.",
};

export default function LiteraturePage() {
  return (
    <main className="reader-main">
      <h1>Literature</h1>
      <PaperReader />
    </main>
  );
}
