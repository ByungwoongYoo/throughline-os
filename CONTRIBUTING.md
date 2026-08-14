# Working on this together

Three people are building this repository. Everything below exists because of a
specific thing that already went wrong, not because it is standard practice.

## The loop

```bash
./scripts/sync.sh                  # before you start. every time.
git checkout -b feat/<what-you-are-doing>
# … build …
./scripts/preflight.sh --full      # before you push
git push -u origin feat/<what-you-are-doing>
```

Then open a pull request. `main` is what CI protects and what the container is
built from; nothing should reach it without passing through that.

## Why `sync` first, every time

**This is the one that has already cost a day.** Two of us independently wrote a
Dockerfile. Two of us independently fixed the same broken package list. Two of us
edited the same route file. Nothing was broken at any point — the work was simply
done twice, and one copy was thrown away.

No test catches that. CI cannot catch it. It is invisible until the merge.

`sync` fetches and prints what every other unmerged branch has touched, and
warns when a file appears on your branch *and* somebody else's — including files
you have only edited locally and not yet committed, because those are the ones
you can still cheaply decide not to work on.

```
  feat/wave-1-definition-of-done  (42 minutes ago by thephenyl02-creator)
      Dockerfile
      apps/api/src/throughline_api/app.py
      …
    ⚠ You are both editing:
      Dockerfile
```

Overlap is not an error. Two people editing `app.py` is normal and git will
merge it. It is a prompt to send one message before spending a day on something
that already exists.

`sync` changes nothing. It fetches, reports, and exits — a command that rebases
your branch as a side effect of asking a question is one you stop running.

## Why `preflight` before pushing

It runs the same checks CI runs, in the same order, so a failure is yours to see
before it is anyone else's to wait on. Not a cheaper subset: a preflight that
passes while CI fails is one you learn to ignore.

- `./scripts/preflight.sh` — compile, the package-list drift guards, the web
  tests. A few seconds.
- `./scripts/preflight.sh --full` — the above plus the whole backend suite.
  About three minutes. **Use this one before pushing.**

## Claim a wave before building it

`ROADMAP.md` is the live plan and the waves are deliberately independent. Say
which one you are taking before you start — a branch named after it is enough,
since `sync` shows branch names to everyone else.

This is the other half of the duplication problem: `sync` catches a collision
once files exist, but a claimed wave prevents two people ever reaching for the
same one.

## Tests

Write the test against the property, not against your implementation.

This is not style advice. On one merge, four tests failed — three of them were
ours, and all three were wrong in the same way: they asserted the *shape* of one
implementation rather than the thing it guaranteed. A better implementation
arrived and they broke while the property they existed to protect still held
perfectly.

The one that survived checked "a fresh clone installs all nine packages." The
ones that broke checked "`bootstrap.sh` contains nine `-e` lines."

## What CI actually runs

The backend suite across Linux and macOS, a Windows job for the analysis
sandbox, the web build, and a Docker job that builds the image and polls
`/api/health` until the API answers inside it.

That last one matters more than it looks: a Dockerfile that is written but never
built is not evidence of anything. Both of the Dockerfiles in this repository's
history were confidently wrong in ways only an actual build revealed.
