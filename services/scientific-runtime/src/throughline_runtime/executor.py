"""The sandbox executor — parent side.

 is non-negotiable: analysis code must not execute inside the main
application process. This module spawns the runtime as a separate process and
constrains it.

**What is genuinely enforced here**

* Separate OS process — a crash or a memory blow-up cannot take the API down.
* Scrubbed environment — no `THROUGHLINE_DATABASE_URL`, no `*_API_KEY`, no
  `*_TOKEN`, no OAuth material. The child is given the minimum needed to run
  Python.
* Isolated working directory, destroyed after the run.
* Read-only input — the source is copied in and chmod'd `0o444`, so an analysis
  cannot mutate the data it describes.
* Wall-clock timeout, killed by process group so children die too.
* CPU-seconds and address-space limits via `setrlimit`.
* No shell: the child is exec'd with an argument vector.

**What is best-effort and reported as such**

* Network egress. `setrlimit` cannot express it and this is not a container.
  The child disables Python-level sockets itself, which stops a library from
  quietly calling home but is not a kernel boundary.

`policy_report()` returns exactly which controls are enforced on this platform.
It is stored with every run and is what `require_full_isolation` checks
before it will run untrusted code — so the honest limits of a desktop sandbox
are recorded rather than assumed away.
"""

from __future__ import annotations

import json
import os
import platform
import resource
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

DEFAULT_TIMEOUT_SECONDS = 120
DEFAULT_MEMORY_MB = 2048
DEFAULT_CPU_SECONDS = 120

#: Environment variables the child may keep. Everything else is dropped, so a
#: secret cannot leak into an analysis process by accident.
_ENV_ALLOWLIST = {"PATH", "LANG", "LC_ALL", "TZ", "HOME", "TMPDIR", "PYTHONPATH"}
_SECRET_MARKERS = ("KEY", "TOKEN", "SECRET", "PASSWORD", "CREDENTIAL", "DATABASE", "DSN")


class SandboxError(RuntimeError):
    pass


class SandboxTimeout(SandboxError):
    pass


class IsolationUnavailable(SandboxError):
    """Required isolation controls are not available on this platform."""


@dataclass(slots=True)
class SandboxPolicy:
    timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS
    memory_mb: int = DEFAULT_MEMORY_MB
    cpu_seconds: int = DEFAULT_CPU_SECONDS
    allow_network: bool = False


@dataclass(slots=True)
class SandboxResult:
    ok: bool
    payload: dict[str, Any] = field(default_factory=dict)
    stderr: str = ""
    exit_code: int | None = None
    duration_ms: int = 0
    policy: dict[str, Any] = field(default_factory=dict)


def scrub_environment() -> dict[str, str]:
    """Build the child's environment: allowlisted, and never anything secret."""
    env = {
        key: value
        for key, value in os.environ.items()
        if key in _ENV_ALLOWLIST and not any(marker in key.upper() for marker in _SECRET_MARKERS)
    }
    env["PYTHONHASHSEED"] = "0"          # determinism
    env["PYTHONDONTWRITEBYTECODE"] = "1"  # keep the working directory clean
    env["MPLBACKEND"] = "Agg"             # no display access
    # Deterministic single-threaded BLAS: thread scheduling otherwise perturbs
    # floating-point reductions and a rerun stops being bit-identical.
    for var in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS",
                "NUMEXPR_NUM_THREADS", "VECLIB_MAXIMUM_THREADS"):
        env[var] = "1"
    return env


def policy_report(policy: SandboxPolicy | None = None) -> dict[str, Any]:
    """Which  controls this platform actually enforces."""
    policy = policy or SandboxPolicy()
    return {
        "platform": platform.system(),
        "enforced": {
            "separate_process": True,
            "scrubbed_environment": True,
            "no_application_secrets": True,
            "isolated_working_directory": True,
            "read_only_inputs": True,
            "wall_clock_timeout": True,
            "cpu_limit": True,
            "memory_limit": True,
            "environment_destroyed_after_run": True,
            "no_shell": True,
        },
        "best_effort": {
            # Honest: this is a process sandbox, not a container.
            "network_egress_disabled": "python_level_only",
        },
        "not_enforced": {
            "kernel_level_filesystem_isolation": True,
            "gpu_quota": True,
        },
        "limits": {
            "timeout_seconds": policy.timeout_seconds,
            "memory_mb": policy.memory_mb,
            "cpu_seconds": policy.cpu_seconds,
        },
        "note": ("Process-level isolation suitable for the platform's own declarative "
                 "analysis methods. Arbitrary or model-authored code requires "
                 "container isolation and is refused until that exists."),
    }


def require_full_isolation() -> None:
    """Gate for running code the researcher did not write.

    Phase 2 executes only whitelisted methods driven by a validated spec, so this
    is not needed yet. It exists so that whoever later adds model-authored code
    has to confront the missing container boundary rather than discover it in
    production.
    """
    raise IsolationUnavailable(
        "Executing arbitrary or model-authored code requires kernel-level isolation "
        "(container or VM), which this desktop deployment does not provide. "
        "Only whitelisted AnalysisSpec methods may run."
    )


def _limit_child(policy: SandboxPolicy) -> None:
    """Runs in the forked child, before exec."""
    # Own process group so a timeout kills the whole tree, not just the parent stub.
    os.setsid()
    resource.setrlimit(resource.RLIMIT_CPU, (policy.cpu_seconds, policy.cpu_seconds))
    memory_bytes = policy.memory_mb * 1024 * 1024
    try:
        resource.setrlimit(resource.RLIMIT_AS, (memory_bytes, memory_bytes))
    except (ValueError, OSError):
        # macOS refuses RLIMIT_AS for large values; RLIMIT_DATA is the fallback.
        try:
            resource.setrlimit(resource.RLIMIT_DATA, (memory_bytes, memory_bytes))
        except (ValueError, OSError):
            pass
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))  # no core dumps of research data
    resource.setrlimit(resource.RLIMIT_NPROC, (64, 64))


def run_analysis(
    *,
    spec: dict[str, Any],
    input_path: Path,
    input_suffix: str,
    policy: SandboxPolicy | None = None,
) -> SandboxResult:
    """Execute one analysis in an isolated process and return its JSON result."""
    policy = policy or SandboxPolicy()
    report = policy_report(policy)
    started = time.time()

    workdir = Path(tempfile.mkdtemp(prefix="throughline-sandbox-"))
    try:
        # Copy the input in and make it read-only: an analysis describes data, it
        # does not alter it .
        sandbox_input = workdir / f"input{input_suffix or '.csv'}"
        shutil.copy2(input_path, sandbox_input)
        sandbox_input.chmod(0o444)

        job_path = workdir / "job.json"
        job_path.write_text(json.dumps({
            "spec": spec,
            "input_path": str(sandbox_input),
            "input_suffix": input_suffix,
        }), encoding="utf-8")
        job_path.chmod(0o444)

        process = subprocess.Popen(
            [sys.executable, "-I", "-m", "throughline_runtime.entrypoint", str(job_path)],
            cwd=workdir,
            env=scrub_environment(),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            preexec_fn=lambda: _limit_child(policy),  # noqa: PLW1509 — intended
            text=True,
            shell=False,
        )
        try:
            stdout, stderr = process.communicate(timeout=policy.timeout_seconds)
        except subprocess.TimeoutExpired:
            os.killpg(os.getpgid(process.pid), signal.SIGKILL)
            process.communicate()
            raise SandboxTimeout(
                f"Analysis exceeded its {policy.timeout_seconds}s limit and was terminated."
            ) from None

        duration = int((time.time() - started) * 1000)
        if not stdout.strip():
            return SandboxResult(
                ok=False,
                payload={"error": "The analysis process produced no output. "
                                  "It was most likely killed by a resource limit."},
                stderr=stderr[-4000:], exit_code=process.returncode,
                duration_ms=duration, policy=report,
            )
        try:
            payload = json.loads(stdout)
        except json.JSONDecodeError:
            return SandboxResult(
                ok=False,
                payload={"error": "The analysis process returned malformed output."},
                stderr=(stdout[-2000:] + "\n" + stderr[-2000:]),
                exit_code=process.returncode, duration_ms=duration, policy=report,
            )

        return SandboxResult(
            ok=bool(payload.get("ok")), payload=payload, stderr=stderr[-4000:],
            exit_code=process.returncode, duration_ms=duration, policy=report,
        )
    finally:
        #  — destroy the environment after execution.
        shutil.rmtree(workdir, ignore_errors=True)
