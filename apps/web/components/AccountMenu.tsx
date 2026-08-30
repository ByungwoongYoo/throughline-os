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

import * as Menu from "@radix-ui/react-dropdown-menu";
import { useState } from "react";
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

  // Outside click, Escape, focus into the popup and focus back to the trigger
  // are Radix's. The hand-rolled version did the first two and neither of the
  // last two — and it sits beside the project switcher in the same topbar, so
  // two triggers that look identical were behaving differently.

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
    <Menu.Root open={open} onOpenChange={setOpen}>
      <div className="am">
        <Menu.Trigger asChild>
          <button
            className="am-trigger"
            aria-label={`Account: ${user.display_name || user.email}`}
            title={user.display_name || user.email}
          >
            <span className="am-avatar" aria-hidden>{initials(user)}</span>
          </button>
        </Menu.Trigger>

        <Menu.Portal>
          <Menu.Content className="am-pop" align="end" sideOffset={8}
                        collisionPadding={8}>
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

          {/*
            The one command in here. Everything above it is identity, not
            choices — which is why they are plain content rather than items:
            Radix moves focus between `Item`s only, and a paragraph a keyboard
            could land on but not act upon is a dead stop in the sequence.
          */}
          <Menu.Item className="am-out" disabled={busy}
                     onSelect={() => void signOut()}>
            <IconLogout size={15} />
            <span>{busy ? "Signing out…" : "Sign out"}</span>
          </Menu.Item>
          </Menu.Content>
        </Menu.Portal>
      </div>
    </Menu.Root>
  );
}
