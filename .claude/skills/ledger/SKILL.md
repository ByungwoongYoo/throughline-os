---
name: ledger
description: Read and update TASKS.md, the shared task ledger for this repository. Use at the START of any work session to see what is claimed, done and remaining; when picking up a task; when finishing one; when discovering a defect while doing something else; and when verifying somebody else's work. Also use when the user asks what is left, what is in progress, who is doing what, or asks to record, claim, close, or verify a task.
---

# The shared ledger

`TASKS.md` at the repository root is the single record of what is being worked
on. Several people — and several Claude sessions — share this repository and
cannot see each other's terminals. This file is the only thing they share.

Two rules carry most of the value:

1. **A claim that has not been pushed does not exist.** Another session will
   start the same task.
2. **`done` is not `verified`.** The author says `done`. Somebody else says
   `verified`, and says how they checked.

## At the start of a session

Do this before proposing a plan, not after.

```bash
git fetch --all --prune && git pull --rebase
```

Then read `TASKS.md` and tell the user, in two or three lines:

- what is `claimed` and by whom (do not start these)
- what is `open` and ready
- anything `done` but not `verified` (these are the cheapest useful work: the
  code exists, it just has not been independently checked)

Read `ROADMAP.md` too when the user is choosing what to do next — the ledger
says what is in flight, the roadmap says what the project is for. Do not
duplicate the roadmap's reasoning into the ledger.

## Claiming a task

1. `git pull --rebase` — someone may have claimed it in the last minute.
2. Re-read the row. If it is no longer `open`, stop and tell the user.
3. Set `Status` to `claimed`, fill in `Owner` and `Branch`.
4. Commit and **push immediately**, before writing any code:

```bash
git commit -m "Claim T00N: <short task name>" TASKS.md && git push
```

5. If the push is rejected, `git pull --rebase` and check whether the row
   changed under you. If somebody else claimed it, take a different task —
   do not race them.

Claiming before working is the whole point. A claim pushed after two hours of
work has protected nobody.

## Finishing a task

Set `Status` to `done` and fill in `Evidence` with something another person can
run: a test file and its count, a command, a measured number. Not "implemented"
and not "works".

Good: `tests/test_variable_labels.py — 15 tests; mutation-checked (removing the
plumbing kills 6)`
Bad: `done, tested`

Leave the row in **Active**. Only a verifier moves it.

## Verifying somebody else's task

This is a real task, not a formality, and it is the one that makes the ledger
worth keeping.

1. Check out their branch and actually run the evidence they named.
2. Try to make the claim false — run the thing the task said it fixed, on a
   case they probably did not try.
3. If it holds, move the row to **Verified** with your name and what you ran.
4. If it does not, set the status back to `claimed` with a note saying what
   failed. Do not silently fix it; the author needs to know.

You may not verify your own work. If you wrote it, it stays `done`.

## Recording something you discovered

Anything found while doing something else goes in **Discovered** — a defect, a
wrong assumption, a claim in the docs that is not true. Record it even when
fixing it immediately; the record is what makes the cost visible.

Give it a severity and, in the Evidence column, say how you know. If it is
large enough to be its own piece of work, say so and leave it `open` rather
than absorbing it silently into whatever you were doing. Scope creep hidden
inside another task is how estimates stop meaning anything.

## Editing the file without colliding

Several sessions edit this file. The format is chosen so that git can merge
them, but only if you keep to it.

- **Never renumber an ID.** Commits, branches and notes point at them. IDs are
  allocated once and are never reused, even after a row is deleted.
- **Re-read the file immediately before allocating one.** Two sessions that each
  take "the next free ID" from their own copy will take the *same* one, and git
  merges both rows without complaint because they are different lines. This has
  already happened once: two different findings were both filed as D010 and
  D011, and neither author saw a conflict. So: `git pull --rebase`, then read
  the highest existing ID, then write. If your branch has been open for a while,
  pull again before you push — and if somebody else has taken your number in the
  meantime, **renumber yours**, because theirs is the one already on `main`.
- **Append new rows at the bottom of a section.** Inserting in the middle
  rewrites lines other sessions are editing.
- **Change only the rows you own.** Editing a row somebody else is holding
  produces a conflict at best and silently reverts their status at worst.
- **Keep one task per line.** Line-oriented is what git merges cleanly.
- **Never reformat the tables.** Re-aligning column padding rewrites every
  line in the table and conflicts with every other pending edit. Ugly and
  mergeable beats tidy and conflicted.
- **Never write a control character into a row.** A single NUL byte makes git
  and grep treat the whole file as binary, and `grep` then returns *nothing*
  rather than failing — so every text search of the shared ledger silently comes
  back empty. This has also already happened, in the row describing NUL bytes in
  two source files. If you are quoting a control character, name it.
- Push ledger changes on their own commit where you can. A status change mixed
  into a large code commit is hard to rebase.

If you do hit a conflict in `TASKS.md`, resolve it by keeping **both** sides'
rows. Two people recording work is never the thing to throw away.

## What does not belong here

- Design reasoning and sequencing — that is `ROADMAP.md`.
- Historical narrative of finished work — `ROADMAP.md`, or the commit history.
- Anything you would not want a collaborator to read cold. Write rows so
  somebody who was not in the session can pick the task up.
