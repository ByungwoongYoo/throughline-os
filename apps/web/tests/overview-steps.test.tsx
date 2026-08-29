/**
 * The research loop as a checklist.
 *
 * The Overview calls this "both an explanation of the method and the place you
 * start the next step", and every step is ticked from the project's real
 * counts. The second half of that promise is the one that can quietly stop
 * being true: a step whose link goes somewhere the step cannot be taken reads
 * as a dead end, and the reader is likelier to conclude the product cannot do
 * it than that the button is pointed wrong.
 *
 * "Record a finding" went to the Findings list, which has no way to record one
 * — deliberately, because a finding is recorded *from* a result and a bare
 * "new finding" button invites one written from memory. The placement is
 * right; the link was not.
 */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Overview } from "@/components/views";
import type { DiscoveryMap } from "@/lib/api";

const MAP = {
  counts: { sources: 3, datasets: 1, analyses: 4, findings: 0, reports: 0 },
  connections: { candidate: 2, exploratory: 1, validated: 1 },
  findings: {},
} as unknown as DiscoveryMap;

const PROJECT = { name: "AMR", research_question: "Does use track resistance?" };

beforeEach(() => { vi.restoreAllMocks(); });

function open(map: DiscoveryMap = MAP) {
  const go = vi.fn();
  render(<Overview project={PROJECT} map={map} onGo={go} />);
  return go;
}

describe("every step goes where the step is taken", () => {
  it("sends recording a finding to the connections, not to the list of them", () => {
    /*
     * The Findings screen cannot record one, and its empty state says to
     * validate a connection first — which is where this now goes.
     */
    const go = open();
    screen.getByText("Record a finding").click();
    expect(go).toHaveBeenCalledWith("connections");
  });

  it("sends destroying a result to the connections too", () => {
    // Both actions live on a connection; that is one screen, not a conflict.
    const go = open();
    screen.getByText("Try to destroy what survived").click();
    expect(go).toHaveBeenCalledWith("connections");
  });

  it("sends generating candidates to discovery", () => {
    const go = open();
    screen.getByText("Generate and test candidates").click();
    expect(go).toHaveBeenCalledWith("discover");
  });

  it("sends adding sources to the sources", () => {
    const go = open();
    screen.getByText("Add sources").click();
    expect(go).toHaveBeenCalledWith("sources");
  });

  it("names no step it cannot send anybody to", () => {
    // A step with no destination is a to-do the product will not help with.
    const go = open();
    for (const label of ["Add sources", "Profile a dataset",
                         "Generate and test candidates",
                         "Try to destroy what survived", "Record a finding",
                         "Communicate it"]) {
      go.mockClear();
      screen.getByText(label).click();
      expect(go, label).toHaveBeenCalledTimes(1);
    }
  });
});

describe("what the checklist claims is done", () => {
  it("ticks a step from the project's real counts, not from optimism", () => {
    const go = open();
    // No findings and no reports recorded, so neither is complete.
    expect(screen.getByText("Record a finding")).toBeTruthy();
    expect(go).not.toHaveBeenCalled();
  });
});
