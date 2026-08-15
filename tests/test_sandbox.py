"""§43 — the sandbox must actually confine, not merely be described as confining."""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from throughline_runtime import executor
from throughline_runtime.executor import (
    IsolationUnavailable,
    SandboxPolicy,
    SandboxTimeout,
    run_analysis,
    scrub_environment,
)

CSV = "x,y,g\n1,2.0,a\n2,4.1,a\n3,5.9,b\n4,8.2,b\n5,9.8,a\n6,12.1,b\n7,14.2,a\n8,15.8,b\n"


@pytest.fixture()
def dataset(tmp_path) -> Path:
    path = tmp_path / "data.csv"
    path.write_text(CSV)
    return path


def _spec(method: str, **variables) -> dict:
    return {"method": method, "variables": variables, "confidence_level": 0.95,
            "random_seed": 7, "filters": [], "method_rationale": "test"}


def test_the_policy_report_describes_this_platform_and_not_another():
    """
    Every field in this report was once a hardcoded True sitting beside a real
    `platform.system()` call — a report that named the platform correctly and then
    described a different platform's guarantees. It is stored with every analysis
    run, so a result would have carried a claim nobody had checked.

    Asserted against the running platform rather than a fixed expectation, so the
    test is meaningful on whichever one CI happens to be.
    """
    report = executor.policy_report()

    if executor.WINDOWS:  # pragma: no cover - selected by platform
        assert report["mechanism"] == "windows_job_object"
        # chmod(0o444) sets an attribute the analysis could clear; POSIX mode bits
        # deny the write outright. Claiming the stronger one here would be the
        # exact overstatement this test exists to prevent.
        assert report["enforced"]["read_only_inputs"] is False
        assert report["best_effort"]["read_only_inputs"] == "read_only_attribute_only"
    else:
        assert report["mechanism"] == "posix_rlimit_process_group"
        assert report["enforced"]["read_only_inputs"] is True
        assert "read_only_inputs" not in report["best_effort"]

    # True on both, by different mechanisms — that is the point of the port.
    for control in ("separate_process", "cpu_limit", "memory_limit",
                    "process_tree_killed_together", "no_shell",
                    "scrubbed_environment", "wall_clock_timeout"):
        assert report["enforced"][control] is True, control

    # Never claimed anywhere: this is a process sandbox, not a container.
    assert report["not_enforced"]["kernel_level_filesystem_isolation"] is True
    assert report["best_effort"]["network_egress_disabled"] == "python_level_only"


def test_analysis_runs_in_a_separate_process(dataset):
    result = run_analysis(spec=_spec("pearson_correlation", x="x", y="y"),
                          input_path=dataset, input_suffix=".csv")
    assert result.ok, result.payload
    assert result.payload["result"]["method"] == "pearson_correlation"
    # The policy travelling with the result is what §44 stores.
    assert result.policy["enforced"]["separate_process"] is True


def test_secrets_never_reach_the_child_environment(monkeypatch):
    """§43 — no application secrets, no OAuth credentials, no database URL."""
    monkeypatch.setenv("THROUGHLINE_DATABASE_URL", "postgresql://user:pw@localhost/db")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-must-not-leak")
    monkeypatch.setenv("GOOGLE_OAUTH_TOKEN", "ya29.must-not-leak")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "must-not-leak")

    env = scrub_environment()
    joined = " ".join(f"{k}={v}" for k, v in env.items())
    assert "must-not-leak" not in joined
    assert "postgresql://" not in joined
    assert not any("KEY" in k.upper() or "TOKEN" in k.upper() or "DATABASE" in k.upper()
                   for k in env)
    # Determinism is part of the contract (§124).
    assert env["PYTHONHASHSEED"] == "0" and env["OMP_NUM_THREADS"] == "1"


def test_input_is_read_only_inside_the_sandbox(dataset):
    """§26 — an analysis describes data; it must not be able to rewrite it."""
    original = dataset.read_text()
    spec = _spec("descriptive", columns=["x", "y"])
    result = run_analysis(spec=spec, input_path=dataset, input_suffix=".csv")
    assert result.ok
    assert dataset.read_text() == original


def test_working_directory_is_destroyed_after_the_run(dataset, monkeypatch):
    seen: list[Path] = []
    real_mkdtemp = executor.tempfile.mkdtemp

    def spy(*args, **kwargs):
        path = real_mkdtemp(*args, **kwargs)
        seen.append(Path(path))
        return path

    monkeypatch.setattr(executor.tempfile, "mkdtemp", spy)
    run_analysis(spec=_spec("descriptive", columns=["x"]),
                 input_path=dataset, input_suffix=".csv")
    assert seen and not seen[0].exists()


def test_a_runaway_analysis_is_killed_by_the_timeout(dataset, monkeypatch):
    """A hung analysis must not hold a worker forever."""
    # Point the entrypoint at a sleep so the timeout path is exercised for real.
    import subprocess as sp

    real_popen = sp.Popen

    def slow_popen(argv, **kwargs):
        return real_popen([argv[0], "-c", "import time; time.sleep(30)"], **kwargs)

    monkeypatch.setattr(executor.subprocess, "Popen", slow_popen)
    with pytest.raises(SandboxTimeout):
        run_analysis(spec=_spec("descriptive", columns=["x"]),
                     input_path=dataset, input_suffix=".csv",
                     policy=SandboxPolicy(timeout_seconds=2))


def test_arbitrary_code_execution_is_refused_outright():
    """§123 — the missing container boundary is stated, not assumed away."""
    with pytest.raises(IsolationUnavailable) as exc:
        executor.require_full_isolation()
    assert "kernel-level isolation" in str(exc.value)


def test_policy_report_distinguishes_enforced_from_best_effort():
    report = executor.policy_report()
    assert report["enforced"]["no_application_secrets"] is True
    # Network blocking is honestly labelled as Python-level only.
    assert report["best_effort"]["network_egress_disabled"] == "python_level_only"
    assert report["not_enforced"]["kernel_level_filesystem_isolation"] is True


def test_unknown_method_is_refused_by_the_runtime(dataset):
    result = run_analysis(spec=_spec("delete_everything", x="x", y="y"),
                          input_path=dataset, input_suffix=".csv")
    assert result.ok is False
    assert "Unknown method" in result.payload["error"]


def test_filters_are_declarative_not_evaluated(dataset):
    """No expression evaluation: an operator is looked up, never exec'd."""
    spec = _spec("descriptive", columns=["x"])
    spec["filters"] = [{"column": "x", "operator": "__import__('os').system", "value": 1}]
    result = run_analysis(spec=spec, input_path=dataset, input_suffix=".csv")
    assert result.ok is False
    assert "Unsupported filter operator" in result.payload["error"]


def test_results_are_deterministic_across_runs(dataset):
    """§124 — scientific computation tests must be deterministic."""
    spec = _spec("linear_regression", outcome="y", predictors=["x"])
    first = run_analysis(spec=spec, input_path=dataset, input_suffix=".csv")
    second = run_analysis(spec=spec, input_path=dataset, input_suffix=".csv")
    assert first.payload["result"]["estimate"] == second.payload["result"]["estimate"]
    assert first.payload["result"]["p_value"] == second.payload["result"]["p_value"]


def test_network_egress_is_blocked_inside_the_sandbox(dataset, tmp_path):
    """Best-effort, but it must actually work for the ordinary case.

    Uses the real entrypoint so the check exercises the shipped code path rather
    than a re-implementation of it.
    """
    import json
    import subprocess
    import sys

    probe = tmp_path / "probe.py"
    probe.write_text(
        "import json\n"
        "from throughline_runtime.entrypoint import _block_network\n"
        "notes = _block_network()\n"
        "import socket\n"
        "try:\n"
        "    socket.create_connection(('example.com', 80), timeout=2)\n"
        "    outcome = 'connected'\n"
        "except OSError as exc:\n"
        "    outcome = f'blocked:{exc}'\n"
        "# ssl must still import: the block must not break the standard library.\n"
        "import ssl\n"
        "print(json.dumps({'notes': notes, 'outcome': outcome, 'ssl': ssl.__name__}))\n"
    )
    completed = subprocess.run(
        [sys.executable, str(probe)], capture_output=True, text=True,
        env=executor.scrub_environment(), timeout=60,
    )
    assert completed.returncode == 0, completed.stderr
    payload = json.loads(completed.stdout.strip().splitlines()[-1])
    assert payload["notes"] == ["socket_connect_blocked"]
    assert payload["outcome"].startswith("blocked:")
    assert payload["ssl"] == "ssl"


# ---------------------------------------------------------------------------
# A limit that could not be applied must not pass silently
# ---------------------------------------------------------------------------

def test_an_unapplied_memory_limit_is_admitted_in_the_run(monkeypatch, tmp_path):
    """
    Both RLIMIT_AS and RLIMIT_DATA can be refused — macOS refuses the first for
    large values, and some hosts refuse both. That used to be caught and
    discarded, so the sandbox claimed a ceiling it was not applying while
    everything downstream went on believing it.

    Running anyway is right: refusing would make the platform unusable wherever
    this happens. Being quiet about it is not. The parent captures the child's
    stderr into the recorded result, so the run carries the admission.
    """
    import os
    import resource as resource_module

    from throughline_runtime import executor

    written: list[bytes] = []

    def refuse_memory_only(which, _limits):
        # Faithful to the real case: macOS refuses the address-space limit, not
        # the CPU one, so refusing everything would raise before the memory
        # block is reached.
        #
        # The other limits are swallowed rather than applied. This helper is
        # written to run in a forked child immediately before exec; calling it
        # in-process applies the limits to pytest itself, and RLIMIT_NPROC(64)
        # on the test runner breaks every subprocess for the rest of the session.
        if which in (resource_module.RLIMIT_AS, resource_module.RLIMIT_DATA):
            raise OSError("not permitted on this platform")
        return None

    monkeypatch.setattr(resource_module, "setrlimit", refuse_memory_only)
    monkeypatch.setattr(executor.os, "setsid", lambda: None)
    monkeypatch.setattr(executor.os, "write",
                        lambda fd, data: written.append(data))

    executor._limit_child(executor.SandboxPolicy(memory_mb=512))

    assert written, "no warning was written when the limit could not be applied"
    message = b"".join(written).decode()
    assert "WITHOUT a memory ceiling" in message
    assert "512MB" in message


def test_the_warning_names_the_limit_that_was_requested(monkeypatch):
    """A warning that does not say what was asked for cannot be acted on."""
    import resource as resource_module

    from throughline_runtime import executor

    written: list[bytes] = []

    def refuse_memory_only(which, _limits):
        if which in (resource_module.RLIMIT_AS, resource_module.RLIMIT_DATA):
            raise ValueError("no")
        return None

    monkeypatch.setattr(resource_module, "setrlimit", refuse_memory_only)
    monkeypatch.setattr(executor.os, "setsid", lambda: None)
    monkeypatch.setattr(executor.os, "write", lambda fd, data: written.append(data))

    executor._limit_child(executor.SandboxPolicy(memory_mb=2048))

    assert "2048MB" in b"".join(written).decode()
