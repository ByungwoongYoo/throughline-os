/**
 * What the screen says about Blender (§ a capability computed and shown to nobody).
 *
 * `/api/system/capabilities` has always reported whether this machine can render
 * through Blender, and `availability()` composes a "withheld" sentence and an
 * install hint precisely so a researcher can be told. The settings screen typed
 * the response as `{ packs }` and dropped the rest, so it was computed on every
 * request and displayed nowhere.
 *
 * The wording is the substance here, not decoration. Blender is a separate
 * application of several hundred megabytes that cannot run in a browser and
 * cannot be installed from this screen, and every chart in this product draws
 * without it. A row that listed it beside the installable packs would imply a
 * missing dependency, and a researcher would go and fetch a gigabyte to fix a
 * problem they do not have.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

import { FeaturePacks } from "@/components/settings";
import { api } from "@/lib/api";

const CAPABILITIES = (blender: Record<string, unknown>) => ({
  packs: {
    embeddings: {
      installed: false, approximate_size: "400 MB",
      enables: "semantic search", withheld_without_it: "search stays lexical",
    },
  },
  blender,
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function show(blender: Record<string, unknown>) {
  vi.spyOn(api, "get").mockResolvedValue(CAPABILITIES(blender));
  render(<FeaturePacks />);
}

describe("when Blender is not installed", () => {
  const ABSENT = {
    available: false, path: null, version: null,
    withheld: "Figures cannot be rendered through Blender. The 3D geometry "
            + "still exports, and every other figure format is unaffected.",
    install: "Install Blender from blender.org to enable it.",
  };

  it("says so, and says what is withheld", async () => {
    show(ABSENT);
    await waitFor(() => expect(screen.getByText(/Blender rendering/)).toBeTruthy());
    expect(screen.getByText(/not on this machine/)).toBeTruthy();
    expect(screen.getByText(/still exports/)).toBeTruthy();
  });

  it("says the charts do not need it, so nobody fetches a gigabyte for nothing", async () => {
    show(ABSENT);
    await waitFor(() => expect(screen.getByText(/Blender rendering/)).toBeTruthy());
    const row = document.querySelector(".set-blender");
    expect(row?.textContent).toMatch(/draws?\s+in the browser without it/i);
  });

  it("offers no install button, because this program cannot install it", async () => {
    /*
     * The packs above are Python distributions installed on a button press.
     * Blender is a desktop application; a button that appeared to install it
     * and then failed would be worse than the honest sentence.
     */
    show(ABSENT);
    await waitFor(() => expect(screen.getByText(/Blender rendering/)).toBeTruthy());
    const row = document.querySelector(".set-blender");
    expect(row?.querySelector("button")).toBeNull();
  });
});

describe("when Blender is installed", () => {
  const PRESENT = {
    available: true, path: "/Applications/Blender.app/Contents/MacOS/Blender",
    version: "4.2.1",
  };

  it("names the version and where it found it", async () => {
    show(PRESENT);
    await waitFor(() => expect(screen.getByText(/4\.2\.1/)).toBeTruthy());
    expect(screen.getByText(/Blender\.app/)).toBeTruthy();
  });

  it("still says a render is not the reproducible export", async () => {
    // A Blender render varies with version, build, device and seed. It is good
    // evidence of shape and must never pass as the export that reproduces byte
    // for byte.
    show(PRESENT);
    await waitFor(() => expect(screen.getByText(/4\.2\.1/)).toBeTruthy());
    const row = document.querySelector(".set-blender");
    expect(row?.textContent).toMatch(/reproducible byte for byte/i);
  });
});

describe("a response that does not mention Blender at all", () => {
  it("shows the rest of the screen instead of crashing", async () => {
    /*
     * The field is not guaranteed: an older backend simply does not send it.
     * The first version of this row tested `blender !== null`, which is true
     * for `undefined`, so it rendered with no state and threw while reading
     * `.available` — taking the whole settings screen down over an optional
     * capability. Ten existing tests caught it.
     */
    vi.spyOn(api, "get").mockResolvedValue({
      packs: {
        embeddings: {
          installed: false, approximate_size: "400 MB",
          enables: "semantic search", withheld_without_it: "search stays lexical",
        },
      },
    });
    render(<FeaturePacks />);
    await waitFor(() => expect(screen.getByText(/Feature packs/)).toBeTruthy());
    expect(screen.getByText(/embeddings/)).toBeTruthy();
    expect(document.querySelector(".set-blender")).toBeNull();
  });
});
