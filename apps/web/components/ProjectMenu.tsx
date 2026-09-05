"use client";

/**
 * The project switcher, and the only place a project is created or destroyed.
 *
 * It sits in the topbar rather than on a dashboard because switching projects
 * is something a researcher does constantly and creating one is something they
 * do rarely — burying the frequent action behind a route to serve the rare one
 * is the wrong trade.
 *
 * **Delete does not optimistically remove the row.** The list is refetched from
 * the server after the request succeeds. An optimistic delete that fails leaves
 * the interface claiming something is gone which is still in the database, and
 * for a destructive action that is the one lie the UI must never tell. The
 * request is fast enough that the honest version costs nothing visible.
 *
 * **What will be lost is counted before asking.** The confirmation names the
 * sources, analyses and findings that go with it, because "this cannot be
 * undone" does not tell anyone whether they can afford it.
 *
 * **The menu behaviour is Radix, not hand-rolled, and that is a correctness
 * fix rather than a refactor.** This markup declared `role="menu"` and
 * `role="menuitem"`, which is a promise: a screen reader announces a menu, and
 * the arrow keys are then expected to move through it. Nothing in this file
 * handled an arrow key. Focus never entered the popup when it opened and never
 * returned to the trigger when it closed, so a keyboard user who opened it was
 * left with focus on the trigger and no way in, and a mouse user who picked a
 * project lost focus to the body. The row `<div>` sat inside `role="menu"`
 * carrying no role of its own, which breaks the structure the role requires,
 * and both the delete and "New project" buttons were unlabelled children of a
 * menu they were not members of.
 *
 * That is this codebase's usual defect wearing accessibility clothes: a claim
 * the implementation does not support. §30 and Rule 5 make keyboard parity a
 * law here, and hand-rolled focus management is where it quietly breaks — so
 * the part that is genuinely hard is delegated to a primitive whose whole job
 * is getting it right, and the styling stays ours. Every class name below is
 * unchanged; Radix is unstyled, so it composes with `globals.css` rather than
 * replacing any of it.
 *
 * **The current project is a `menuitemradio`, not a `menuitem`.** The tick was
 * already saying "one of these is selected"; the role now says it too, so the
 * announcement matches the picture.
 */

import * as Menu from "@radix-ui/react-dropdown-menu";
import { useCallback, useState } from "react";
import { api } from "@/lib/api";
import { ConfirmDialog } from "./ConfirmDialog";
import { IconChevronDown, IconCheck, IconPlus, IconTrash } from "./icons";

export type Project = {
  id: string;
  name: string;
  research_question?: string;
  updated_at?: string;
};

type Counts = { sources: number; analyses: number; findings: number };

/**
 * The discovery map keeps findings in their own object, keyed by lifecycle
 * status — `counts` has sources and analyses but no findings at all. Reading
 * `counts.findings` produced "undefined findings and the figures citing them"
 * in a confirmation dialog for an irreversible delete, which is precisely
 * where a number must not be a guess.
 */
type DiscoveryCounts = {
  counts: { sources?: number; analyses?: number; figures?: number };
  findings: Record<string, number>;
};

function summarise(map: DiscoveryCounts): Counts {
  return {
    sources: map.counts?.sources ?? 0,
    analyses: map.counts?.analyses ?? 0,
    findings: Object.values(map.findings ?? {}).reduce((a, b) => a + b, 0),
  };
}

export function ProjectMenu({
  projects, currentId, onSelect, onChanged, onCreate,
}: {
  projects: Project[];
  currentId: string | null;
  onSelect: (id: string) => void;
  /** Refetch the list. Called after a create or a delete lands. */
  onChanged: () => void;
  /** Open the create-project flow. */
  onCreate: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Project | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = projects.find((p) => p.id === currentId) ?? null;

  // Outside click, Escape, arrow keys, typeahead, focus in and focus back out
  // are all Radix's now. The hand-rolled version did the first two and none of
  // the rest, which is why it is gone rather than kept alongside.

  /** What this project holds, so the confirmation can be specific. */
  const askDelete = useCallback(async (project: Project) => {
    setOpen(false);
    setError(null);
    setCounts(null);
    setPendingDelete(project);
    try {
      const map = await api.get<DiscoveryCounts>(
        `/api/projects/${project.id}/discovery-map`);
      setCounts(summarise(map));
    } catch {
      // A failed count must not block the delete: the dialog falls back to
      // saying it could not check rather than to claiming there is nothing.
      setCounts(null);
    }
  }, []);

  async function confirmDelete() {
    if (!pendingDelete) return;
    setBusy(true);
    setError(null);
    try {
      await api.del(`/api/projects/${pendingDelete.id}`);
      setPendingDelete(null);
      // Refetched, never removed locally: the list must reflect the database.
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Menu.Root open={open} onOpenChange={setOpen}>
        <div className="pm">
          <Menu.Trigger asChild>
            <button
              className="pm-trigger"
              title={current ? `${current.name} — switch project` : "Choose a project"}
            >
              <span className="pm-dot" aria-hidden />
              <span className="pm-name">{current?.name ?? "No project"}</span>
              <IconChevronDown size={14} className="pm-caret" />
            </button>
          </Menu.Trigger>

          {/*
            "New project", beside the project name rather than only inside the
            popup (plan §4.16.2).

            The inventory counted this screen at 8 capabilities, 2 visible and
            6 behind_menu — the class the brief forbids outright. Creating a
            project is not a rare administrative errand a researcher goes
            looking for; it is the first thing anybody does, and it was behind a
            control whose whole label said "switch". Somebody who had never
            opened the caret had no way to learn the product could make one.

            It stays in the menu as well. The menu is where the *list* lives,
            and a person who has opened it to look for a project they have not
            got should find the way to make one there too — the same capability
            with two doors is this plan's pattern, not a duplicate.

            `flex: none` because `.crumbs > *` sets `min-width: 0` so a long
            project name can ellipsis; without it this button is what shrinks
            instead, and a button that is the first thing to be squeezed out of
            a narrow topbar is exactly the hiding this change undoes. The
            margin is inline because `.pm` sets no gap and a one-off 6px does
            not earn a class.
          */}
          <button
            className="btn"
            style={{ flex: "none", marginLeft: 6 }}
            onClick={() => onCreate()}
          >
            {/* Decorative: the word beside it is the accessible name. */}
            <IconPlus size={13} />
            <span>New project</span>
          </button>

          {/*
            Portalled, so the popup is not clipped by any `overflow` on the
            topbar and does not have to win a `z-index` argument with the rest of
            the shell. `sideOffset` keeps the 6px gap the old absolute
            positioning had, and `collisionPadding` stops it hanging off the
            bottom of a short window — which the hand-positioned version did.
          */}
          <Menu.Portal>
            <Menu.Content className="pm-pop" align="start" sideOffset={6}
                          collisionPadding={8}>
              <div className="pm-list">
                {projects.length === 0 ? (
                  <p className="pm-empty">No projects yet.</p>
                ) : (
                  <Menu.RadioGroup value={currentId ?? ""} onValueChange={onSelect}>
                    {projects.map((project) => (
                      <div key={project.id} className="pm-row"
                           data-current={project.id === currentId}>
                        <Menu.RadioItem className="pm-pick" value={project.id}>
                          {/*
                            The tick is drawn here rather than in
                            `Menu.ItemIndicator` so the slot keeps its width on
                            every row: an indicator that only renders when
                            checked makes the unselected rows shift left, and the
                            list jitters as the selection moves.
                          */}
                          <span className="pm-tick" aria-hidden>
                            {project.id === currentId && <IconCheck size={14} />}
                          </span>
                          <span className="pm-row-text">
                            <b>{project.name}</b>
                            {project.research_question && (
                              <em>{project.research_question.slice(0, 68)}
                                {project.research_question.length > 68 && "…"}</em>
                            )}
                          </span>
                        </Menu.RadioItem>
                        {/*
                          An `Item` rather than a plain button. Radix moves focus
                          with a roving tabindex and closes on Tab, so anything
                          inside the popup that is not an Item cannot be reached
                          by keyboard at all — which is what this delete control
                          was before, sitting unreachable inside a `role="menu"`.
                        */}
                        <Menu.Item
                          className="pm-del"
                          onSelect={(event) => {
                            // Radix closes on select. The confirmation opens from
                            // `askDelete`, and letting the menu close underneath
                            // it first is what returns focus to the trigger — so
                            // Escape out of the dialog lands somewhere sensible
                            // instead of on the body.
                            event.preventDefault();
                            void askDelete(project);
                          }}
                          aria-label={`Delete ${project.name}`}
                          title={`Delete ${project.name}`}
                        >
                          <IconTrash size={14} />
                        </Menu.Item>
                      </div>
                    ))}
                  </Menu.RadioGroup>
                )}
              </div>

              <Menu.Item className="pm-new" onSelect={() => onCreate()}>
                <IconPlus size={15} />
                <span>New project</span>
              </Menu.Item>
            </Menu.Content>
          </Menu.Portal>
        </div>
      </Menu.Root>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        destructive
        title={`Delete ${pendingDelete?.name ?? "project"}?`}
        body={
          <>
            This removes the project and everything inside it from this machine.
            It is not archived and there is no trash to recover it from.
          </>
        }
        consequences={
          counts
            ? [
                `${counts.sources} source${counts.sources === 1 ? "" : "s"}, `
                + `with their extracted passages`,
                `${counts.analyses} analysis run${counts.analyses === 1 ? "" : "s"}`,
                `${counts.findings} finding${counts.findings === 1 ? "" : "s"} `
                + `and the figures citing them`,
                "Uploaded files, unless another project uses the same bytes",
              ]
            : ["The contents could not be counted just now — everything in the "
               + "project will still be removed."]
        }
        // Typed confirmation: a corpus is not something a stray click should
        // be able to destroy, and there is nowhere to recover it from.
        requireTyped={pendingDelete?.name}
        confirmLabel="Delete permanently"
        busy={busy}
        error={error}
        onConfirm={() => void confirmDelete()}
        onCancel={() => { if (!busy) { setPendingDelete(null); setError(null); } }}
      />
    </>
  );
}
