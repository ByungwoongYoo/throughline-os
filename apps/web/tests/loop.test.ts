/**
 * The research loop is computed from the project, never remembered by a screen.
 *
 * The six steps used to be a local array inside the Overview, so the one place
 * the product knew where a researcher was in their work was one card on one
 * screen. `lib/loop.ts` makes the same list available to the shell and the
 * inspector; these tests pin what "done" and "next" mean, because a step ticked
 * on a count the database does not have is a claim of progress, and the wrong
 * "next" sends a first-time researcher to the wrong screen.
 */

import { describe, expect, it } from "vitest";
import { SECTION_IDS } from "@/lib/section-url";
import { currentStep, loopSteps, nextStep, stepTarget } from "@/lib/loop";

function map(counts: Record<string, number> = {},
             connections: Record<string, number> = {},
             findings: Record<string, number> = {}) {
  return {
    counts: { sources: 0, papers: 0, datasets: 0, analyses: 0, contradictions: 0,
              figures: 0, reports: 0, in_flight: 0, ...counts },
    connections, findings, top_connections: [], recommended_next_action: "",
  };
}

describe("the loop's six steps", () => {
  it("are six, in the order the work happens, each leading to a real section", () => {
    const steps = loopSteps(map());
    expect(steps.map((s) => s.id)).toEqual(
      ["sources", "profile", "discover", "validate", "record", "communicate"]);
    for (const step of steps) {
      expect(SECTION_IDS as readonly string[]).toContain(step.go);
    }
  });

  it("start with adding sources on an empty project", () => {
    const steps = loopSteps(map());
    expect(steps.every((s) => !s.done)).toBe(true);
    expect(nextStep(steps)?.id).toBe("sources");
    expect(nextStep(steps)?.go).toBe("sources");
  });

  it("tick each step from the count that proves it", () => {
    /** Sources present but nothing profiled: the dataset step is the gap. */
    expect(nextStep(loopSteps(map({ sources: 2 })))?.id).toBe("profile");
    /** A profiled dataset, no sweep yet. */
    expect(nextStep(loopSteps(map({ sources: 2, datasets: 1 })))?.id).toBe("discover");
    /** Candidates tested, none validated. */
    expect(nextStep(loopSteps(map({ sources: 2, datasets: 1, analyses: 6 },
                                  { candidate: 5, exploratory: 1 })))?.id).toBe("validate");
  });

  it("counts a replicated connection as validated", () => {
    const steps = loopSteps(map({ sources: 1, datasets: 1, analyses: 1 }, { replicated: 1 }));
    expect(steps.find((s) => s.id === "validate")?.done).toBe(true);
  });

  it("names the earliest gap as next, not the step after the latest tick", () => {
    /**
     * The worked example records a finding before anything is validated. The
     * honest next step is the validation that is missing, not "communicate"
     * because a later step happens to be done.
     */
    const steps = loopSteps(map({ sources: 2, datasets: 1, analyses: 6 },
                                { candidate: 5, exploratory: 1 }, { candidate: 1 }));
    expect(steps.find((s) => s.id === "record")?.done).toBe(true);
    expect(nextStep(steps)?.id).toBe("validate");
  });

  it("sends recording to the connections, where a finding is made from a result", () => {
    /** Deliberate (recordfinding.tsx): a finding is recorded FROM a result,
     *  never from a bare button on the Findings list. */
    expect(loopSteps(map()).find((s) => s.id === "record")?.go).toBe("connections");
  });

  it("has nothing next once everything is done", () => {
    const steps = loopSteps(map({ sources: 2, datasets: 1, analyses: 6, reports: 1 },
                                { validated: 1 }, { candidate: 1 }));
    expect(steps.every((s) => s.done)).toBe(true);
    expect(nextStep(steps)).toBeNull();
  });
});

describe("the step the project is on, and where taking it lands", () => {
  const TOP = {
    id: "con_top", left_variable: "consumption", right_variable: "resistance",
    method: "pearson_correlation", lifecycle_status: "exploratory", estimate: 0.88,
    p_value: 0, q_value: 0, effect_size: 0.88, effect_size_name: "r", sample_size: 120,
    evidence_quality: "strong", rank_score: 1, analysis_run_id: "arun_1",
  } as never;

  it("defers to the step the server names", () => {
    /** The server knows a candidate already carries evidence; the counts
     *  alone would call step 4 next while the server says communicate. */
    const m = { ...map({ sources: 2, datasets: 1, analyses: 6 }, { exploratory: 1 }, { candidate: 1 }),
                recommended_step: "communicate" as const };
    expect(currentStep(m)?.id).toBe("communicate");
  });

  it("falls back to the earliest gap when the server names nothing", () => {
    expect(currentStep(map({ sources: 2 }))?.id).toBe("profile");
    expect(currentStep({ ...map({ sources: 2 }), recommended_step: null })?.id).toBe("profile");
  });

  it("ignores a step id it does not know", () => {
    const m = { ...map({ sources: 2 }), recommended_step: "teleport" as never };
    expect(currentStep(m)?.id).toBe("profile");
  });

  it("opens the strongest connection by name for validating and recording", () => {
    const m = { ...map({ sources: 2, datasets: 1, analyses: 6 }, { exploratory: 1 }), top_connections: [TOP] };
    const steps = loopSteps(m);
    const validate = stepTarget(steps.find((s) => s.id === "validate")!, m);
    expect(validate).toEqual({ section: "connections", item: "con_top", label: "Validate consumption × resistance", kind: "connection" });
    // Recording is from a *validated* result. With only an exploratory one
    // ranked there is none to open. This used to assert the exploratory
    // connection here — the button opening what its sentence is not about.
    const record = stepTarget(steps.find((s) => s.id === "record")!, m);
    expect(record).toEqual({ section: "connections", item: null, label: "Record a finding" });
  });

  it("lands on the list, honestly labelled, when nothing is ranked yet", () => {
    const steps = loopSteps(map());
    expect(stepTarget(steps.find((s) => s.id === "validate")!, map()))
      .toEqual({ section: "connections", item: null, label: "Validate a connection" });
  });

  it("names every other step's destination by its section", () => {
    const steps = loopSteps(map());
    expect(stepTarget(steps[0], map())).toEqual({ section: "sources", item: null, label: "Add sources" });
    expect(stepTarget(steps[1], map()).section).toBe("sources");
    expect(stepTarget(steps[2], map())).toEqual({ section: "discover", item: null, label: "Generate and test candidates" });
    expect(stepTarget(steps[5], map())).toEqual({ section: "reports", item: null, label: "Draft a report" });
  });
});

describe("the action label uses the project's approved names", () => {
  it("prefers a display label to a raw column name", () => {
    // `lifecycle_status` is on every ranked connection the server sends; a
    // fixture without one described a row that cannot exist.
    const TOP = { id: "con_top", left_variable: "consumption_ddd", right_variable: "resistance_pct",
      lifecycle_status: "exploratory" } as never;
    const m = { ...map({ sources: 2, datasets: 1, analyses: 6 }, { exploratory: 1 }), top_connections: [TOP] };
    const validate = loopSteps(m).find((s) => s.id === "validate")!;
    expect(stepTarget(validate, m, { consumption_ddd: "Antibiotic consumption" }).label)
      .toBe("Validate Antibiotic consumption × resistance_pct");
  });
});


describe("the button opens the connection its sentence is about", () => {
  const ranked = (id: string, left: string, stage: string, rank: number) => ({
    id, left_variable: left, right_variable: "resistance", method: "pearson_correlation",
    lifecycle_status: stage, estimate: 0.5, q_value: 0.02, effect_size: 0.5,
    evidence_quality: "moderate", rank_score: rank,
  });

  it("opens the connection still waiting, once the strongest has been validated", () => {
    // The ordinary path: validating a connection does not change its rank.
    const m = { ...map({ sources: 2, datasets: 1, analyses: 6 },
                       { exploratory: 1, validated: 1 }),
                top_connections: [ranked("conn_done", "consumption", "validated", 0.91),
                                  ranked("conn_waiting", "gdp", "exploratory", 0.44)] };
    const validate = stepTarget(loopSteps(m).find((s) => s.id === "validate")!, m);
    expect(validate).toEqual({ section: "connections", item: "conn_waiting",
                               label: "Validate gdp × resistance", kind: "connection" });
  });

  it("records from the strongest validated result, even when an exploratory one outranks it", () => {
    const m = { ...map({ sources: 2, datasets: 1, analyses: 6 },
                       { exploratory: 1, validated: 1 }),
                top_connections: [ranked("conn_new", "gdp", "exploratory", 0.95),
                                  ranked("conn_held", "consumption", "validated", 0.61)] };
    const record = stepTarget(loopSteps(m).find((s) => s.id === "record")!, m);
    expect(record.item).toBe("conn_held");
    expect(record.label).toBe("Record a finding from consumption × resistance");
  });

  it("counts a replicated result as ready to record", () => {
    const m = { ...map({ sources: 2, datasets: 1, analyses: 6 }, { replicated: 1 }),
                top_connections: [ranked("conn_twice", "consumption", "replicated", 0.8)] };
    expect(stepTarget(loopSteps(m).find((s) => s.id === "record")!, m).item).toBe("conn_twice");
  });

  it("says so generically when nothing at that stage is in the ten", () => {
    const m = { ...map({ sources: 2, datasets: 1, analyses: 6 }, { validated: 1 }),
                top_connections: [ranked("conn_done", "consumption", "validated", 0.9)] };
    expect(stepTarget(loopSteps(m).find((s) => s.id === "validate")!, m))
      .toEqual({ section: "connections", item: null, label: "Validate a connection" });
  });
});


describe("the server names the object, on the same rung as its sentence", () => {
  const onRung = (step: string, target: Record<string, unknown>) => ({
    ...map({ sources: 2, datasets: 1, analyses: 6 }, { validated: 1 }),
    recommended_step: step as never, recommended_target: target as never,
  });
  const row = (m: ReturnType<typeof onRung>, id: string) =>
    stepTarget(loopSteps(m).find((s) => s.id === id)!, m);

  it("opens the finding that needs evidence, as a finding", () => {
    const m = onRung("record", { kind: "finding", id: "f_hunch", verb: "evidence", title: "A hunch" });
    expect(row(m, "record")).toEqual({ section: "findings", item: "f_hunch",
      label: "Open “A hunch”, which needs evidence", kind: "finding" });
  });

  it("offers a candidate with its evidence for promotion", () => {
    const m = onRung("record", { kind: "finding", id: "f_1", verb: "promote", title: "a tracks b" });
    expect(row(m, "record").label).toBe("Review “a tracks b” for promotion");
  });

  it("challenges the validated finding the sentence is about", () => {
    const m = onRung("validate", { kind: "finding", id: "f_2", verb: "challenge", title: "a tracks b" });
    expect(row(m, "validate")).toEqual({ section: "findings", item: "f_2",
      label: "Challenge “a tracks b”", kind: "finding" });
  });

  it("labels a connection the server named with the project's approved names", () => {
    const m = onRung("validate", { kind: "connection", id: "c_1", verb: "validate",
      left_variable: "consumption_ddd", right_variable: "resistance_pct" });
    expect(stepTarget(loopSteps(m).find((s) => s.id === "validate")!, m,
                      { consumption_ddd: "Antibiotic consumption" }))
      .toEqual({ section: "connections", item: "c_1", kind: "connection",
                 label: "Validate Antibiotic consumption × resistance_pct" });
  });

  it("does not lend the recommended row's object to another row", () => {
    const m = onRung("record", { kind: "finding", id: "f_hunch", verb: "evidence", title: "A hunch" });
    expect(row(m, "validate")).toEqual({ section: "connections", item: null,
                                         label: "Validate a connection" });
  });
});
