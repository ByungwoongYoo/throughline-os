"use client";

/**
 * Who is signed in, and how to stop being signed in.
 *
 * **Sign-out does a full document navigation, not a client-side state reset.**
 *
 * That is deliberate and it is the important thing in this file. Clearing state
 * by hand means enumerating every place a previous user's data might be sitting
 * — hook state, component state, in-flight requests that have not resolved,
 * memoised derivations, worker messages — and being right about all of them
 * forever, including in code written after this. Getting that list wrong once
 * shows one researcher another researcher's corpus.
 *
 * A navigation drops the entire JavaScript heap and starts from an empty one.
 * It costs a few hundred milliseconds on an action taken once a session, and in
 * exchange there is no category of bug where stale data survives a user switch.
 * For the same reason it happens even if the logout request fails: the local
 * session should end regardless of whether the server acknowledged it.
 */

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { IconLogout, IconUser } from "./icons";

export type SignedInUser = {
  id: string;
  email: string;
  display_name?: string;
  is_admin?: boolean;
};

/** Initials for the avatar, from whatever the account actually has. */
function initials(user: SignedInUser): string {
  const name = (user.display_name || "").trim();
  if (name) {
    const parts = name.split(/\s+/);
    return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
  }
  return (user.email[0] ?? "?").toUpperCase();
}

export function AccountMenu({ user }: { user: SignedInUser }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

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

  async function signOut() {
    setBusy(true);
    try {
      await api.post("/api/auth/logout");
    } catch {
      // Ignored on purpose. If the server did not answer, the local session
      // still has to end — leaving someone signed in because the network
      // failed is the wrong way to be careful.
    } finally {
      // A hard navigation, so no previous user's data can survive in memory.
      window.location.assign("/workspace");
    }
  }

  return (
    <div className="am" ref={wrapRef}>
      <button
        className="am-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account: ${user.display_name || user.email}`}
        title={user.display_name || user.email}
      >
        <span className="am-avatar" aria-hidden>{initials(user)}</span>
      </button>

      {open && (
        <div className="am-pop" role="menu">
          <div className="am-who">
            <span className="am-avatar am-avatar-lg" aria-hidden>{initials(user)}</span>
            <div>
              <b>{user.display_name || "Researcher"}</b>
              <em>{user.email}</em>
              {user.is_admin && <span className="badge badge-quiet">Administrator</span>}
            </div>
          </div>

          <p className="am-note">
            <IconUser size={13} aria-hidden />
            Everything in this workspace belongs to this account and stays on
            this machine.
          </p>

          <button className="am-out" onClick={() => void signOut()} disabled={busy}
                  role="menuitem">
            <IconLogout size={15} />
            <span>{busy ? "Signing out…" : "Sign out"}</span>
          </button>
        </div>
      )}
    </div>
  );
}
