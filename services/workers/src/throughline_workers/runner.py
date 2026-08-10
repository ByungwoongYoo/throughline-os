"""The durable worker loop.

A worker is deliberately dumb: it leases a run, dispatches it to a registered
handler, and records the outcome. All durability lives in the database, so
killing this process at any point loses nothing — the lease lapses and another
worker resumes from the last completed node.
"""

from __future__ import annotations

import logging
import signal
import time
import traceback
from typing import Any, Callable, Protocol

from throughline_domain import workflow
from throughline_domain.db import connection
from throughline_schemas.enums import WorkflowState

log = logging.getLogger("throughline.worker")

#: Backoff between attempts, in seconds. Bounded so a permanently failing job
#: does not wander off into hour-long sleeps on a desktop.
RETRY_BACKOFF = [2, 10, 30, 120]


class Handler(Protocol):
    def __call__(self, run: dict[str, Any], cur: Any) -> dict[str, Any]: ...


class Registry:
    def __init__(self) -> None:
        self._handlers: dict[str, Handler] = {}

    def register(self, workflow_name: str) -> Callable[[Handler], Handler]:
        def decorate(fn: Handler) -> Handler:
            self._handlers[workflow_name] = fn
            return fn

        return decorate

    def get(self, workflow_name: str) -> Handler | None:
        return self._handlers.get(workflow_name)

    @property
    def names(self) -> list[str]:
        return sorted(self._handlers)


REGISTRY = Registry()


class Worker:
    def __init__(self, *, worker_id: str | None = None, poll_seconds: float = 1.0) -> None:
        self.worker_id = worker_id or workflow.WORKER_ID
        self.poll_seconds = poll_seconds
        self._stop = False

    def request_stop(self, *_: Any) -> None:
        """Finish the run in flight, then exit. No work is abandoned mid-node."""
        log.info("worker %s stopping after current run", self.worker_id)
        self._stop = True

    def run_forever(self) -> None:
        signal.signal(signal.SIGINT, self.request_stop)
        signal.signal(signal.SIGTERM, self.request_stop)
        log.info("worker %s handling: %s", self.worker_id, ", ".join(REGISTRY.names) or "nothing")
        idle_backoff = 0.0
        while not self._stop:
            try:
                worked = self.run_once()
                idle_backoff = 0.0
            except Exception as exc:  # noqa: BLE001
                # A worker that exits on the first database hiccup is not durable.
                # Log, back off, and keep going; the queue is the source of truth.
                idle_backoff = min(max(idle_backoff * 2, 1.0), 30.0)
                log.warning("worker loop error (retrying in %.0fs): %s: %s",
                            idle_backoff, type(exc).__name__, exc)
                worked = False
            if not worked:
                time.sleep(idle_backoff or self.poll_seconds)

    def run_once(self) -> bool:
        """Process at most one run. Returns True if work was picked up."""
        with connection() as conn:
            with conn.cursor() as cur:
                run = workflow.claim_next(
                    cur, worker_id=self.worker_id, workflow_names=REGISTRY.names or None
                )
        if not run:
            return False
        self._execute(run)
        return True

    def _execute(self, run: dict[str, Any]) -> None:
        handler = REGISTRY.get(run["workflow_name"])
        run_id = run["id"]
        if handler is None:
            with connection() as conn, conn.cursor() as cur:
                workflow.finish(
                    cur, run_id=run_id, state=WorkflowState.FAILED,
                    error=f"No handler registered for workflow '{run['workflow_name']}'",
                )
            return

        try:
            with connection() as conn:
                with conn.cursor() as cur:
                    output = handler(run, cur) or {}
                    workflow.finish(
                        cur, run_id=run_id, state=WorkflowState.COMPLETED, output=output
                    )
        except Exception as exc:  # noqa: BLE001 — the worker is the boundary
            error = f"{type(exc).__name__}: {exc}"
            log.warning("run %s failed: %s", run_id, error)
            log.debug("%s", traceback.format_exc())
            attempt = int(run["attempts"])
            delay = RETRY_BACKOFF[min(attempt - 1, len(RETRY_BACKOFF) - 1)]
            with connection() as conn, conn.cursor() as cur:
                workflow.reschedule(cur, run_id=run_id, delay_seconds=delay, error=error)


def main() -> None:
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s"
    )
    # The worker may start before the API on a fresh install, so it cannot assume
    # the schema exists. Migration is idempotent and checksummed.
    from throughline_domain.migrate import migrate

    applied = migrate()
    if applied:
        log.info("applied migrations: %s", ", ".join(applied))
    Worker().run_forever()
