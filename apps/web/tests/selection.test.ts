/**
 * What the researcher is currently talking about (§19, §64, §65, §117).
 *
 * §65's requirement is one sentence — "selection should reference underlying
 * records, not merely rendered graphics" — and the first two groups here are
 * about what that buys. A selection of marks stops meaning anything the moment
 * a chart is redrawn, and the dangerous version of that failure is not an empty
 * selection but a full one referring to different observations.
 *
 * The rest is about §228: a region somebody drew and a query result are both
 * selections and they do not carry the same weight, so the difference has to
 * survive being combined, named and passed to an assistant.
 */

import { describe, expect, it, vi } from "vitest";
import {
  EMPTY, RecordRef, SelectionManager, contains, describe as describeSelection,
  keyOf, unique,
} from "@/lib/selection";

const r = (id: string, dataset = "ds1"): RecordRef =>
  ({ datasetId: dataset, recordId: id });

describe("a selection is records, not marks", () => {
  it("identifies a record by its dataset as well as its id", () => {
    /*
     * Record ids are only unique within a dataset — two datasets in one project
     * will both have a row 1. A selection that lost track of which would
     * highlight the wrong subjects in every linked view.
     */
    expect(keyOf(r("1", "ds1"))).not.toBe(keyOf(r("1", "ds2")));
  });

  it("survives the same records arriving twice", () => {
    // Two views can report the same observation — a point in a scatter and a
    // row in a table are one subject, and a selection of "243" that counted
    // some of them twice would be a wrong number in front of a researcher.
    expect(unique([r("1"), r("2"), r("1")])).toEqual([r("1"), r("2")]);
  });

  it("keeps the order they were picked in", () => {
    // Somebody who selected three points expects them listed in the order they
    // chose them; a Set alone promises nothing across engines.
    expect(unique([r("3"), r("1"), r("2")]).map((x) => x.recordId))
      .toEqual(["3", "1", "2"]);
  });

  it("does not collide ids that contain the separator itself", () => {
    /*
     * The key is length-prefixed rather than merely joined, so no pair of ids
     * can produce the same string whatever they contain.
     *
     * An earlier version of this test used ids containing a space while the
     * key was joined on a colon — so it attacked a separator the code did not
     * use, and a mutation dropping the length prefix survived it. These use the
     * real separator.
     */
    expect(keyOf({ datasetId: "a", recordId: "b:c" }))
      .not.toBe(keyOf({ datasetId: "a:b", recordId: "c" }));
    expect(keyOf({ datasetId: "", recordId: "a:b" }))
      .not.toBe(keyOf({ datasetId: "a", recordId: "b" }));
  });
});

describe("one selection, shared by every view", () => {
  it("starts empty", () => {
    expect(new SelectionManager().current()).toEqual(EMPTY);
  });

  it("tells every view when it changes", () => {
    /*
     * The whole of cross-filtering (§65). A scatter, a histogram and a table
     * highlight together because they read the same list — views holding their
     * own copies drift the first time one is slow.
     */
    const manager = new SelectionManager();
    const scatter = vi.fn();
    const table = vi.fn();
    manager.subscribe(scatter);
    manager.subscribe(table);

    manager.set([r("1"), r("2")], { origin: "region" });
    expect(scatter).toHaveBeenCalledTimes(1);
    expect(table).toHaveBeenCalledTimes(1);
    expect(scatter.mock.calls[0][0].records).toHaveLength(2);
  });

  it("stops telling a view that has gone away", () => {
    // A view that forgot to detach keeps a dead component alive and re-renders
    // it — on a workspace where sections come and go, a leak per navigation.
    const manager = new SelectionManager();
    const gone = vi.fn();
    const off = manager.subscribe(gone);
    off();
    manager.set([r("1")], { origin: "pointed" });
    expect(gone).not.toHaveBeenCalled();
  });

  it("does not call a view that subscribed during the same notification", () => {
    /*
     * The hazard the listener copy actually guards, which the first version of
     * this test got wrong. A JavaScript Set iterator handles *deletion* during
     * iteration by itself, so a mutation removing the copy survived — but an
     * entry *added* during iteration is visited, so a listener that subscribes
     * another would see it fire in the same round, and one that subscribed
     * itself would recurse until the stack ran out.
     */
    const manager = new SelectionManager();
    const late = vi.fn();
    manager.subscribe(() => manager.subscribe(late));
    manager.set([r("1")], { origin: "pointed" });
    expect(late).not.toHaveBeenCalled();

    // And it is heard on the next change, so it was subscribed rather than lost.
    manager.set([r("2")], { origin: "pointed" });
    expect(late).toHaveBeenCalledTimes(1);
  });

  it("answers whether a record is in it", () => {
    const manager = new SelectionManager();
    manager.set([r("1"), r("2")], { origin: "region" });
    expect(contains(manager.current(), r("2"))).toBe(true);
    expect(contains(manager.current(), r("9"))).toBe(false);
    // The question a linked view asks per mark, so the dataset must count.
    expect(contains(manager.current(), r("2", "ds2"))).toBe(false);
  });
});

describe("adding, removing and naming", () => {
  it("adds without losing what was already there", () => {
    const manager = new SelectionManager();
    manager.set([r("1")], { origin: "pointed" });
    manager.add([r("2")], { origin: "pointed" });
    expect(manager.current().records).toHaveLength(2);
  });

  it("does not double-count a record added twice", () => {
    const manager = new SelectionManager();
    manager.set([r("1")], { origin: "pointed" });
    manager.add([r("1")], { origin: "pointed" });
    expect(manager.current().records).toHaveLength(1);
  });

  it("stops calling a mixture a query", () => {
    /*
     * §228's line. A query result is a definition; a region somebody drew is a
     * judgement. Adding the second to the first produces something that is no
     * longer a definition, and keeping the old origin would overstate it.
     */
    const manager = new SelectionManager();
    manager.set([r("1")], { origin: "query" });
    manager.add([r("2")], { origin: "region" });
    expect(manager.current().origin).toBe("region");
  });

  it("drops a name when the set it named changes", () => {
    // "Suspected responders" described those records. Adding more makes it
    // something else, and carrying the label would misname it.
    const manager = new SelectionManager();
    manager.set([r("1")], { origin: "region" });
    manager.name("Suspected responders");
    manager.add([r("2")], { origin: "region" });
    expect(manager.current().label).toBeUndefined();
  });

  it("keeps the records when it is named (§160)", () => {
    // "Call these suspected responders." Naming is how a selection stops being
    // a gesture and becomes something referable in a sentence.
    const manager = new SelectionManager();
    manager.set([r("1"), r("2")], { origin: "region" });
    const named = manager.name("Suspected responders");
    expect(named.label).toBe("Suspected responders");
    expect(named.records).toHaveLength(2);
  });

  it("removes only what was asked for", () => {
    const manager = new SelectionManager();
    manager.set([r("1"), r("2"), r("3")], { origin: "region" });
    manager.remove([r("2")]);
    expect(manager.current().records.map((x) => x.recordId)).toEqual(["1", "3"]);
  });

  it("clears to nothing", () => {
    const manager = new SelectionManager();
    manager.set([r("1")], { origin: "region" });
    expect(manager.clear().records).toEqual([]);
  });
});

describe("what a selection says about itself", () => {
  it("counts, because the number is what tells somebody they caught it", () => {
    // §160's own example. A selection that only highlighted would leave a
    // researcher counting marks to find out whether they got the cluster.
    const manager = new SelectionManager();
    manager.set([r("1"), r("2")], { origin: "region" });
    expect(describeSelection(manager.current()))
      .toBe("2 observations inside the region you drew");
  });

  it("says how it was made, not just how many", () => {
    const manager = new SelectionManager();
    manager.set([r("1")], { origin: "query" });
    expect(describeSelection(manager.current()))
      .toBe("1 observation matching the filter");
  });

  it("uses the name once there is one", () => {
    const manager = new SelectionManager();
    manager.set([r("1"), r("2")], { origin: "region" });
    manager.name("Nonresponders");
    expect(describeSelection(manager.current())).toContain("Nonresponders:");
  });

  it("says plainly when nothing is selected", () => {
    expect(describeSelection(EMPTY)).toBe("Nothing selected");
  });

  it("counts one observation as one, not 1 observations", () => {
    const manager = new SelectionManager();
    manager.set([r("1")], { origin: "pointed" });
    expect(describeSelection(manager.current())).toBe("1 observation you picked");
  });
});
