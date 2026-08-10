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
 */

import { useCallback, useEffect, useRef, useState } from "react";
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
  const wrapRef = useRef<HTMLDivElement>(null);

  const current = projects.find((p) => p.id === currentId) ?? null;

  // Close on outside click and on Escape — a menu that survives either reads
  // as broken rather than as persistent.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

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
    <div className="pm" ref={wrapRef}>
      <button
        className="pm-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={current ? `${current.name} — switch project` : "Choose a project"}
      >
        <span className="pm-dot" aria-hidden />
        <span className="pm-name">{current?.name ?? "No project"}</span>
        <IconChevronDown size={14} className="pm-caret" />
      </button>

      {open && (
        <div className="pm-pop" role="menu">
          <div className="pm-list">
            {projects.length === 0 ? (
              <p className="pm-empty">No projects yet.</p>
            ) : (
              projects.map((project) => (
                <div key={project.id} className="pm-row"
                     data-current={project.id === currentId}>
                  <button
                    className="pm-pick"
                    role="menuitem"
                    onClick={() => { onSelect(project.id); setOpen(false); }}
                  >
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
                  </button>
                  <button
                    className="pm-del"
                    onClick={() => void askDelete(project)}
                    aria-label={`Delete ${project.name}`}
                    title={`Delete ${project.name}`}
                  >
                    <IconTrash size={14} />
                  </button>
                </div>
              ))
            )}
          </div>

          <button className="pm-new" onClick={() => { setOpen(false); onCreate(); }}>
            <IconPlus size={15} />
            <span>New project</span>
          </button>
        </div>
      )}

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
    </div>
  );
}
