/**
 * Find data can put a dataset into the project (D202, plan §4.14.1).
 *
 * The rail entry directly beside this one imports a paper in a click. This
 * screen's only onward control was a link out to the repository, so a
 * researcher who found exactly the data they needed left the product to fetch
 * it — and the numbers came back, if they came back, as a file somebody
 * uploaded by hand with none of the record of where it came from.
 *
 * The refusal half was already designed: an unusable record is shown dimmed
 * with its blocker named, because filtering it would make the search look
 * thinner while hiding the reason. So these tests are mostly about not
 * damaging that — the offer appears only where the record is usable, and a
 * refusal from the server arrives as its own sentence on the row it refused
 * rather than as a disabled button (§104).
 *
 * The import route is stubbed here. It is being built to the shared contract
 * — `POST /api/projects/{id}/datasets/import` with `{url, title, repository,
 * licence}`, answering 202 with `{source_id, workflow_run_id,
 * ingestion_status}` — and the request this screen sends is the half of that
 * contract this file owns.
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataSearch } from "@/components/datasearch";
import { ApiError, api } from "@/lib/api";

afterEach(cleanup);
beforeEach(() => { vi.restoreAllMocks(); });

const USABLE = {
  title: "Global AMR surveillance", repository: "Zenodo",
  authors: ["WHO"], year: 2024, doi: "10.5281/zenodo.1",
  description: "Panel of national resistance rates.",
  url: "https://zenodo.org/records/1/files/amr.csv",
  licence: "CC-BY-4.0",
  files: [{ name: "amr.csv", format: "csv", bytes: 2048 }],
  files_listed: true, variables: ["resistance_pct"], rows: 120,
  embargoed: false, curated: true, related_paper_doi: null,
  usability: { usable: true, blockers: [], unknown: [], readable_files: 1 },
};

const UNUSABLE = {
  ...USABLE,
  title: "Supplementary tables (PDF)", doi: "10.5281/zenodo.2",
  url: "https://zenodo.org/records/2",
  files: [{ name: "s1.pdf", format: "pdf", bytes: 900 }],
  usability: {
    usable: false,
    blockers: ["the only files are PDF, which cannot be read as a table"],
    unknown: [], readable_files: 0,
  },
};

function results(records: unknown[]) {
  return {
    query: "antimicrobial resistance",
    results: records,
    sources: { Zenodo: { ok: true, count: records.length, note: null } },
    found: records.length, usable: 1, unchecked: 0,
    note: `${records.length} records.`,
  };
}

/** Search, and hand back the `api.post` spy so the import can be inspected. */
async function search(records: unknown[], props: Record<string, unknown> = {}) {
  vi.spyOn(api, "get").mockResolvedValue({ repositories: [] } as never);
  const post = vi.spyOn(api, "post").mockResolvedValue(results(records) as never);
  render(<DataSearch projectId="prj_1" {...props} />);

  fireEvent.change(screen.getByRole("textbox"),
                   { target: { value: "antimicrobial resistance" } });
  fireEvent.click(screen.getByRole("button", { name: /^search$/i }));
  await screen.findByText(records.length === 1
    ? (records[0] as { title: string }).title : /records\./);
  return post;
}

describe("adding a dataset to the project", () => {
  it("offers the same act as Find papers, beside a usable record", async () => {
    /**
     * Wording and affordance matched to `literature.tsx`'s Add: it is the same
     * act on the rail entry next door, and two words for one act is how a
     * researcher learns that two screens are two products.
     */
    await search([USABLE]);
    expect(screen.getByRole("button", { name: /add to this project/i }))
      .toBeTruthy();
  });

  it("sends what the importer needs and nothing else", async () => {
    /*
     * The contract is four fields: where the file is, what to call it, which
     * repository it came from, and the licence that repository stated. The
     * allowlist, the file type and the size cap are the server's to check —
     * this browser cannot know which hosts the installation searches, and a
     * copy of that list here would drift the first time one changed.
     */
    const post = await search([USABLE]);
    fireEvent.click(screen.getByRole("button", { name: /add to this project/i }));

    await waitFor(() => expect(post).toHaveBeenCalledWith(
      "/api/projects/prj_1/datasets/import", {
        url: USABLE.url,
        title: USABLE.title,
        repository: USABLE.repository,
        licence: "CC-BY-4.0",
      }));
  });

  it("sends a stated-nothing licence as null, not as an empty string", async () => {
    /**
     * "Not stated" is never drawn as "no" on this screen, and it must not be
     * recorded as one either — an empty string in the licence column of a
     * source is a licence somebody will later read as permissive.
     */
    const post = await search([{ ...USABLE, licence: "" }]);
    fireEvent.click(screen.getByRole("button", { name: /add to this project/i }));

    await waitFor(() => expect(post).toHaveBeenCalledWith(
      expect.stringContaining("/datasets/import"),
      expect.objectContaining({ licence: null })));
  });

  it("says where the dataset went", async () => {
    /*
     * "Added" leaves a researcher looking for it. Sources is the answer, and
     * it is the same door an uploaded file comes through — which is what makes
     * this screen part of the loop rather than a search box beside it.
     */
    vi.spyOn(api, "get").mockResolvedValue({ repositories: [] } as never);
    const post = vi.spyOn(api, "post")
      .mockResolvedValueOnce(results([USABLE]) as never)
      .mockResolvedValueOnce({ source_id: "src_9", workflow_run_id: "wf_1",
                               ingestion_status: "uploaded" } as never);
    render(<DataSearch projectId="prj_1" />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "amr" } });
    fireEvent.click(screen.getByRole("button", { name: /^search$/i }));
    fireEvent.click(await screen.findByRole(
      "button", { name: /add to this project/i }));

    expect(await screen.findByText(/In Sources now/)).toBeTruthy();
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("tells the caller which source it made", async () => {
    /**
     * §9's converse: the callback exists so the screen around this one can
     * make "it is in Sources" true — reload the list, or open the new source.
     */
    vi.spyOn(api, "get").mockResolvedValue({ repositories: [] } as never);
    vi.spyOn(api, "post")
      .mockResolvedValueOnce(results([USABLE]) as never)
      .mockResolvedValueOnce({ source_id: "src_9", workflow_run_id: "wf_1",
                               ingestion_status: "uploaded" } as never);
    const onImported = vi.fn();
    render(<DataSearch projectId="prj_1" onImported={onImported} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "amr" } });
    fireEvent.click(screen.getByRole("button", { name: /^search$/i }));
    fireEvent.click(await screen.findByRole(
      "button", { name: /add to this project/i }));

    await waitFor(() => expect(onImported).toHaveBeenCalledWith("src_9"));
  });

  it("does not offer a second import of the same record", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ repositories: [] } as never);
    vi.spyOn(api, "post")
      .mockResolvedValueOnce(results([USABLE]) as never)
      .mockResolvedValueOnce({ source_id: "src_9", workflow_run_id: "wf_1",
                               ingestion_status: "uploaded" } as never);
    render(<DataSearch projectId="prj_1" />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "amr" } });
    fireEvent.click(screen.getByRole("button", { name: /^search$/i }));
    fireEvent.click(await screen.findByRole(
      "button", { name: /add to this project/i }));

    const done = await screen.findByRole("button", { name: /in this project/i });
    expect((done as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("when it cannot be added", () => {
  it("keeps an unusable record visible, dimmed, with the blocker named", async () => {
    /*
     * The rule this screen was written around. Filtering the record would make
     * the search look thinner while hiding the reason a promising title is not
     * usable — and the reason is the thing a researcher acts on.
     */
    await search([UNUSABLE]);
    expect(screen.getByText(/Supplementary tables/)).toBeTruthy();
    expect(screen.getByText(/cannot be read as a table/)).toBeTruthy();
    expect(document.querySelector('[data-usable="false"]')).toBeTruthy();
  });

  it("makes no offer on a record that cannot be used", async () => {
    /** §123 — a control does what it appears to do. An Add beside a record the
     *  importer will refuse is a button that lies about the next second. */
    await search([UNUSABLE]);
    expect(screen.queryByRole("button", { name: /add to this project/i }))
      .toBeNull();
  });

  it("shows the server's refusal as a sentence on the row", async () => {
    /*
     * §104. The server names the reason — a host that is not one of the
     * repositories this installation searches, a file that is not tabular, a
     * file over the cap — and each of those tells the researcher something
     * different to do next. "Could not add" tells them nothing.
     */
    vi.spyOn(api, "get").mockResolvedValue({ repositories: [] } as never);
    vi.spyOn(api, "post")
      .mockResolvedValueOnce(results([USABLE]) as never)
      .mockRejectedValueOnce(new ApiError(
        422, "figshare.com is not one of the repositories this installation "
           + "searches."));
    render(<DataSearch projectId="prj_1" />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "amr" } });
    fireEvent.click(screen.getByRole("button", { name: /^search$/i }));
    fireEvent.click(await screen.findByRole(
      "button", { name: /add to this project/i }));

    expect(await screen.findByText(/is not one of the repositories/))
      .toBeTruthy();
    // And the control is still there to try again, not replaced by the error.
    expect(screen.getByRole("button", { name: /add to this project/i }))
      .toBeTruthy();
  });

  it("offers nothing when there is no project to add to", async () => {
    /**
     * The screen searches repositories whether or not a project is open. A
     * control with nothing to act on is worse than an absent one, and the
     * search itself is unchanged.
     */
    vi.spyOn(api, "get").mockResolvedValue({ repositories: [] } as never);
    vi.spyOn(api, "post").mockResolvedValue(results([USABLE]) as never);
    render(<DataSearch />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "amr" } });
    fireEvent.click(screen.getByRole("button", { name: /^search$/i }));

    expect(await screen.findByText(/Global AMR surveillance/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /add to this project/i }))
      .toBeNull();
  });
});
