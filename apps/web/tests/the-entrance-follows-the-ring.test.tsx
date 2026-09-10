/**
 * The entrance's three load-bearing claims.
 *
 * None of these is about how the page looks — a screenshot answers that better
 * than an assertion ever will, and §07 says so. These are the claims the design
 * rests on, each of which would fail silently:
 *
 *   1. Reading order survives the parallax. The chapters are legible one at a
 *      time and in order, and the first one is legible before anybody scrolls.
 *   2. The camera travels ALONG the ring. Azimuth only ever increases, so
 *      scrolling forward never doubles back — that is the whole of "Along the
 *      ring" rather than four viewpoints cut together.
 *   3. The eight marks are ONE set reconfigured, not four charts cross-faded.
 *      Same nodes, kept across every form, so a reader can follow one value.
 *
 * The third is the one worth the most. It is the claim the chapter makes in
 * words — "The marks move" — and swapping the SVG per form would look almost
 * identical while making the sentence false.
 */

import { describe, expect, it } from "vitest";
import { createRef } from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CHAPTERS, chapterOpacity } from "@/app/page";
import { KEYS, keyAt } from "@/lib/entrance/ring";
import { FORMS, Marks, type MarksHandle } from "@/components/entrance/Marks";

/** Every chapter's legibility at one progress value. */
function opacities(p: number) {
  return CHAPTERS.map((c, i) =>
    chapterOpacity(p, c.from, c.to, i === 0, i === CHAPTERS.length - 1),
  );
}

describe("the chapters stay readable one at a time", () => {
  it("shows the entrance before anybody has scrolled", () => {
    // A page whose first screen is blank until you move is broken, and the
    // ramp-in maths is exactly where that happens by accident.
    expect(opacities(0)[0]).toBe(1);
  });

  it("shows each chapter fully at its own settled position", () => {
    CHAPTERS.forEach((chapter, i) => {
      const mid = (chapter.from + chapter.to) / 2;
      expect(opacities(mid)[i], `chapter ${chapter.label} at its own midpoint`).toBe(1);
    });
  });

  it("never lets two headings be legible at once", () => {
    // §03: reveal the incoming heading only once the outgoing one has gone.
    // Two headings at once over one ring is the failure this page is most
    // likely to have and least likely to notice.
    for (let p = 0; p <= 1.0001; p += 0.005) {
      const legible = opacities(p).filter((o) => o > 0.5);
      expect(legible.length, `two headings legible at p=${p.toFixed(3)}`).toBeLessThanOrEqual(1);
    }
  });

  it("leaves the last chapter up at the end of the runway", () => {
    expect(opacities(1)[CHAPTERS.length - 1]).toBe(1);
  });

  it("orders the chapters the way the document does", () => {
    const starts = CHAPTERS.map((c) => c.from);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });
});

describe("the camera travels along the ring", () => {
  it("never doubles back", () => {
    let previous = -Infinity;
    for (let p = 0; p <= 1.0001; p += 0.01) {
      const { az } = keyAt(p);
      expect(az, `azimuth went backwards at p=${p.toFixed(2)}`).toBeGreaterThanOrEqual(previous);
      previous = az;
    }
  });

  it("arrives exactly at the four approved compositions", () => {
    // The ends must be the keyframes themselves, not an interpolation that
    // lands near them: those two frames are what the reference approves.
    expect(keyAt(0)).toEqual(KEYS[0]);
    expect(keyAt(1)).toEqual(KEYS[KEYS.length - 1]);
  });

  it("has one keyframe per chapter", () => {
    expect(KEYS.length).toBe(CHAPTERS.length);
  });

  it("clamps overscroll instead of flying past the last frame", () => {
    expect(keyAt(1.4)).toEqual(keyAt(1));
    expect(keyAt(-0.3)).toEqual(keyAt(0));
  });
});

describe("the marks are one set reconfigured", () => {
  it("keeps the same eight nodes through every form", async () => {
    const user = userEvent.setup();
    const { container } = render(<Marks />);

    const before = [...container.querySelectorAll("g.mark")];
    expect(before).toHaveLength(8);

    for (const form of FORMS) {
      await user.click(screen.getByRole("button", { name: form }));
    }

    const after = [...container.querySelectorAll("g.mark")];
    expect(after).toHaveLength(8);
    // Node identity, not merely count: a re-render that replaced the groups
    // would pass a count check and break the claim the chapter makes.
    after.forEach((node, i) => expect(node).toBe(before[i]));
  });

  it("presses exactly the form the reader chose", async () => {
    const user = userEvent.setup();
    render(<Marks />);

    await user.click(screen.getByRole("button", { name: "Violin" }));

    for (const form of FORMS) {
      expect(
        screen.getByRole("button", { name: form }).getAttribute("aria-pressed"),
        `${form} after choosing Violin`,
      ).toBe(form === "Violin" ? "true" : "false");
    }
  });

  it("follows the scroll when the reader has not taken over", () => {
    const ref = createRef<MarksHandle>();
    render(<Marks ref={ref} />);

    // The controller drives `setStage`; the label must name the nearest
    // settled form, which is what tells a reader what they are looking at.
    // Driven from outside React's event system, exactly as the page's rAF loop
    // drives it, so the update has to be flushed the same way.
    act(() => ref.current!.setStage(3));
    expect(screen.getByRole("button", { name: "Interval" }).getAttribute("aria-pressed")).toBe("true");

    act(() => ref.current!.setStage(2));
    expect(screen.getByRole("button", { name: "Violin" }).getAttribute("aria-pressed")).toBe("true");

    act(() => ref.current!.setStage(0));
    expect(screen.getByRole("button", { name: "Bar" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("says the shapes are not estimates", () => {
    // §05 forbids presenting the morph as statistical output. The violin is not
    // a density and the intervals are not confidence intervals, and the page
    // has to say so where the shapes are, not in a footnote.
    render(<Marks />);
    expect(screen.getByText(/not statistical estimates/i)).toBeTruthy();
  });
});
