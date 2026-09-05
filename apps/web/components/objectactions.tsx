"use client";

/**
 * What can be done with the object on screen, said once, near its heading.
 *
 * **The contract.** An item either performs the action itself, or it scrolls
 * to and focuses the real control already on this page. It never renders a
 * second form, never duplicates a control's state, and never appears for
 * something the page cannot do — a control does what it appears to do (§123),
 * and a band of controls is the easiest place in a product to break that,
 * because a row of verbs reads as a promise before anything is pressed.
 *
 * **Why it exists.** The Overview's loop sends a researcher to a connection to
 * take steps 5 and 6 — record a finding, then communicate it — and neither
 * step could be seen on arrival: "Record this as a finding" was the seventh
 * block on the longest scroll in the product, roughly two screens down, and
 * drafting a report from a connection was reachable only from the Reports
 * screen, which is one rail entry a researcher holding a result has no reason
 * to open. The steps were built, and invisible at the moment they are taken.
 *
 * **An empty slot is an offer or a stated reason, never an absence.** Where a
 * capability could act on this object and has not yet, the item offers it;
 * where it cannot act at all, the item stays and says why in place, as a
 * `note`. Removing the control would leave the researcher to guess whether the
 * product cannot do it, or whether they simply cannot find it — and a missing
 * control teaches the first, which is usually the wrong one.
 */

export type ObjectAction = {
  /** The verb, as it reads on the control. */
  label: string;
  /**
   * `scroll` moves to the real control; `action` performs the act here;
   * `note` is the control that cannot act, with the reason in its place.
   */
  kind: "scroll" | "action" | "note";
  onSelect?: () => void;
  /** Required for `note`: why this cannot act on this object. */
  note?: string;
  /** At most one per band, and only where the object has an obvious next act. */
  primary?: boolean;
  /** In flight. The label carries the progress; this stops a second press. */
  busy?: boolean;
};

export function ObjectActions({ items }: { items: ObjectAction[] }) {
  return (
    <div className="oa" role="group" aria-label="What you can do with this">
      {items.map((item) =>
        item.kind === "note" ? (
          /* Not disabled: a greyed control states nothing, and the reason is
             the whole content of this item. */
          <span className="oa-note" key={item.label}>
            {item.label} — {item.note}
          </span>
        ) : (
          <button
            key={item.label}
            type="button"
            className={"oa-item" + (item.primary ? " oa-item-primary" : "")}
            disabled={item.busy}
            onClick={item.onSelect}
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}
