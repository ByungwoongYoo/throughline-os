/**
 * The research loop, as a function of the project's real counts.
 *
 * Six steps — add sources, profile a dataset, generate and test candidates,
 * try to destroy what survived, record a finding, communicate it — each ticked
 * from the discovery map rather than from anything a screen remembers, so the
 * list can never claim progress the database does not have (§70).
 *
 * This lived inside the Overview as a local array, which meant the one place
 * the product knew where a researcher was in their work was one card on one
 * screen. Every other screen showed a list and said nothing about what came
 * next (T135). Lifted here so the shell, the inspector and the Overview all
 * read the same steps and cannot disagree about which one is next.
 */

import type { Section } from "@/components/Shell";
import type { DiscoveryMap } from "./api";

export type LoopStepId =
  | "sources" | "profile" | "discover" | "validate" | "record" | "communicate";

export type LoopStep = {
  id: LoopStepId;
  /** The step, as a verb phrase a researcher would say. */
  label: string;
  /** One sentence on what it means here, in the product's own terms. */
  hint: string;
  /** Where the step is taken. */
  go: Section;
  done: boolean;
};

const sum = (counts: Record<string, number> | undefined) =>
  Object.values(counts ?? {}).reduce((a, b) => a + b, 0);

/** The six steps, each marked done or not from the map. */
export function loopSteps(map: DiscoveryMap): LoopStep[] {
  const connections = sum(map.connections);
  const findings = sum(map.findings);
  const validated = (map.connections?.validated ?? 0) + (map.connections?.replicated ?? 0);
  return [
    {
      id: "sources",
      done: (map.counts.sources ?? 0) > 0,
      label: "Add sources",
      hint: "Drop a dataset and the papers around it. Files never leave this machine.",
      go: "sources",
    },
    {
      id: "profile",
      done: (map.counts.datasets ?? 0) > 0,
      label: "Profile a dataset",
      hint: "Discovery works from the profiled schema, so it needs tabular data.",
      go: "sources",
    },
    {
      id: "discover",
      done: connections > 0,
      label: "Generate and test candidates",
      hint: "Every pair is tested, then corrected for how many tests ran.",
      go: "discover",
    },
    {
      id: "validate",
      done: validated > 0,
      label: "Try to destroy what survived",
      hint: "Bootstrap, outliers, missingness, confounders. Promotion is earned.",
      go: "connections",
    },
    {
      id: "record",
      done: findings > 0,
      label: "Record a finding",
      hint: "A finding must carry both the evidence for it and the evidence against it.",
      /*
       * To the connections, which is where the recording happens.
       *
       * This sent the researcher to the Findings list, which has no way to
       * record one — deliberately: a finding is recorded *from* a result, and
       * a bare "new finding" button on a list invites one written from memory
       * with nothing attached. That argument is right and the placement stays.
       *
       * But this list promises to be "the place you start the next step", and
       * for this step it was the one place the step could not be started. The
       * Findings empty state even says "validate a connection, then record
       * what it shows" — accurate instruction, pointing somewhere the reader
       * had just been sent away from.
       */
      go: "connections",
    },
    {
      id: "communicate",
      done: (map.counts.reports ?? 0) > 0,
      label: "Communicate it",
      hint: "A report references its evidence rather than copying it, so the two cannot drift apart.",
      go: "reports",
    },
  ];
}

/**
 * The step to take next: the first one not done, in loop order.
 *
 * First-not-done rather than last-done-plus-one, because the loop is not
 * strictly sequential — a finding can be recorded before a validation has
 * run — and the honest "next" is the earliest gap, not the step after the
 * latest tick. Null when everything is done.
 */
export function nextStep(steps: LoopStep[]): LoopStep | null {
  return steps.find((s) => !s.done) ?? null;
}

/**
 * The step the project is on.
 *
 * The server's recommendation wins when it names a step (`recommended_step`,
 * chosen by the same ladder that writes `recommended_next_action`), because
 * it knows things the counts alone do not — that a candidate already carries
 * its evidence, that work is still in flight. The earliest gap is the
 * fallback, so an older server that sends no step still gets an answer. Null
 * when there is nothing left to do.
 */
export function currentStep(map: DiscoveryMap): LoopStep | null {
  const steps = loopSteps(map);
  const named = map.recommended_step
    ? steps.find((s) => s.id === map.recommended_step) ?? null
    : null;
  return named ?? nextStep(steps);
}

/** Where taking a step lands, and what the control that takes it says. */
export type StepTarget = { section: Section; item: string | null; label: string };

/**
 * Steps 4 and 5 act on one connection, and the server already ranks them
 * (`top_connections`, strongest first, only those a validation could act on).
 * So the control opens that connection and says so by name, rather than
 * landing the researcher on a six-row table with nothing saying which row the
 * recommendation meant. Every other step lands on its section.
 */
export function stepTarget(
  step: LoopStep, map: DiscoveryMap,
  /** Approved display names by raw column name, so the label never shows
   *  `resistance_pct` where the project has decided on a better name (Part C). */
  labels: Record<string, string> = {},
): StepTarget {
  const top = map.top_connections?.[0];
  const name = (raw: string) => labels[raw] ?? raw;
  const pair = top ? `${name(top.left_variable)} × ${name(top.right_variable)}` : null;
  switch (step.id) {
    case "validate":
      return top
        ? { section: "connections", item: top.id, label: `Validate ${pair}` }
        : { section: "connections", item: null, label: "Validate a connection" };
    case "record":
      return top
        ? { section: "connections", item: top.id, label: `Record a finding from ${pair}` }
        : { section: "connections", item: null, label: "Record a finding" };
    case "communicate":
      return { section: "reports", item: null, label: "Draft a report" };
    case "profile":
      return { section: "sources", item: null, label: "Add a dataset" };
    default:
      return { section: step.go, item: null, label: step.label };
  }
}
