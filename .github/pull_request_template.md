<!--
CI does not run by itself.

There is no push trigger and no pull-request trigger on this repository — the
only way the suite runs on GitHub's machines is if somebody dispatches it. The
checklist below is the whole reason this template exists.
-->

## What this changes


## Evidence

<!-- Name what you ran, not that you ran something. A test file and its count,
     a command, a measured number. "Tested" is not evidence. -->


## Before merging

- [ ] **Dispatched CI on this branch** and it passed:
      `gh workflow run ci.yml --ref <this-branch>`
      <!-- Without this the branch has been tested on exactly one machine,
           whatever the local run says. macOS, Windows, the web build and the
           Docker build have not seen it. -->
- [ ] `TASKS.md` updated — the row for this work says `done`, with evidence
- [ ] Caveats stated in the description rather than left to be discovered

## Caveats

<!-- What is NOT covered, what is untested, what you decided not to do and why.
     A PR that claims to be complete and is not costs more than one that says
     where it stops. -->

