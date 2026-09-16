"""
Ask several sources at once, and stop waiting at a deadline (D409).

Both searches promised that one source failing never empties the page, and
both broke it for a source that *hangs* rather than errors. The literature
search used `as_completed(..., timeout=)`, which raises at the deadline and
throws away everything already collected; the dataset search used `pool.map`,
which has no deadline at all. And a `with ThreadPoolExecutor` block waits for
every thread on exit, so even a caught timeout was paid in full.

So the waiting lives here, once: whatever answered by the deadline is kept,
whatever did not is named as late, and the pool is released without joining
the threads still stuck in a socket read. Those threads finish on their own
— every connector call carries its own HTTP timeout — and nothing waits for
them.
"""

from __future__ import annotations

import concurrent.futures
from typing import Callable, TypeVar

T = TypeVar("T")


def fan_out(names: list[str], run: Callable[[str], T], *,
            deadline: float) -> tuple[dict[str, T], list[str]]:
    """Run `run(name)` for every name; return what finished, and who was late."""
    if not names:
        return {}, []
    pool = concurrent.futures.ThreadPoolExecutor(
        max_workers=len(names), thread_name_prefix="throughline-fanout")
    try:
        futures = {pool.submit(run, name): name for name in names}
        done, _ = concurrent.futures.wait(futures, timeout=deadline)
        finished = {futures[future]: future.result() for future in done}
    finally:
        pool.shutdown(wait=False, cancel_futures=True)
    late = [name for name in names if name not in finished]
    return finished, late


def late_note(deadline: float) -> str:
    return (f"Did not answer within {deadline:g} seconds, so this search went "
            "ahead without it. Try again later; the others are unaffected.")


__all__ = ["fan_out", "late_note"]
