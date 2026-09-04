/**
 * The history panel, and the thing it must not imply.
 *
 * A control labelled "revert" invites the belief that the record now reads as
 * though the change never happened. In a research record that belief is
 * false and expensive: what somebody thought at each point is evidence about
 * how they reached a conclusion. So these tests hold down that the screen says
 * restoring adds to the history, and that the versions in between are still
 * there afterwards.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectVersions } from "@/components/objectversions";
import { api } from "@/lib/api";

const CHAIN = {
  current: "obj_2",
  versions: [
    { id: "obj_1", title: "First", description: "a", version: 1,
      status: "superseded", created_by: "usr_1",
      created_at: "2026-03-01T10:00:00Z" },
    { id: "obj_2", title: "Second", description: "b", version: 2,
      status: "active", created_by: "usr_1",
      created_at: "2026-03-02T10:00:00Z" },
  ],
};

describe("going back a version", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("shows nothing for an object that has never been edited", async () => {
    vi.spyOn(api, "get").mockResolvedValue(
      { current: "obj_1", versions: [CHAIN.versions[0]] } as never);

    const { container } = render(
      <ObjectVersions projectId="prj_1" objectId="obj_1" />);

    await waitFor(() => expect(container.textContent).not.toMatch(/Reading the history/));
    expect(container.textContent).toBe("");
  });

  it("lists the chain and marks which one is current", async () => {
    vi.spyOn(api, "get").mockResolvedValue(CHAIN as never);

    render(<ObjectVersions projectId="prj_1" objectId="obj_1" />);

    expect(await screen.findByText("First")).toBeTruthy();
    expect(screen.getByText("Second")).toBeTruthy();
    expect(screen.getByText("current")).toBeTruthy();
  });

  it("says that restoring adds to the history rather than undoing it", async () => {
    vi.spyOn(api, "get").mockResolvedValue(CHAIN as never);

    render(<ObjectVersions projectId="prj_1" objectId="obj_1" />);

    expect(await screen.findByText(/nothing is deleted/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /revert|undo/i })).toBeNull();
  });

  it("offers no way to restore the version that is already current", async () => {
    vi.spyOn(api, "get").mockResolvedValue(CHAIN as never);

    render(<ObjectVersions projectId="prj_1" objectId="obj_1" />);

    const buttons = await screen.findAllByRole("button", { name: /restore this/i });
    expect(buttons).toHaveLength(1);
  });

  it("restores the version that was asked for", async () => {
    vi.spyOn(api, "get").mockResolvedValue(CHAIN as never);
    const post = vi.spyOn(api, "post").mockResolvedValue(
      { object_id: "obj_3" } as never);

    render(<ObjectVersions projectId="prj_1" objectId="obj_1" />);
    fireEvent.click(await screen.findByRole("button", { name: /restore this/i }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][0])
      .toBe("/api/projects/prj_1/objects/obj_1/restore");
    expect(post.mock.calls[0][1]).toEqual({ version_id: "obj_1" });
  });

  it("shows the intervening version still there afterwards", async () => {
    /**
     * The property the wording promises. If restoring hid what came between,
     * the screen would be making the claim the domain refuses to make.
     */
    const after = {
      current: "obj_3",
      versions: [...CHAIN.versions,
                 { id: "obj_3", title: "First", description: "a", version: 3,
                   status: "active", created_by: "usr_1",
                   created_at: "2026-03-03T10:00:00Z" }],
    };
    const get = vi.spyOn(api, "get")
      .mockResolvedValueOnce(CHAIN as never)
      .mockResolvedValue(after as never);
    vi.spyOn(api, "post").mockResolvedValue({ object_id: "obj_3" } as never);

    render(<ObjectVersions projectId="prj_1" objectId="obj_1" />);
    fireEvent.click(await screen.findByRole("button", { name: /restore this/i }));

    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Second")).toBeTruthy();
    expect(await screen.findByText(/edited 2 times/i)).toBeTruthy();
  });
});
