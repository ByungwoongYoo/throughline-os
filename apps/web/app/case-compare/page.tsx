"use client";

/**
 * Opening straight into a case comparison.
 *
 * A thin route over `CaseCompare`, which is also the Compare screen's
 * "Scan ↔ scan" tab. This exists so a link can go directly to it — a
 * researcher handed a case does not want to find a tab first.
 */

import Link from "next/link";
import { CaseCompare } from "@/components/imaging/CaseCompare";

export default function CaseComparePage() {
  return (
    <main>
      <CaseCompare standalone />
      <p className="case-note" style={{ maxWidth: 1100, margin: "0 auto 40px" }}>
        <Link href="/">Back</Link> · <Link href="/charts-3d">Spatial charts</Link>
      </p>
    </main>
  );
}
