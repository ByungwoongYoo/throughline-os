"""
Structured logging and health, for a system that must be auditable while running.

Two decisions here are about research integrity rather than operations.

**Logs are structured and redacted by default.** A research workspace's logs
would otherwise become an uncontrolled second copy of the data: a query string
containing a patient identifier, a prompt containing an unpublished result. The
formatter emits JSON with a fixed field set and never interpolates arbitrary
payloads, so what leaves the process is what someone chose to log.

**Health is reported per dependency, with degradation named.** "Healthy" is not
a boolean here. A workspace with no model can still do every deterministic
thing; one with no database can do nothing. Collapsing those into one green tick
means an operator restarts the wrong process.
"""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Any

#: Never logged, at any level. Not a denylist of what to scrub from a message —
#: these keys are dropped from structured fields outright, because a log line is
#: the one place a secret leaks without anyone reading it.
_REDACT = {"password", "password_hash", "password_salt", "token", "secret",
           "authorization", "cookie", "session", "api_key", "content"}


class StructuredFormatter(logging.Formatter):
    """One JSON object per line, with a fixed shape."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(record.created)),
            "level": record.levelname.lower(),
            "logger": record.name,
            "message": record.getMessage(),
        }
        for key, value in getattr(record, "context", {}).items():
            if key.lower() in _REDACT:
                continue
            payload[key] = value
        if record.exc_info:
            payload["error"] = self.formatException(record.exc_info)[-2000:]
        return json.dumps(payload, default=str)


#: Libraries that log their own internals at INFO. Left at INFO they bury this
#: system's own lines under postmaster status dumps — and an operator who cannot
#: find the line they need has no observability, however structured the output.
_NOISY = ("pgserver", "urllib3", "httpx", "httpcore", "neo4j",
          "multipart", "asyncio", "watchfiles")


#: Libraries that log their own internals at INFO. Left at INFO they bury this
#: system's own lines under postmaster status dumps — and an operator who cannot
#: find the line they need has no observability, however structured the output.
_NOISY = ("pgserver", "urllib3", "httpx", "httpcore", "neo4j",
          "multipart", "asyncio", "watchfiles")


def configure(level: str | None = None) -> None:
    """Install the formatter once, at startup."""
    handler = logging.StreamHandler()
    handler.setFormatter(StructuredFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel((level or os.environ.get("THROUGHLINE_LOG_LEVEL", "info")).upper())
    for name in _NOISY:
        logging.getLogger(name).setLevel(logging.WARNING)
    for name in _NOISY:
        logging.getLogger(name).setLevel(logging.WARNING)


def log(logger: logging.Logger, level: int, message: str, **context: Any) -> None:
    """Log with structured context, redacted."""
    logger.log(level, message, extra={"context": context})


def health() -> dict[str, Any]:
    """
    What this installation can do right now, dependency by dependency.

    Deliberately not a boolean. A workspace with no model can still ingest,
    analyse, correct, adjudicate and export — everything deterministic. One with
    no database can do nothing at all. An operator who sees a single red tick
    restarts the wrong process.
    """
    checks: dict[str, Any] = {}

    try:
        from .db import connection

        started = time.monotonic()
        with connection() as conn, conn.cursor() as cur:
            cur.execute("SELECT 1")
        checks["database"] = {
            "ok": True, "critical": True,
            "latency_ms": round((time.monotonic() - started) * 1000, 1)}
    except Exception as exc:  # noqa: BLE001
        checks["database"] = {"ok": False, "critical": True, "error": str(exc)[:200],
                              "impact": "Nothing works without the record."}

    try:
        import throughline_model

        capability = throughline_model.capability()
        checks["model"] = {
            "ok": capability.text, "critical": False, "model": capability.model,
            "impact": None if capability.text else
            "Claim location and plain summaries are unavailable. Every "
            "deterministic verdict, correction and export still works."}
    except Exception as exc:  # noqa: BLE001
        checks["model"] = {"ok": False, "critical": False, "error": str(exc)[:200]}

    try:
        from . import graph_projection

        projection = graph_projection.capability()
        checks["graph_projection"] = {
            "ok": projection["reachable"], "critical": False,
            "configured": projection["configured"],
            "impact": None if projection["reachable"] else
            "Path-finding, centrality and clustering are unavailable. "
            "Provenance and evidence graphs are unaffected."}
    except Exception as exc:  # noqa: BLE001
        checks["graph_projection"] = {"ok": False, "critical": False,
                                      "error": str(exc)[:200]}

    critical_ok = all(c["ok"] for c in checks.values() if c.get("critical"))
    degraded = [name for name, c in checks.items() if not c["ok"]]

    return {
        "status": "ok" if critical_ok and not degraded
                  else "degraded" if critical_ok else "unhealthy",
        "checks": checks,
        "degraded": degraded,
        # Named, so an operator knows whether to page someone.
        "summary": ("Everything is available." if critical_ok and not degraded
                    else "Running with reduced capability: "
                         + ", ".join(degraded) if critical_ok
                    else "The record is unreachable; nothing can run."),
    }


__all__ = ["StructuredFormatter", "configure", "health", "log"]
