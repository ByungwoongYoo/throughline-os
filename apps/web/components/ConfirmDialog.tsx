"use client";

/**
 * A confirmation before something irreversible.
 *
 * Built on `<dialog showModal()>` rather than a hand-rolled overlay, because
 * the native element already gets four things right that hand-rolled modals
 * almost always get wrong: the focus trap, the inert background, the top-layer
 * stacking that no `z-index` can beat, and Escape.
 *
 * Three decisions beyond that, each earned:
 *
 * **The destructive button is not the default focus.** Focus lands on Cancel.
 * A dialog that appears under a finger already moving toward Enter and deletes
 * a research corpus is a trap, and "are you sure" is not a safeguard if the
 * safe answer takes an extra keystroke.
 *
 * **Typing the name is optional and used where the loss is unbounded.** For a
 * project holding sources, analyses and findings, a click is too cheap. The
 * cost of the friction is a few seconds; the cost of not having it is
 * unrecoverable, because none of this is in a trash can afterwards.
 *
 * **The dialog says what will be destroyed, in counts.** "Delete this project?"
 * is not enough information to decide. "12 sources, 4 analyses, 2 findings" is.
 */

import { useEffect, useRef, useState } from "react";
import { IconAlert, IconClose } from "./icons";

export type ConfirmProps = {
  open: boolean;
  title: string;
  /** What will happen, in plain words. Shown above any detail list. */
  body: React.ReactNode;
  /** Concrete things that will be destroyed. Counts beat adjectives. */
  consequences?: string[];
  confirmLabel: string;
  /** When set, the confirm button stays disabled until this is typed exactly. */
  requireTyped?: string;
  /** Destructive styling and the extra caution that goes with it. */
  destructive?: boolean;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  open, title, body, consequences, confirmLabel, requireTyped,
  destructive = false, busy = false, error = null, onConfirm, onCancel,
}: ConfirmProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [typed, setTyped] = useState("");

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setTyped("");
      dialog.showModal();
      // Focus the safe choice, never the destructive one.
      requestAnimationFrame(() => cancelRef.current?.focus());
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // Escape and the backdrop both cancel — but never while the request is in
  // flight, or the caller is left not knowing whether it happened.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const onClose = (event: Event) => {
      event.preventDefault();
      if (!busy) onCancel();
    };
    dialog.addEventListener("cancel", onClose);
    return () => dialog.removeEventListener("cancel", onClose);
  }, [busy, onCancel]);

  const armed = !requireTyped || typed.trim() === requireTyped.trim();

  return (
    <dialog
      ref={ref}
      /*
       * No `dlg-danger`. It was set on this element and no stylesheet ever
       * defined it, so it changed nothing — CSS fails silently, which is the
       * defect `css-classes.test.ts` exists for (D025), and interpolation was
       * the one shape that check could not see.
       *
       * A destructive dialog is still marked, twice and visibly: the alert
       * icon in the header, and `btn-danger` on the confirm button. Both have
       * rules. Adding a rule for this class instead would be inventing a third
       * treatment for a state already carried.
       */
      className="dlg"
      aria-labelledby="dlg-title"
      onClick={(event) => {
        // Only the backdrop, not a click that started inside the panel.
        if (event.target === ref.current && !busy) onCancel();
      }}
    >
      <div className="dlg-panel">
        <header className="dlg-head">
          {destructive && <span className="dlg-icon" aria-hidden><IconAlert size={18} /></span>}
          <h2 id="dlg-title">{title}</h2>
          <button className="dlg-x" onClick={onCancel} disabled={busy}
                  aria-label="Close">
            <IconClose size={16} />
          </button>
        </header>

        <div className="dlg-body">
          <p>{body}</p>

          {consequences && consequences.length > 0 && (
            // Counts, not adjectives: "this cannot be undone" does not tell
            // anyone whether they can afford to lose it.
            <ul className="dlg-consequences">
              {consequences.map((line) => <li key={line}>{line}</li>)}
            </ul>
          )}

          {requireTyped && (
            <label className="dlg-typed">
              <span>
                Type <b>{requireTyped}</b> to confirm
              </span>
              <input
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                disabled={busy}
                autoComplete="off"
                spellCheck={false}
                aria-label={`Type ${requireTyped} to confirm`}
              />
            </label>
          )}

          {error && <p className="dlg-error" role="alert">{error}</p>}
        </div>

        <footer className="dlg-foot">
          <button ref={cancelRef} className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            className={`btn ${destructive ? "btn-danger" : "btn-primary"}`}
            onClick={onConfirm}
            disabled={busy || !armed}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </footer>
      </div>
    </dialog>
  );
}
