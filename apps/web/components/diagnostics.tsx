/**
 * The three pictures that ask whether a screen should be believed.
 *
 * `lib/diagnostics.ts` computes them and had no caller: 231 lines of volcano,
 * Q–Q and funnel arithmetic, tested, and reachable only from its own test
 * file. That is the defect this repository finds more often than any other,
 * and here the unreachable thing was the standard evidence that a discovery
 * run's results are not just what testing many things at once produces —
 * which is the discipline the whole product is built around.
 *
 * No new renderer. `Cartesian` already draws a scatter, and a volcano is
 * effect against significance, a funnel is effect against precision, and a
 * Q–Q is expected against observed. What was missing was never the drawing.
 */

import { useMemo, useState } from "react";
import { Cartesian } from "./charts/Cartesian";
import { ViewTabs } from "./ViewTabs";
import { Empty, Failure, Loading } from "./primitives";
import { useApi } from "@/lib/useApi";
import type { Connection } from "@/lib/api";
import {
  funnel, nullDiagonal, quantileQuantile, readAs, volcano, type Tested,
} from "@/lib/diagnostics";

type Kind = "volcano" | "qq" | "funnel";

/** A connection is a test that was run, which is what these plots are about. */
function asTested(connections: Connection[]): Tested[] {
  return connections.map((c) => ({
    id: c.id,
    label: `${c.left_variable} and ${c.right_variable}`,
    estimate: c.estimate,
    pValue: c.p_value,
    qValue: c.q_value,
    survived: c.survived_correction,
  }));
}

const AXES: Record<Kind, { x: string; y: string; title: string }> = {
  volcano: { x: "Effect", y: "Evidence against no effect",
             title: "Effect against evidence" },
  qq: { x: "Expected if nothing were there", y: "Observed",
        title: "Observed against expected" },
  funnel: { x: "Effect", y: "Precision", title: "Effect against precision" },
};

export function Diagnostics({ projectId }: { projectId: string }) {
  const [kind, setKind] = useState<Kind>("volcano");
  const connections = useApi<Connection[]>(
    `/api/projects/${projectId}/connections?limit=500`);

  const tested = useMemo(
    () => asTested(connections.data ?? []), [connections.data]);

  const points = useMemo(() => {
    if (kind === "volcano") return volcano(tested);
    if (kind === "qq") return quantileQuantile(tested);
    return funnel(tested);
  }, [kind, tested]);

  if (connections.error) {
    return <Failure error={connections.error} retry={connections.reload} />;
  }
  if (connections.loading) {
    return <Loading rows={4} label="Reading what was tested" />;
  }

  const axes = AXES[kind];

  return (
    <>
      <h2>Is this a screen worth believing?</h2>
      <p className="lede">
        A discovery run tests many pairs at once. These are the standard
        pictures for that situation — they say nothing about any one result and
        everything about whether the set of them looks like signal or like the
        shape testing alone produces.
      </p>

      <ViewTabs
        name="diagnostics" label="Which picture"
        value={kind} onChange={(next) => setKind(next as Kind)}
        options={[["volcano", "Effect and evidence"],
                  ["qq", "Against chance"],
                  ["funnel", "Effect and precision"]] as const}
      />

      {points.length === 0 ? (
        <Empty
          title="Nothing has been tested yet"
          hint="Run discovery on a dataset; these plots describe a family of
                tests, not a single one."
        />
      ) : (
        <>
          <Cartesian
            data={points.map((p) => ({
              id: p.id, x: p.x, y: p.y, group: p.group, label: p.label,
            }))}
            mark="point"
            xLabel={axes.x}
            yLabel={axes.y}
            title={axes.title}
            caption={readAs(kind, points)}
          />
          {/* The reference the reader compares against, drawn as its own
              series rather than described in prose — a diagonal somebody has
              to imagine is one they will imagine in the flattering place. */}
          {kind === "qq" && nullDiagonal(points).length > 0 && (
            <p className="note">
              The diagonal is what a screen containing nothing would produce.
            </p>
          )}
        </>
      )}
    </>
  );
}
