"""The durable worker loop.

A worker is deliberately dumb: it leases a run, dispatches it to a registered
handler, and records the outcome. All durability lives in the database, so
killing this process at any point loses nothing — the lease lapses and another
worker picks the run up.

A handler that reaches an approval gate stops without failing: the run waits in
`awaiting_approval` until a person releases it, and the steps it finished first
are committed so that approving does not mean paying for them again.
"""

from __future__ import annotations

import logging
import signal
import threading
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


class _KeepAlive:
    """
    Hold a run's lease for as long as its handler is working.

    A claim leases a run for `DEFAULT_LEASE_SECONDS` — sixty — and
    `claim_next` reclaims any running run whose lease has lapsed, on the
    reasonable assumption that its worker died. Nothing renewed the lease, so
    *any* handler that outlived it looked dead mid-flight: with more than one
    worker, a second would claim the same run and do the work again, and the
    first would then finish a run it no longer owned. `workflow.heartbeat`
    existed for exactly this and had no caller.

    Blender made it concrete: the renderer allows 600 seconds, ten leases. It
    renders in seconds on a fast machine, but the timeout is the contract.

    A thread on its own connection, renewing a third of the way into each
    lease, so one late beat never costs the run. It opens a connection only
    when it beats, so the short jobs that are most of the queue never pay for
    it at all.
    """

    def __init__(self, run_id: str, worker_id: str,
                 lease_seconds: int | None = None) -> None:
        self.run_id = run_id
        self.worker_id = worker_id
        self.lease_seconds = lease_seconds or workflow.DEFAULT_LEASE_SECONDS
        self.every = max(self.lease_seconds / 3.0, 0.05)
        self._done = threading.Event()
        self._thread = threading.Thread(
            target=self._beat, name=f"lease-{run_id}", daemon=True)

    def _beat(self) -> None:
        while not self._done.wait(self.every):
            try:
                with connection() as conn, conn.cursor() as cur:
                    held = workflow.heartbeat(
                        cur, run_id=self.run_id, worker_id=self.worker_id,
                        lease_seconds=self.lease_seconds)
                if not held:
                    log.warning("run %s lost its lease while still working",
                                self.run_id)
                    return
            except Exception as exc:  # noqa: BLE001 — a missed beat is not a failed run
                log.warning("could not renew the lease on run %s: %s",
                            self.run_id, exc)

    def start(self) -> "_KeepAlive":
        self._thread.start()
        return self

    def stop(self) -> None:
        self._done.set()
        self._thread.join(timeout=self.every + 5)


class Worker:
    def __init__(self, *, worker_id: str | None = None, poll_seconds: float = 1.0) -> None:
        self.worker_id = worker_id or workflow.WORKER_ID
        self.poll_seconds = poll_seconds
        self._stop = False
        # Negative infinity rather than 0.0: `time.monotonic()` counts from an
        # arbitrary point, often boot, so a zero start would make the first
        # housekeeping run happen at an unpredictable time. This makes it happen
        # on the first idle tick, which is when there is least to interrupt.
        self._last_housekeeping = float("-inf")

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
                self._housekeeping()
                time.sleep(idle_backoff or self.poll_seconds)

    #: How often the idle loop does housekeeping. Long, because none of it is
    #: urgent and a worker that spends its idle time querying is not idle.
    HOUSEKEEPING_SECONDS = 3600.0

    def _housekeeping(self) -> None:
        """
        Work nothing else was ever going to do.

        `auth.purge_expired_sessions` existed and was called by nothing, so every
        sign-in left a row that outlived its own expiry forever. Not a security
        hole — `resolve_session` filters on `expires_at`, so a stale token
        authenticates nobody — but on an installation meant to run for years it
        is a table that only grows, and the cost lands on whoever eventually
        backs it up or restores it.

        Runs on the idle path only, and never fails the worker: this is
        tidying, and a worker that stops processing research because it could
        not delete an old session row has its priorities backwards.
        """
        now = time.monotonic()
        if now - self._last_housekeeping < self.HOUSEKEEPING_SECONDS:
            return
        self._last_housekeeping = now
        try:
            from throughline_domain import auth

            with connection() as conn, conn.cursor() as cur:
                removed = auth.purge_expired_sessions(cur)
            if removed:
                log.info("removed %d expired session(s)", removed)
        except Exception as exc:  # noqa: BLE001 — tidying must not stop work
            log.debug("housekeeping skipped: %s: %s", type(exc).__name__, exc)

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

        keep_alive = _KeepAlive(run_id, self.worker_id).start()
        try:
            with connection() as conn:
                with conn.cursor() as cur:
                    try:
                        output = handler(run, cur) or {}
                    except workflow.AwaitingApproval as gate:
                        # Caught *inside* the transaction on purpose. Letting it
                        # escape would roll the connection back, undoing both
                        # the steps completed before the gate and the record
                        # that the run is waiting — so the run would be retried
                        # from the top and stop at the same gate forever, and
                        # nothing would ever appear on the approval screen.
                        #
                        # Not `finish()` either: waiting is not terminal. The
                        # run is already in `awaiting_approval` and stays there
                        # until a person releases it.
                        log.info("run %s waiting for approval of %s",
                                 run_id, gate.node_name)
                        return
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
        finally:
            keep_alive.stop()


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
