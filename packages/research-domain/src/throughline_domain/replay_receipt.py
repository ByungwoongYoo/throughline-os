"""Portable replay receipt for one immutable recorded analysis run.

A receipt is issued only inside the same explicit eligibility boundary as the
companion reproduction script.  It binds:

- which immutable run/spec/data were used;
- which seed/runtime/dependencies and Throughline build produced it;
- which headline values the companion reproduction script must reproduce; and
- which comparison rule decides whether the replay agrees.

It deliberately does *not* claim to reproduce a finding, its assumption checks,
or a multiple-comparison decision.  The companion script carries the same
boundary and this receipt keeps it explicit.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any

from . import code_export, replay_capability

FORMAT = "throughline.replay-receipt.v1"

# These match the text precision emitted by code_export.py:
#   estimate -> .6f  (<= 5e-7 absolute rounding)
#   p-value  -> .6g  (<= ~5e-6 relative rounding)
COMPARISON = {
    "estimate": {"abs_tol": 1e-6},
    "p_value": {"rel_tol": 1e-5, "abs_tol": 0.0},
    "sample_size": {"exact": True},
}


class CannotReceipt(RuntimeError):
    """The run exists, but it is outside the current replay-receipt contract."""


def _canonical(value: Any) -> str:
    """Stable UTF-8 JSON used for downloadable bytes and integrity hashes."""
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        default=str,
    )


def _sha256(value: Any) -> str:
    return hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()


def _recorded_build(environment: dict[str, Any]) -> dict[str, Any]:
    """The build that actually ran, or an explicit historical absence.

    Never substitute version.current() here: doing that later would attribute
    today's checkout to yesterday's result, which is exactly the provenance
    error this receipt exists to avoid.
    """
    recorded = environment.get("throughline")
    if recorded:
        return dict(recorded)
    return {
        "version": None,
        "source": "not_recorded",
        "commit": None,
        "modified": None,
        "note": "Throughline build identity was not recorded when this run executed.",
    }


def for_run(cur, run_id: str) -> dict[str, Any]:
    try:
        run = replay_capability.eligible_run(cur, run_id)
    except replay_capability.ReplayIneligible as exc:
        raise CannotReceipt(str(exc)) from exc

    method = str(run["method"])
    if method not in code_export.EMITTABLE:
        # Classification and implementation drift is a broken build, but a
        # receipt must still fail closed if it somehow reaches production.
        raise CannotReceipt(
            f"{method} is declared replay-supported but has no companion exporter "
            "in this build."
        )

    result = dict(run.get("result") or {})
    receipt: dict[str, Any] = {
        "format": FORMAT,
        "run_id": run["id"],
        "analysis": {
            "method": method,
            "variables": run.get("variables") or {},
            "spec_hash": run.get("spec_hash"),
        },
        "inputs": run.get("input_hashes") or {},
        "execution": {
            "random_seed": run.get("random_seed"),
            "python": run.get("runtime") or None,
            "dependencies": run.get("dependency_versions") or {},
            "throughline": _recorded_build(run.get("environment") or {}),
            "sandbox_policy": run.get("sandbox_policy") or {},
        },
        "replay": {
            "companion_script": f"{run_id}-reproduce.py",
            "expected": {
                "estimate_name": result.get("estimate_name"),
                "estimate": result["estimate"],
                "p_value": result["p_value"],
                "sample_size": result["sample_size"],
            },
            "comparison": COMPARISON,
        },
        "integrity": {
            "algorithm": "sha256",
            "canonicalization": "json-sort-keys-compact-utf8",
            # The whole stored result is bound without copying all warnings,
            # assumptions, intervals and auxiliary fields into this small file.
            "recorded_result_sha256": _sha256(result),
        },
    }
    return receipt


def as_json(cur, run_id: str) -> str:
    """Byte-stable export: unchanged run => identical downloaded receipt."""
    return _canonical(for_run(cur, run_id)) + "\n"
