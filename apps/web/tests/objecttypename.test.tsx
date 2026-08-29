/**
 * What a research object is called on screen.
 *
 * The workboard printed `object_type` straight from the API, so a CSV the
 * researcher had uploaded appeared on their board labelled **citation**.
 *
 * That is not bad data. The domain creates one object per raw source file and
 * types it `ObjectType.CITATION`, and `corpus._source_object` is the only place
 * that type is ever created — so every "citation" in this system is a file
 * somebody added, never a reference in a bibliography. Internal shorthand
 * reached a screen, and told a researcher something false about their own
 * data.
 */

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { objectTypeName } from "@/lib/api";
import { ProvenanceChain } from "@/components/views";
import { api } from "@/lib/api";
import { vi } from "vitest";
import { screen } from "@testing-library/react";

describe("naming a research object", () => {
  it("does not call an uploaded file a citation", () => {
    expect(objectTypeName("citation")).toBe("source file");
  });

  it("leaves the words that were already right alone", () => {
    expect(objectTypeName("paper")).toBe("paper");
    expect(objectTypeName("dataset")).toBe("dataset");
    expect(objectTypeName("analysis")).toBe("analysis");
    expect(objectTypeName("finding")).toBe("finding");
  });

  it("says figure rather than visualization", () => {
    expect(objectTypeName("visualization")).toBe("figure");
  });

  it("reads an underscored type as words", () => {
    expect(objectTypeName("dataset_variable")).toBe("variable");
    expect(objectTypeName("time_period")).toBe("period");
  });

  it("shows a type it has no word for as itself, not as something else", () => {
    // A type added later must read as itself. Mapping the unknown onto a
    // neighbour is how "citation" happened in the first place.
    expect(objectTypeName("intervention")).toBe("intervention");
    expect(objectTypeName("some_new_thing")).toBe("some new thing");
  });
});

describe("the provenance chain", () => {
  it("names the artifact's type in the same words", async () => {
    vi.spyOn(api, "get").mockResolvedValue({
      artifact: { id: "obj_1", object_type: "citation",
                  title: "amr_surveillance.csv",
                  created_at: "2026-01-01T00:00:00Z" },
      direct_inputs: [], ancestors: [], origin: "uploaded",
    } as never);
    render(<ProvenanceChain objectId="obj_1" />);

    expect(await screen.findByText(/source file · amr_surveillance.csv/))
      .toBeTruthy();
  });
});
