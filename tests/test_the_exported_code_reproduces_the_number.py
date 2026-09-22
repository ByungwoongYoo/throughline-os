"""
§75 — the script Throughline hands you produces the number Throughline recorded.

Everything else about a code export is decoration. If the script runs and
prints a different estimate, the feature is a lie told in a language that
looks authoritative, and this product exists to prevent exactly that.

So this test does not inspect the script. It writes a real CSV, runs the real
analysis through the real sandbox, generates the script, **executes it**, and
compares what it printed against what was recorded and what the receipt says
must be compared.
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
from throughline_domain import code_export, replay_capability, replay_receipt
from throughline_domain.analysis import RUN_COMPLETED
from throughline_domain.ids import new_id
from throughline_runtime.executor import run_analysis

EVIDENCE_METHODS = ("pearson_correlation", "spearman_correlation")


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


def _attach_dataset(cur, project: str, *, filename: str,
                    columns: list[tuple[str, str]], content_hash: str = "abc123") -> str:
    file_id, source_id = new_id("fil"), new_id("src")
    dataset_id, version_id = new_id("dst"), new_id("dsv")
    cur.execute(
        "INSERT INTO files(id, project_id, content_hash, filename, size_bytes, storage_key) "
        "VALUES (%s, %s, %s, %s, 1, %s)",
        (file_id, project, content_hash, filename, f"test/{file_id}"),
    )
    cur.execute(
        "INSERT INTO sources(id, project_id, source_type, title, file_id, content_hash, "
        "ingestion_status) VALUES (%s, %s, 'upload', %s, %s, %s, 'ready')",
        (source_id, project, filename, file_id, content_hash),
    )
    cur.execute(
        "INSERT INTO datasets(id, project_id, source_id, name, format) "
        "VALUES (%s, %s, %s, %s, 'csv')",
        (dataset_id, project, source_id, filename),
    )
    cur.execute(
        "INSERT INTO dataset_versions(id, dataset_id, version, content_hash, row_count, "
        "column_count) VALUES (%s, %s, 1, %s, 200, %s)",
        (version_id, dataset_id, content_hash, len(columns)),
    )
    for ordinal, (name, original_name) in enumerate(columns):
        cur.execute(
            "INSERT INTO dataset_columns(id, dataset_version_id, ordinal, name, "
            "original_name, physical_type, semantic_type) "
            "VALUES (%s, %s, %s, %s, %s, 'double', 'continuous')",
            (new_id("dcol"), version_id, ordinal, name, original_name),
        )
    return version_id


def _recorded(cur, project, data_path: Path, method: str, *,
              filters: list[dict] | None = None,
              recorded_variables: dict[str, str] | None = None,
              columns: list[tuple[str, str]] | None = None,
              filename: str | None = None) -> tuple[str, dict]:
    """A run that really executed, with its result stored as the product does."""
    runtime_variables = {"x": "consumption_ddd", "y": "resistance_pct"}
    spec = {"method": method, "variables": runtime_variables,
            "filters": filters or [], "confidence_level": 0.95, "random_seed": 0}
    sandbox = run_analysis(spec=spec, input_path=data_path, input_suffix=".csv")
    assert sandbox.ok, sandbox.payload
    result = sandbox.payload["result"]

    stored_variables = recorded_variables or runtime_variables
    recorded_columns = columns or [("consumption_ddd", "consumption_ddd"),
                                   ("resistance_pct", "resistance_pct")]
    version_id = _attach_dataset(
        cur, project, filename=filename or data_path.name, columns=recorded_columns)

    spec_id, run_id = new_id("aspec"), new_id("arun")
    spec_hash = new_id("hash")
    cur.execute(
        "INSERT INTO analysis_specs(id, project_id, analysis_type, method, "
        "variables, filters, research_question, method_rationale, content_hash, "
        "created_by, dataset_version_ids) VALUES (%s, %s, 'confirmatory', %s, "
        "%s, %s::jsonb, 'Does consumption track resistance?', 'Both are continuous.', "
        "%s, 'researcher', %s::jsonb)",
        (spec_id, project, method, stored_variables, json.dumps(filters or []),
         spec_hash, json.dumps([version_id])))
    cur.execute(
        "INSERT INTO analysis_runs(id, project_id, spec_id, status, result, "
        "input_hashes) VALUES (%s, %s, %s, %s, %s, %s)",
        (run_id, project, spec_id, RUN_COMPLETED, result,
         {"dataset_content_hash": "abc123", "spec_content_hash": spec_hash}))
    return run_id, result


def _run_script(script: str, data_path: Path, tmp_path: Path) -> dict[str, float]:
    """Execute the emitted script and read back what it printed."""
    script = script.replace(
        re.search(r"pd\.read_csv\((.*?)\)", script).group(1), repr(str(data_path)))
    written = tmp_path / "reproduce.py"
    written.write_text(script, encoding="utf-8")
    done = subprocess.run([sys.executable, str(written)],
                          capture_output=True, text=True)
    assert done.returncode == 0, done.stderr
    out = {}
    for line in done.stdout.splitlines():
        key, _, value = line.partition(" = ")
        out[key.strip()] = float(value)
    return out


def test_every_supported_method_has_an_executable_evidence_case():
    assert set(EVIDENCE_METHODS) == set(replay_capability.REPLAY_SUPPORTED_METHODS)


@pytest.mark.parametrize("method", EVIDENCE_METHODS)
def test_the_script_prints_every_receipt_defined_headline(cur, project, data, tmp_path,
                                                          method):
    run_id, recorded = _recorded(cur, project, data, method)
    receipt = replay_receipt.for_run(cur, run_id)

    printed = _run_script(code_export.for_run(cur, run_id), data, tmp_path)
    comparison = receipt["replay"]["comparison"]
    expected = receipt["replay"]["expected"]

    assert printed["estimate"] == pytest.approx(
        expected["estimate"], abs=comparison["estimate"]["abs_tol"])
    assert printed["p"] == pytest.approx(
        expected["p_value"], rel=comparison["p_value"]["rel_tol"],
        abs=comparison["p_value"]["abs_tol"])
    assert printed["n"] == expected["sample_size"] == recorded["sample_size"]


class TestItRefusesRatherThanApproximates:
    def test_a_method_it_cannot_write_out_is_named(self, cur, project, data):
        run_id, _ = _recorded(cur, project, data, "pearson_correlation")
        cur.execute("UPDATE analysis_specs SET method = 'mixed_model' "
                    "WHERE id = (SELECT spec_id FROM analysis_runs "
                    "WHERE id = %s)", (run_id,))

        with pytest.raises(code_export.CannotEmit) as raised:
            code_export.for_run(cur, run_id)
        assert "mixed_model" in str(raised.value)
        assert "pearson_correlation" in str(raised.value)

    def test_filters_are_refused_by_both_artifacts(self, cur, project, data):
        run_id, _ = _recorded(
            cur, project, data, "pearson_correlation",
            filters=[{"column": "consumption_ddd", "operator": "gt", "value": 25}],
        )
        with pytest.raises(code_export.CannotEmit, match="filters"):
            code_export.for_run(cur, run_id)
        with pytest.raises(replay_receipt.CannotReceipt, match="filters"):
            replay_receipt.for_run(cur, run_id)

    def test_non_csv_input_is_refused_by_both_artifacts(self, cur, project, data):
        run_id, _ = _recorded(
            cur, project, data, "pearson_correlation", filename="amr.tsv")
        with pytest.raises(code_export.CannotEmit, match="CSV"):
            code_export.for_run(cur, run_id)
        with pytest.raises(replay_receipt.CannotReceipt, match="CSV"):
            replay_receipt.for_run(cur, run_id)

    def test_column_translation_is_refused_by_both_artifacts(self, cur, project, data):
        run_id, _ = _recorded(
            cur, project, data, "pearson_correlation",
            recorded_variables={"x": "consumption", "y": "resistance_pct"},
            columns=[("consumption", "consumption_ddd"),
                     ("resistance_pct", "resistance_pct")],
        )
        with pytest.raises(code_export.CannotEmit, match="translation"):
            code_export.for_run(cur, run_id)
        with pytest.raises(replay_receipt.CannotReceipt, match="translation"):
            replay_receipt.for_run(cur, run_id)

    def test_an_unknown_run_is_refused(self, cur):
        with pytest.raises(LookupError):
            code_export.for_run(cur, "arun_nope")


class TestTheScriptSaysWhatItIsNot:
    def test_it_warns_that_a_bare_p_value_is_not_a_finding(self, cur, project,
                                                           data):
        run_id, _ = _recorded(cur, project, data, "pearson_correlation")
        script = " ".join(code_export.for_run(cur, run_id).split())
        assert "multiple-comparison correction" in script
        assert "not a finding" in script

    def test_it_names_the_data_it_expects(self, cur, project, data):
        """A different file is a different analysis, and the hash says which."""
        run_id, _ = _recorded(cur, project, data, "pearson_correlation")
        assert "abc123" in code_export.for_run(cur, run_id)
