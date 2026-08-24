/**
 * What the researcher is currently talking about (§19, §64, §65, §117).
 *
 * §65 states the requirement in one sentence and it decides the whole design:
 * *"Selection should reference underlying records, not merely rendered
 * graphics."*
 *
 * The tempting implementation is a set of marks — the SVG circles the pointer
 * happened to enclose. It works until the chart is redrawn, and then it stops
 * meaning anything: change from scatter to violin, apply a filter, resize the
 * window, and the selection either evaporates or, worse, silently refers to
 * different observations that inherited the same element indices. A researcher
 * who selected two hundred subjects and then switched chart type would be
 * reasoning about a different two hundred without being told.
 *
 * So a selection is a set of **record identities**. Every view that can show
 * those records highlights them, a chart may be rebuilt from scratch without
 * consulting the selection, and §117's requirement — that a selection becomes
 * exact AI context — is satisfied by construction rather than by a translation
 * step that could be wrong.
 *
 * **How it was made travels with it.** A circle drawn by hand, a lasso, a click
 * and a query are all selections, and they do not carry the same weight: a
 * region somebody drew around a cluster is a judgement, while a query result is
 * a definition. §228 requires those to stay distinguishable, and the moment to
 * record the difference is when it happens.
 */

/**
 * One observation, identified by what it is rather than where it was drawn.
 *
 * The dataset is part of the identity because record ids are only unique within
 * one — two datasets in a project will both have a row 1, and a selection that
 * lost track of which would highlight the wrong subjects in a linked view.
 */
export type RecordRef = { datasetId: string; recordId: string };

/** How a selection came to exist. §228: these must stay distinguishable. */
export type SelectionOrigin =
  /** Drawn around, by hand or by lasso. A judgement about a region. */
  | "region"
  /** Pointed at, one at a time. */
  | "pointed"
  /** The result of a filter or query. A definition, not a judgement. */
  | "query"
  /** Everything, as a starting point for narrowing. */
  | "all";

export type Selection = {
  records: RecordRef[];
  origin: SelectionOrigin;
  /** What the researcher called it, if they named it (§160). */
  label?: string;
  /** Which view made it, so a view can avoid re-highlighting its own work. */
  source?: string;
  at: number;
};

export const EMPTY: Selection = { records: [], origin: "all", at: 0 };

/** A stable string for one record, for set membership and comparison. */
export function keyOf(record: RecordRef): string {
  // Length-prefixed, so no pair of ids can produce the same key whatever they
  // contain. A separator alone is only safe while no id contains it: joining
  // on a space makes {"a", "b c"} and {"a b", "c"} the same record, and the
  // failure would be two subjects highlighted as one in every linked view.
  //
  // This line briefly held a literal NUL byte, written by accident. It worked
  // — nothing can contain a NUL — and it made the collision test pass for a
  // reason nobody had chosen, while making the file read as binary to grep.
  return `${record.datasetId.length}:${record.datasetId}:${record.recordId}`;
}

/**
 * The same records, without duplicates, in the order first seen.
 *
 * Order is kept because a researcher who selected three points expects them
 * listed in the order they picked them, and a Set alone would not promise that
 * across engines.
 */
export function unique(records: readonly RecordRef[]): RecordRef[] {
  const seen = new Set<string>();
  const out: RecordRef[] = [];
  for (const record of records) {
    const key = keyOf(record);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(record);
  }
  return out;
}

/** Whether a record is in a selection. The question every view asks per mark. */
export function contains(selection: Selection, record: RecordRef): boolean {
  const key = keyOf(record);
  return selection.records.some((r) => keyOf(r) === key);
}

/**
 * What a selection says about itself, for a researcher rather than a log.
 *
 * §160's example is exactly this: a drawn region reports "243 observations"
 * because the number is the thing that tells somebody whether they caught what
 * they meant. A selection that only highlighted would leave them counting.
 */
export function describe(selection: Selection): string {
  const count = selection.records.length;
  if (count === 0) return "Nothing selected";

  const noun = count === 1 ? "observation" : "observations";
  const named = selection.label ? `${selection.label}: ` : "";
  switch (selection.origin) {
    case "region":
      return `${named}${count} ${noun} inside the region you drew`;
    case "pointed":
      return `${named}${count} ${noun} you picked`;
    case "query":
      return `${named}${count} ${noun} matching the filter`;
    case "all":
      return `${named}${count} ${noun}`;
  }
}

type Listener = (selection: Selection) => void;

/**
 * The one place a selection lives (§65).
 *
 * Central rather than per-view, which is the whole of cross-filtering: a
 * scatter, a histogram, a table and a map showing the same records highlight
 * together because they are reading the same list, not because each was told
 * separately. Views that each held their own copy would drift the first time
 * one of them was slow to update.
 */
export class SelectionManager {
  private selection: Selection = EMPTY;
  private listeners = new Set<Listener>();

  current(): Selection { return this.selection; }

  /** Replace the selection. The ordinary case: a new region, a new query. */
  set(records: readonly RecordRef[], options: {
    origin: SelectionOrigin; source?: string; label?: string; at?: number;
  }): Selection {
    this.selection = {
      records: unique(records),
      origin: options.origin,
      source: options.source,
      label: options.label,
      at: options.at ?? Date.now(),
    };
    this.announce();
    return this.selection;
  }

  /**
   * Add to the selection rather than replacing it.
   *
   * The origin becomes the *new* one, deliberately. Adding a hand-drawn region
   * to a query result produces something that is no longer a definition, and
   * calling the mixture a query would overstate it — §228's line between a
   * judgement and a definition is exactly what this preserves.
   */
  add(records: readonly RecordRef[], options: {
    origin: SelectionOrigin; source?: string;
  }): Selection {
    return this.set([...this.selection.records, ...records], {
      ...options,
      // A name describes what was named. Extending the set makes it something
      // else, so the label does not carry over.
      label: undefined,
    });
  }

  /** Remove records from the selection, keeping everything else. */
  remove(records: readonly RecordRef[]): Selection {
    const dropped = new Set(records.map(keyOf));
    return this.set(
      this.selection.records.filter((r) => !dropped.has(keyOf(r))),
      { origin: this.selection.origin, source: this.selection.source,
        label: this.selection.label });
  }

  /**
   * Give the selection a name (§160).
   *
   * "Call these suspected responders." The records do not change — naming is
   * how a selection stops being a gesture and becomes something a researcher
   * can refer to in a sentence, and the AI can resolve.
   */
  name(label: string): Selection {
    this.selection = { ...this.selection, label: label.trim() || undefined };
    this.announce();
    return this.selection;
  }

  clear(): Selection {
    return this.set([], { origin: "all" });
  }

  /**
   * Be told when the selection changes.
   *
   * Returns the unsubscribe, because a view that forgot to detach would keep a
   * dead component alive and re-render it — and on a board where views come and
   * go as sections change, that is a leak per navigation.
   */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private announce(): void {
    /*
     * A copy, so a view that subscribes while being notified is not called in
     * the same round.
     *
     * The first comment here said this protected against a listener
     * *unsubscribing* mid-notification, and that was wrong — a JavaScript Set
     * iterator already handles deletion, and a mutation removing the copy
     * survived every test. What it does not handle is addition: an entry added
     * during iteration *is* visited, so a listener that subscribes another
     * would see it fire immediately, and one that subscribed itself would
     * recurse until the stack ran out.
     */
    for (const listener of [...this.listeners]) listener(this.selection);
  }
}
