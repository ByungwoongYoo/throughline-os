"""
§75 — the script Throughline hands you produces the number Throughline recorded.

Everything else about a code export is decoration. If the script runs and
prints a different estimate, the feature is a lie told in a language that
looks authoritative, and this product exists to prevent exactly that.

So this test does not inspect the script. It writes a real CSV, runs the real
analysis through the real sandbox, generates the script, **executes it**, and
compares what it printed against what was recorded.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from throughline_domain import code_export
from throughline_domain.analysis import RUN_COMPLETED
from throughline_domain.ids import new_id
from throughline_runtime.executor import run_analysis


@pytest.fixture(scope="module")
def data(tmp_path_factory) -> Path:
    rng = np.random.default_rng(11)
    n = 200
    consumption = rng.normal(25, 6, n)
    frame = pd.DataFrame({
        "consumption_ddd": consumption,
        "resistance_pct": 0.8 * consumption + rng.normal(0, 3, n),
    })
    # A few gaps, so listwise deletion is actually exercised rather than
    # assumed — the script and the runtime must drop the same rows.
    frame.loc[3:6, "resistance_pct"] = None
    frame.loc[10:11, "consumption_ddd"] = None
    path = tmp_path_factory.mktemp("code") / "amr.csv"
    frame.to_csv(path, index=False)
    return path


def _recorded(cur, project, data_path: Path, method: str) -> tuple[str, dict]:
    """A run that really executed, with its result stored as the product does."""
    spec = {"method": method,
            "variables": {"x": "consumption_ddd", "y": "resistance_pct"},
            "confidence_level": 0.95, "random_seed": 0}
    sandbox = run_analysis(spec=spec, input_path=data_path, input_suffix=".csv")
    assert sandbox.ok, sandbox.payload
    result = sandbox.payload["result"]

    spec_id, run_id = new_id("aspec"), new_id("arun")
    cur.execute(
        "INSERT INTO analysis_specs(id, project_id, analysis_type, method, "
        "variables, research_question, method_rationale, content_hash, "
        "created_by, dataset_version_ids) VALUES (%s, %s, 'confirmatory', %s, "
        "%s, 'Does consumption track resistance?', 'Both are continuous.', "
        "%s, 'researcher', '[]'::jsonb)",
        (spec_id, project, method, spec["variables"], new_id("hash")))
    cur.execute(
        "INSERT INTO analysis_runs(id, project_id, spec_id, status, result, "
        "input_hashes) VALUES (%s, %s, %s, %s, %s, %s)",
        (run_id, project, spec_id, RUN_COMPLETED, result,
         {"dataset_content_hash": "abc123"}))
    return run_id, result


def _run_script(script: str, data_path: Path, tmp_path: Path) -> dict[str, float]:
    """Execute the emitted script and read back what it printed."""
    script = script.replace(
        re.search(r"pd\.read_csv\((.*?)\)", script).group(1), repr(str(data_path)))
    written = tmp_path / "reproduce.py"
    written.write_text(script)
    done = subprocess.run([sys.executable, str(written)],
                          capture_output=True, text=True)
    assert done.returncode == 0, done.stderr
    out = {}
    for line in done.stdout.splitlines():
        key, _, value = line.partition(" = ")
        out[key.strip()] = float(value)
    return out


@pytest.mark.parametrize("method", ["pearson_correlation",
                                    "spearman_correlation"])
def test_the_script_prints_the_recorded_number(cur, project, data, tmp_path,
                                               method):
    run_id, recorded = _recorded(cur, project, data, method)

    printed = _run_script(code_export.for_run(cur, run_id), data, tmp_path)

    assert printed["estimate"] == pytest.approx(recorded["estimate"], abs=1e-6)
    assert printed["p"] == pytest.approx(recorded["p_value"], rel=1e-6)


def test_it_drops_the_same_rows_the_run_did(cur, project, data, tmp_path):
    """
    The fixture has gaps in both columns. Dropping them per-column rather than
    pairwise would compare different subsets and quietly give another answer.
    """
    run_id, recorded = _recorded(cur, project, data, "pearson_correlation")

    printed = _run_script(code_export.for_run(cur, run_id), data, tmp_path)

    assert printed["n"] == recorded["sample_size"]


class TestItRefusesRatherThanApproximates:
    def test_a_method_it_cannot_write_out_is_named(self, cur, project, data):
        run_id, _ = _recorded(cur, project, data, "pearson_correlation")
        cur.execute("UPDATE analysis_specs SET method = 'mixed_model' "
                    "WHERE id = (SELECT spec_id FROM analysis_runs "
                    "WHERE id = %s)", (run_id,))

        with pytest.raises(code_export.CannotEmit) as raised:
            code_export.for_run(cur, run_id)
        assert "mixed_model" in str(raised.value)
        # And says what it can do, so the refusal is actionable.
        assert "pearson_correlation" in str(raised.value)

    def test_an_unknown_run_is_refused(self, cur):
        with pytest.raises(LookupError):
            code_export.for_run(cur, "arun_nope")


class TestTheScriptSaysWhatItIsNot:
    def test_it_warns_that_a_bare_p_value_is_not_a_finding(self, cur, project,
                                                           data):
        run_id, _ = _recorded(cur, project, data, "pearson_correlation")
        # Whitespace-insensitive: the sentence wraps, so a literal match on
        # "multiple-comparison correction" fails on the line break rather than
        # on the meaning.
        script = " ".join(code_export.for_run(cur, run_id).split())
        assert "multiple-comparison correction" in script
        assert "not a finding" in script

    def test_it_names_the_data_it_expects(self, cur, project, data):
        """A different file is a different analysis, and the hash says which."""
        run_id, _ = _recorded(cur, project, data, "pearson_correlation")
        assert "abc123" in code_export.for_run(cur, run_id)
