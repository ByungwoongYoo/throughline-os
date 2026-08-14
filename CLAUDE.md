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

## Working preferences — model & effort tiering
<!-- tier-rule v1.6 -->

Quality first. Efficiency comes ONLY from routing genuinely mechanical work to
cheaper tiers — never from downgrading work that needs a strong model.
- **Plan on the session's strongest model.** Every plan annotates each work
  item with BOTH a model tier AND an effort level (low→max).
- **Routing table** (a lookup, never a deliberation — the routing decision
  must never cost more tokens than it can save; small/short task → skip
  routing, do it on the current model):
  · tests / builds / linters / migrations → local, no model
  · mechanical evidence-gathering, search fan-out, doc refresh → Sonnet (low/med)
  · substantive builds, adversarial verifiers, correctness/security reviews,
    research synthesis, final judgment → Opus (high/xhigh), the default top
    tier since Opus 5
- **Fable is an escalation, not a default** (≈2× Opus cost, heavier token use,
  marginal overall lead). Escalate ONLY for: the longest/hardest
  frontier-reasoning work (Fable's lead grows with task length + complexity) ·
  high-stakes deep research where a wrong conclusion is costly · large or
  high-stakes tasks in Fable's benchmarked-lead domains — long-horizon
  software-engineering marathons, legal/compliance-critical analysis, deep
  security analysis · tie-break adjudication after strong models disagree or
  an Opus attempt fails · explicit user request.
- **Fable unavailable in this session** (subscription tier, e.g. Claude Pro)?
  → Opus IS the top tier: run would-be escalations on Opus at max effort;
  never stall on, or demand, an unavailable model.
- **Main-model fit:** DOWNGRADE clearly-mechanical work to a cheaper sub-agent
  directly, no permission needed. UPGRADE only after informing/asking — never
  silently deliver a weaker result.
- **PIN EVERY SUB-AGENT — never let one inherit the session model.** Fan-out
  readers/searchers/gatherers get an explicit cheap tier on every call. An
  unpinned agent silently runs on the session model, so a frontier main model
  turns mechanical work into frontier-priced work without any visible signal.
- **Capacity-error repair rule:** if a pinned tier fails on a rate/usage limit,
  retry THAT agent on another tier. Never respond by removing pins globally —
  and if you ever do, restore them on the very next fan-out. Silent
  un-pinning is the most common way this whole rule decays in a long session.
- **State the routing before spending it.** Any fan-out of 3+ agents announces
  its plan in one line first (count × tier/effort, e.g. "6 × Sonnet/medium"),
  so a mis-route is visible to the user BEFORE the tokens are spent, not after.
- **Keep raw bulk content out of the frontier context.** Web pages, large
  logs, scraped text, long raw files: delegate the fetching/reading to a
  Sonnet/Haiku sub-agent and let only distilled findings return. Justify this
  as ROUTING (it is Sonnet-tier work), not as a safety measure.
- **Model downgrades are UNPREDICTABLE — do not claim to prevent them.**
  A session's model can change mid-task for reasons outside the routing plan
  (usage limits; provider-side fallbacks that fire even on innocuous work
  such as a routine doc edit). The target model varies. Any rule promising to
  avoid them is false comfort; the defense is DETECTION and RESPONSE.
- **Downgrade protocol — the assistant CANNOT restore the model** (/model is
  user-only; the change does not self-revert):
  1. Announce it the moment it is noticed or the user reports it.
  2. PAUSE judgment-heavy work (design, review, synthesis, final calls).
     Mechanical work may continue.
  3. Ask the user to restore with /model.
  4. After restore, RE-VERIFY any quality-critical output produced during
     the downgrade window. A silent tier loss is only harmless if nothing
     important was decided inside it — check, do not assume.
- **HARD RULE (overrides all): never compromise quality.** Any doubt whether a
  downgrade would hurt → do NOT downgrade.
