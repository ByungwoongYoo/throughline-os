## Start here: the shared ledger

Several people and several Claude sessions share this repository and cannot see
each other's terminals. `TASKS.md` at the root is the only thing they share.

**Before proposing any plan:**

```bash
git fetch --all --prune && git pull --rebase
```

then read `TASKS.md` and say what is claimed, what is open, and what is `done`
but not yet `verified`. Do not start anything another session has claimed.

`ROADMAP.md` says what the project is trying to become and why. `TASKS.md` says
who is doing what right now. When they disagree, the ledger is current.

The protocol for claiming, closing, verifying and recording discoveries — and
the rules that keep two sessions from clobbering each other's rows — is in
`.claude/skills/ledger/SKILL.md`. Invoke it with `/ledger`, or just follow it.

Two rules carry most of the value: **a claim you have not pushed does not
exist**, and **`done` is not `verified`** — the author says `done`, someone
else says `verified` and names what they ran.

## CI does not run by itself — you have to ask for it

There is **no push trigger and no pull-request trigger** on this repository. A
green tick is not waiting for you, and **an absence of red is not a pass** — it
usually means nothing ran at all. Never report a branch as verified on GitHub
because no check has failed.

Why: the repo is private, so Actions minutes are metered and macOS bills at
**10x**. A full run is ~82 billed minutes, 66 of them macOS. Automatic runs
exhausted the monthly allowance in a week and every job stopped.

**Dispatch a run when — and only when — one of these is true:**

- something is about to be merged to `main`, or published
- the change is platform-shaped: a new dependency, a `Dockerfile` edit, a
  changed path or filename, sandbox code, a committed binary fixture, or
  `ci.yml` itself
- the user asks

```bash
gh workflow run ci.yml --ref <branch>      # ~82 billed minutes; do not fire casually
gh run watch $(gh run list --branch <branch> --limit 1 --json databaseId --jq '.[0].databaseId')
```

**Do not dispatch after every push.** That is the behaviour that caused the
outage. Local `pytest` and `vitest` are the fast loop; a dispatch is the
cross-platform check before something lands.

Say plainly which one a result came from. "898 Python and 223 web pass locally,
not yet dispatched" is honest; "tests pass" is not, because it hides that macOS,
Windows and the Docker build have not seen the change.

Billing is on the repository owner's account (`SarthakPattnaik1`), so a
collaborator cannot see usage or raise the limit.
