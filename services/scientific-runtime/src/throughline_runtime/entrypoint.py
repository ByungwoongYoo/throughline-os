"""Sandbox entrypoint — the *only* thing that executes inside the isolated process.

Run as ``python -m throughline_runtime.entrypoint <job.json>``. It reads a
validated job, loads a read-only input file, runs one whitelisted method, and
writes JSON to stdout. It never opens a socket, never reads an environment
secret, and never touches the application database — it cannot, because the
executor does not give it the means.

Keep this module's imports minimal and side-effect free: everything imported
here runs inside the sandbox.
"""

from __future__ import annotations

import json
import os
import random
import sys
import time
import warnings
from pathlib import Path
from typing import Any


def _block_network() -> list[str]:
    """Disable outbound sockets inside this process.

    Defence in depth, not the boundary itself: a determined process could
    re-import the C-level socket machinery. The executor's guarantees are what
    the security claim rests on; this catches the ordinary case — a library
    quietly phoning home mid-analysis — and is reported honestly as best-effort.
    """
    notes: list[str] = []
    try:
        import socket

        def denied(*_args: Any, **_kwargs: Any):
            raise OSError("Network access is disabled inside the analysis sandbox.")

        # Patch the connection *methods*, not the socket class. Replacing the
        # class breaks `class SSLSocket(socket)` in the standard library, which
        # takes down any import chain that touches ssl — statsmodels imports
        # urllib for its bundled example datasets, so this is not hypothetical.
        socket.socket.connect = denied  # type: ignore[method-assign]
        socket.socket.connect_ex = denied  # type: ignore[method-assign]
        socket.socket.sendto = denied  # type: ignore[method-assign]
        socket.create_connection = denied  # type: ignore[assignment]
        notes.append("socket_connect_blocked")
    except Exception as exc:  # noqa: BLE001
        notes.append(f"socket_block_failed:{type(exc).__name__}")
    return notes


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(json.dumps({"ok": False, "error": "usage: entrypoint <job.json>"}))
        return 2

    network_notes = _block_network()
    job = json.loads(Path(argv[1]).read_text(encoding="utf-8"))

    # One job may carry many specs. Discovery tests every usable pair of
    # columns, and paying a Python startup and a full re-read of the dataset
    # for each pair is what made a sweep of a forty-column file take a quarter
    # of an hour. The specs are system-generated from a closed list of methods,
    # so running them together is the same isolation boundary as running them
    # one at a time — and each keeps its own result, seed and verdict.
    specs = job.get("specs")
    batched = specs is not None
    if not batched:
        specs = [job["spec"]]

    started = time.time()
    try:
        import numpy as np
        import pandas as pd

        frame = _load_frame(job)
        runtime = {
            "python": sys.version.split()[0],
            "pandas": pd.__version__,
            "numpy": np.__version__,
            "scipy": __import__("scipy").__version__,
            "statsmodels": __import__("statsmodels").__version__,
        }
    except Exception as exc:  # noqa: BLE001
        # Nothing can be computed, so this is the whole job's failure whether
        # it carried one spec or eight hundred.
        import traceback

        return _emit({
            "ok": False,
            "error": f"{type(exc).__name__}: {exc}",
            "traceback": traceback.format_exc()[-4000:],
            "duration_ms": int((time.time() - started) * 1000),
            "sandbox_notes": network_notes,
        })

    results = [_run_one(frame, spec, runtime) for spec in specs]
    for entry in results:
        entry["sandbox_notes"] = network_notes

    if not batched:
        return _emit(results[0])
    return _emit({
        "ok": True,
        "results": results,
        "duration_ms": int((time.time() - started) * 1000),
        "sandbox_notes": network_notes,
        "runtime": runtime,
    })


def _load_frame(job: dict[str, Any]):
    """Read the input once. Every spec in this job sees the same frame."""
    import pandas as pd

    from .methods import AnalysisError

    input_path = Path(job["input_path"])
    suffix = job.get("input_suffix", input_path.suffix).lower()
    if suffix in {".csv", ".tsv"}:
        return pd.read_csv(
            input_path,
            sep="\t" if suffix == ".tsv" else job.get("delimiter", ","))
    if suffix in {".xlsx", ".xlsm"}:
        return pd.read_excel(input_path)
    if suffix == ".json":
        return pd.read_json(input_path)
    raise AnalysisError(f"Sandbox cannot read {suffix!r} input")


def _run_one(frame, spec: dict[str, Any], runtime: dict[str, str]) -> dict[str, Any]:
    """One spec against the loaded frame, reporting rather than raising.

    A failure here belongs to this candidate alone. One unusable pair out of
    eight hundred must not cost the sweep the other seven hundred and
    ninety-nine.
    """
    import random as _random

    started = time.time()
    try:
        import numpy as np

        from .methods import REGISTRY, AnalysisError

        # Seed every source of randomness we control, and record it. Re-seeded
        # per spec so a batched result is identical to a lone one.
        seed = int(spec.get("random_seed", 0))
        _random.seed(seed)
        np.random.seed(seed)

        method_name = spec["method"]
        if method_name not in REGISTRY:
            raise AnalysisError(f"Unknown method {method_name!r}")

        # Filters are declarative and applied here, inside the sandbox, so the
        # rows a result used are reproducible from the spec alone. The frame is
        # never mutated: filtering returns a new one, so the next spec in the
        # batch sees the file as it was read.
        used = frame
        for rule in spec.get("filters") or []:
            used = _apply_filter(used, rule)

        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            result = REGISTRY[method_name](used, spec)
            captured = [f"{w.category.__name__}: {w.message}" for w in caught]

        payload = result.to_dict()
        payload["warnings"] = list(payload.get("warnings") or []) + captured

        return {
            "ok": True,
            "result": payload,
            "rows_used": int(len(used)),
            "duration_ms": int((time.time() - started) * 1000),
            "runtime": runtime,
            "random_seed": seed,
        }
    except Exception as exc:  # noqa: BLE001 — the sandbox boundary reports, never crashes silently
        import traceback

        return {
            "ok": False,
            "error": f"{type(exc).__name__}: {exc}",
            # The traceback goes to the run's logs, not to the researcher: 
            # wants a useful explanation, and this is what makes one possible.
            "traceback": traceback.format_exc()[-4000:],
            "duration_ms": int((time.time() - started) * 1000),
        }


def _apply_filter(frame, rule: dict[str, Any]):
    """Apply one declarative filter. No expression evaluation, ever."""
    column, operator, value = rule["column"], rule["operator"], rule.get("value")
    if column not in frame.columns:
        raise ValueError(f"Filter references unknown column {column!r}")
    series = frame[column]
    if operator in {"gt", "gte", "lt", "lte"}:
        import pandas as pd

        series = pd.to_numeric(series, errors="coerce")
        comparisons = {"gt": series > value, "gte": series >= value,
                       "lt": series < value, "lte": series <= value}
        return frame[comparisons[operator].fillna(False)]
    if operator == "eq":
        return frame[series.astype(str) == str(value)]
    if operator == "ne":
        return frame[series.astype(str) != str(value)]
    if operator == "in":
        allowed = {str(v) for v in (value or [])}
        return frame[series.astype(str).isin(allowed)]
    if operator == "not_null":
        return frame[series.notna()]
    raise ValueError(f"Unsupported filter operator {operator!r}")


def _emit(payload: dict[str, Any]) -> int:
    sys.stdout.write(json.dumps(payload, default=str))
    sys.stdout.flush()
    return 0 if payload.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
