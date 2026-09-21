"""A replay receipt binds the existing reproduction path to one immutable run."""
from __future__ import annotations

import json

import pytest
from throughline_domain import analysis, replay_receipt
from throughline_domain.analysis import RUN_COMPLETED
from throughline_domain.ids import new_id

RESULT = {
    "method": "pearson_correlation",
    "estimate": 0.62,
    "estimate_name": "pearson_r",
    "p_value": 0.001,
    "sample_size": 120,
    "warnings": ["kept in the recorded result, not copied into the headline receipt"],
}
BUILD = {
    "version": "60d129c",
    "source": "checkout",
    "commit": "60d129c9d2951b380058993138fd81365076a076",
    "modified": False,
    "note": "Taken from the checkout.",
}


def _run(cur, project, *, method="pearson_correlation", status=RUN_COMPLETED,
         result=None, environment=None):
    spec_id = new_id("aspec")
    spec_hash = "spec123"
    cur.execute(
        "INSERT INTO analysis_specs(id, project_id, analysis_type, method, "
        "variables, research_question, method_rationale, content_hash, "
        "created_by) VALUES (%s, %s, 'confirmatory', %s, %s, %s, %s, %s, "
        "'researcher')",
        (spec_id, project, method, {"x": "consumption", "y": "resistance"},
         "Does consumption track resistance?", "Both variables are continuous.",
         spec_hash),
    )
    run_id = analysis.create_run(cur, project_id=project, spec_id=spec_id)
    cur.execute(
        "UPDATE analysis_runs SET status=%s, result=%s, runtime=%s, "
        "random_seed=%s, dependency_versions=%s, input_hashes=%s, environment=%s, "
        "sandbox_policy=%s WHERE id=%s",
        (status, result or RESULT, "3.12.11", 11,
         {"python": "3.12.11", "pandas": "2.3.2", "scipy": "1.16.1"},
         {"dataset_content_hash": "data123", "spec_content_hash": spec_hash},
         environment if environment is not None else {"throughline": BUILD},
         {"enforced": {"separate_process": True}}, run_id),
    )
    return run_id


def test_receipt_is_stable_and_binds_the_existing_record(cur, project):
    run_id = _run(cur, project)

    first = replay_receipt.as_json(cur, run_id)
    second = replay_receipt.as_json(cur, run_id)
    assert first == second

    body = json.loads(first)
    assert body["format"] == "throughline.replay-receipt.v1"
    assert body["analysis"]["method"] == "pearson_correlation"
    assert body["analysis"]["spec_hash"] == "spec123"
    assert body["inputs"]["dataset_content_hash"] == "data123"
    assert body["execution"]["random_seed"] == 11
    assert body["execution"]["throughline"]["commit"] == BUILD["commit"]
    assert body["replay"]["companion_script"] == f"{run_id}-reproduce.py"
    assert body["replay"]["expected"]["estimate"] == RESULT["estimate"]
    assert body["replay"]["expected"]["sample_size"] == RESULT["sample_size"]
    assert body["replay"]["comparison"]["estimate"]["abs_tol"] == 1e-6
    assert "warnings" not in body["replay"]["expected"]
    assert len(body["integrity"]["recorded_result_sha256"]) == 64


def test_the_whole_recorded_result_is_bound_without_becoming_the_headline(cur, project):
    first_id = _run(cur, project)
    changed = {**RESULT, "warnings": ["a different recorded warning"]}
    second_id = _run(cur, project, result=changed)

    first = replay_receipt.for_run(cur, first_id)
    second = replay_receipt.for_run(cur, second_id)

    assert first["replay"]["expected"] == second["replay"]["expected"]
    assert first["integrity"]["recorded_result_sha256"] != \
        second["integrity"]["recorded_result_sha256"]


def test_an_old_run_never_infers_todays_checkout(cur, project):
    run_id = _run(cur, project, environment={"sandbox_notes": []})
    build = replay_receipt.for_run(cur, run_id)["execution"]["throughline"]

    assert build["source"] == "not_recorded"
    assert build["commit"] is None
    assert "not recorded" in build["note"].lower()


def test_a_method_without_a_faithful_companion_script_is_refused(cur, project):
    run_id = _run(cur, project, method="linear_regression")
    with pytest.raises(replay_receipt.CannotReceipt, match="linear_regression"):
        replay_receipt.for_run(cur, run_id)


def test_a_noncompleted_run_is_refused(cur, project):
    run_id = _run(cur, project, status="failed")
    with pytest.raises(replay_receipt.CannotReceipt, match="failed"):
        replay_receipt.for_run(cur, run_id)


def test_an_unknown_run_is_a_lookup_failure(cur):
    with pytest.raises(LookupError):
        replay_receipt.for_run(cur, "arun_nope")
