/**
 * The view the assistant is told about, and the reset that keeps it true.
 *
 * The dangerous state is not an absent view — it is a *stale* one. A filter
 * left behind by a screen the researcher has left would be described to the
 * model as in force, and the model would qualify a true answer into a false
 * one. So leaving a screen withdraws what that screen reported, and these
 * tests hold that down.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  currentView, enterScreen, forgetView, reportView,
} from "@/lib/view-context";

describe("what the screen reports", () => {
  beforeEach(() => forgetView());

  it("starts with nothing to say", () => {
    expect(currentView()).toEqual({});
  });

  it("names the screen the question was asked from", () => {
    enterScreen("connections");
    expect(currentView().screen).toBe("connections");
  });

  it("carries what the screen says it is showing", () => {
    enterScreen("connections");
    reportView({ showing: 200 });
    expect(currentView()).toEqual({ screen: "connections", showing: 200 });
  });

  it("forgets a previous screen's counts on the way out", () => {
    enterScreen("connections");
    reportView({ showing: 200, filters: [{ field: "q_value", value: "<0.05" }] });

    enterScreen("findings");

    expect(currentView()).toEqual({ screen: "findings" });
  });

  it("forgets them even when the same screen is entered again", () => {
    /**
     * A remount is a screen that has not reported *this time round*. Keeping
     * the old numbers because the name matches is how a count survives the
     * data it counted.
     */
    enterScreen("connections");
    reportView({ showing: 200 });

    enterScreen("connections");

    expect(currentView().showing).toBeUndefined();
  });

  it("hands back a copy, so a caller cannot edit the live view", () => {
    enterScreen("connections");
    const taken = currentView();
    taken.screen = "somewhere else";
    expect(currentView().screen).toBe("connections");
  });

  it("merges later reports from the same screen", () => {
    enterScreen("analyses");
    reportView({ showing: 6 });
    reportView({ total: 40 });
    expect(currentView()).toEqual({ screen: "analyses", showing: 6, total: 40 });
  });
});
