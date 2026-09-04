"use client";

/**
 * P10 — set regions (Part F).
 *
 * Which papers report which outcomes; which datasets carry which variables;
 * which cohorts meet which criteria. Overlap between named sets.
 *
 * **This draws an UpSet plot, not a Venn diagram, and the reason is not taste.**
 *
 * A Venn or Euler diagram tries to encode every intersection as an area whose
 * size is the count. For three sets that is achievable with circles. For four
 * it is not — no arrangement of four circles produces all fifteen regions, and
 * the standard workaround (ellipses) makes the areas no longer proportional.
 * For five or more, area-proportional Euler diagrams are provably impossible in
 * general. Every tool that offers a five-set Venn is showing you regions whose
 * sizes do not mean what the diagram implies.
 *
 * An UpSet plot drops the metaphor and puts each intersection on a common
 * baseline as a bar. It scales to any number of sets, every count is read by
 * position along a common scale — the most accurate channel there is — and
 * nothing is approximated.
 *
 * **Empty intersections are shown, not omitted.** That a combination has zero
 * members is frequently the finding: no dataset carries both variables, so the
 * question cannot be answered by joining them. Hiding empty rows would hide it.
 * They are rendered at zero with the count printed.
 */

import { useMemo } from "react";
import { max } from "d3-array";
import { scaleLinear } from "d3-scale";
import { categorical } from "@/lib/tokens";
import { ChartTable } from "./ChartTable";
import { ChartTooltip, readable, useChartHover } from "./interaction";

export type SetMember = {
  /** Stable identity. */
  id: string;
  /** Display name of the item ("Karim 2019"). */
  label: string;
  /** Ids of the sets this item belongs to. */
  sets: string[];
};

export type NamedSet = { id: string; label: string };

const M = { top: 16, right: 16, bottom: 8, left: 200 };
const ROW = 24;
const BARS = 150;

/** Every combination present in the data, plus the empty ones between them. */
function intersections(sets: NamedSet[], members: SetMember[]) {
  const order = new Map(sets.map((s, i) => [s.id, i]));
  const key = (ids: string[]) =>
    [...ids].filter((id) => order.has(id))
      .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)).join("\u0000");

  const counts = new Map<string, string[]>();
  for (const m of members) {
    const k = key(m.sets);
    if (!k) continue;              // belongs to no named set
    (counts.get(k) ?? counts.set(k, []).get(k)!).push(m.label);
  }

  // Every pairwise combination is enumerated whether or not it occurs, because
  // "no item is in both of these" is a finding and an omitted row hides it.
  for (let i = 0; i < sets.length; i += 1) {
    for (let j = i + 1; j < sets.length; j += 1) {
      const k = key([sets[i].id, sets[j].id]);
      if (!counts.has(k)) counts.set(k, []);
    }
  }

  return [...counts.entries()]
    .map(([k, labels]) => ({
      key: k,
      sets: k.split("\u0000"),
      count: labels.length,
      labels,
    }))
    .sort((a, b) => b.count - a.count
                 || a.sets.length - b.sets.length
                 || a.key.localeCompare(b.key));
}

export function SetRegions({
  sets, members, itemLabel, title, caption, width = 760,
}: {
  sets: NamedSet[];
  members: SetMember[];
  /** What the items are, in the reader's words — "papers", "datasets". */
  itemLabel: string;
  title?: string;
  caption?: string;
  width?: number;
}) {
  const hoverUI = useChartHover();
  const rows = useMemo(() => intersections(sets, members), [sets, members]);
  /*
   * The row under the pointer.
   *
   * This was `const hit = null`, with the tooltip mounted below and given
   * `rows={[]}`. Hovering therefore dimmed the other combinations and reported
   * nothing — on a chart whose entire content is how many items fall in each
   * combination. The highlight worked, which is what made it look finished.
   */
  const hit = rows.find((r) => r.key === hoverUI.hovered) ?? null;
  const named = new Map(sets.map((s) => [s.id, s.label]));
  const peak = max(rows, (r) => r.count) ?? 0;
  const height = M.top + M.bottom + rows.length * ROW;
  const scale = scaleLinear().domain([0, peak || 1]).range([0, BARS]);

  const setTotals = useMemo(() => new Map(sets.map((s) => [
    s.id, members.filter((m) => m.sets.includes(s.id)).length,
  ])), [sets, members]);

  const dotX = (i: number) => M.left - 176 + i * 22;
  const empty = rows.filter((r) => r.count === 0);

  const tableColumns = [
    { key: "combination", header: "Combination" },
    { key: "count", header: "Count", numeric: true },
  ];
  const tableRows = rows.map((r) => ({
    id: r.key,
    combination: r.sets.map((id) => sets.find((s) => s.id === id)?.label ?? id).join(" + "),
    count: r.count,
  }));

  return (
    <figure className="chart">
      {title && <figcaption className="chart-title">{title}</figcaption>}

      <svg
        className="chart-svg" style={{ maxWidth: width }} width="100%" viewBox={`0 0 ${width} ${height}`} role="img"
        aria-label={
          `${title ?? "Set intersections"}. ${members.length} ${itemLabel} across `
          + `${sets.length} sets, ${rows.length} distinct combinations. `
          + (empty.length
             ? `${empty.length} combination${empty.length > 1 ? "s have" : " has"} no ${itemLabel}.`
             : `Every combination has at least one member.`)}
      >
        {/* Set names, with their totals, above the membership dots. */}
        {sets.map((s, i) => (
          <text key={s.id} x={dotX(i)} y={M.top - 4} textAnchor="middle"
                className="chart-tick">
            {s.label}
            <tspan className="numeric" dx={0} dy={0}> </tspan>
          </text>
        ))}

        {rows.map((row, r) => {
          const y = M.top + r * ROW + ROW / 2;
          const on = new Set(row.sets);
          const first = sets.findIndex((s) => on.has(s.id));
          const last = sets.map((s) => on.has(s.id)).lastIndexOf(true);
          return (
            // Keyed by the combination itself, so a row survives re-sorting as
            // the same DOM node and slides rather than being redrawn.
            <g key={row.key} className="upset-row"
                {...hoverUI.markProps(row.key)} style={{ opacity: hoverUI.emphasis(row.key) }}>
              {/* The connector, so a combination reads as one thing. */}
              {last > first && (
                <line x1={dotX(first)} x2={dotX(last)} y1={y} y2={y}
                      className="upset-connector" />
              )}
              {sets.map((s, i) => (
                <circle key={s.id} cx={dotX(i)} cy={y} r={5}
                        className={on.has(s.id) ? "upset-on" : "upset-off"} />
              ))}

              <rect x={M.left} y={y - 8} height={16} rx={1}
                    width={Math.max(0, scale(row.count))}
                    fill={row.count === 0 ? "transparent" : categorical[0]}
                    fillOpacity={0.82} />
              {/* Printed for every row, including the zeroes — a bar of length
                  zero is invisible and the count is the point. */}
              <text x={M.left + Math.max(0, scale(row.count)) + 7} y={y} dy="0.32em"
                    className={row.count === 0 ? "upset-zero numeric" : "tile-value numeric"}>
                {row.count}
              </text>
            </g>
          );
        })}
      </svg>

      <figcaption className="chart-caption">
        {caption ? `${caption} ` : ""}
        {members.length.toLocaleString()} {itemLabel} across {sets.length} sets
        ({sets.map((s) => `${s.label} ${setTotals.get(s.id) ?? 0}`).join(", ")}).
        Each row is one exact combination — an item counted in a row belongs to
        those sets and no others, so the rows sum to the total rather than
        overlapping.{" "}
        {empty.length > 0 && (
          <>
            <b>
              {empty.length} combination{empty.length > 1 ? "s have" : " has"} no{" "}
              {itemLabel} at all
            </b>{" "}
            ({empty.slice(0, 3).map((r) => r.sets
                .map((id) => sets.find((s) => s.id === id)?.label ?? id)
                .join(" + ")).join("; ")}
            {empty.length > 3 && `; and ${empty.length - 3} more`}), which is
            shown rather than dropped: it means no {itemLabel} bridges those
            sets, so nothing can be compared across them.{" "}
          </>
        )}
        Drawn as bars on a common baseline rather than as overlapping circles —
        past four sets no arrangement of circles can show every intersection at
        a truthful size.
      </figcaption>

      <ChartTooltip
        pointer={hoverUI.pointer}
        title={hit ? hit.sets.map((id) => named.get(id) ?? id).join(" and ")
                   : undefined}
        rows={hit
          ? [{
              label: itemLabel,
              /*
               * An empty combination is a finding, not a missing value: those
               * rows are enumerated on purpose so that "no item is in both of
               * these" can be read. `0` beside a count reads as absence of
               * data, so it is said in words instead.
               */
              value: hit.count === 0 ? "none in common" : readable(hit.count),
            }]
          : []}
      />

      <ChartTable
        highlightId={hoverUI.hovered}
        onHighlight={hoverUI.setHovered}
        columns={tableColumns}
        rows={tableRows}
        label={title ?? `${itemLabel} by set combination`}
      />
    </figure>
  );
}
