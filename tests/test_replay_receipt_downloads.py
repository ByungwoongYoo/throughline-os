"""The replay receipt is a scoped file beside the existing reproduction script."""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient
from throughline_domain import analysis, auth
from throughline_domain.analysis import RUN_COMPLETED
from throughline_domain.db import connection
from throughline_domain.ids import new_id
from conftest import sign_in


@pytest.fixture()
def client():
    from throughline_api.app import app

    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(autouse=True)
def clean_users():
    yield
    with connection() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM users")
        conn.commit()


def _account(client) -> None:
    sign_in(client, email="receipt@lab.local", display_name="Receipt")


def _attach_dataset(cur, project_id: str) -> tuple[str, str]:
    file_id, source_id = new_id("fil"), new_id("src")
    dataset_id, version_id = new_id("dst"), new_id("dsv")
    dataset_hash = new_id("hash")
    cur.execute(
        "INSERT INTO files(id, project_id, content_hash, filename, size_bytes, storage_key) "
        "VALUES (%s, %s, %s, 'receipt.csv', 1, %s)",
        (file_id, project_id, dataset_hash, f"test/{file_id}"),
    )
    cur.execute(
        "INSERT INTO sources(id, project_id, source_type, title, file_id, content_hash, "
        "ingestion_status) VALUES (%s, %s, 'upload', 'receipt.csv', %s, %s, 'ready')",
        (source_id, project_id, file_id, dataset_hash),
    )
    cur.execute(
        "INSERT INTO datasets(id, project_id, source_id, name, format) "
        "VALUES (%s, %s, %s, 'receipt.csv', 'csv')",
        (dataset_id, project_id, source_id),
    )
    cur.execute(
        "INSERT INTO dataset_versions(id, dataset_id, version, content_hash, row_count, "
        "column_count) VALUES (%s, %s, 1, %s, 40, 2)",
        (version_id, dataset_id, dataset_hash),
    )
    for ordinal, name in enumerate(("x", "y")):
        cur.execute(
            "INSERT INTO dataset_columns(id, dataset_version_id, ordinal, name, "
            "original_name, physical_type, semantic_type) "
            "VALUES (%s, %s, %s, %s, %s, 'double', 'continuous')",
            (new_id("dcol"), version_id, ordinal, name, name),
        )
    return version_id, dataset_hash


def _completed_run(project_id: str, *, status=RUN_COMPLETED) -> str:
    with connection() as conn, conn.cursor() as cur:
        version_id, dataset_hash = _attach_dataset(cur, project_id)
        spec_id = new_id("aspec")
        spec_hash = new_id("spec")
        cur.execute(
            "INSERT INTO analysis_specs(id, project_id, analysis_type, method, "
            "variables, filters, research_question, method_rationale, content_hash, "
            "created_by, dataset_version_ids) VALUES (%s, %s, 'confirmatory', "
            "'pearson_correlation', %s, '[]'::jsonb, 'Does x track y?', "
            "'Both are continuous.', %s, 'researcher', %s::jsonb)",
            (spec_id, project_id, {"x": "x", "y": "y"}, spec_hash,
             json.dumps([version_id])),
        )
        run_id = analysis.create_run(cur, project_id=project_id, spec_id=spec_id)
        cur.execute(
            "UPDATE analysis_runs SET status=%s, result=%s, runtime=%s, "
            "random_seed=%s, dependency_versions=%s, input_hashes=%s, environment=%s, "
            "sandbox_policy=%s WHERE id=%s",
            (status,
             {"method": "pearson_correlation", "estimate": 0.5,
              "estimate_name": "pearson_r", "p_value": 0.01, "sample_size": 40},
             "3.12.11", 0, {"scipy": "1.16.1"},
             {"dataset_content_hash": dataset_hash, "spec_content_hash": spec_hash},
             {"throughline": {"version": "v0.3.0", "source": "release",
                              "commit": None, "modified": False}},
             {"enforced": {"separate_process": True}}, run_id),
        )
        conn.commit()
        return run_id


def test_it_arrives_as_a_json_attachment(client):
    _account(client)
    project_id = client.post("/api/projects", json={"name": "Receipt"}).json()["id"]
    run_id = _completed_run(project_id)

    response = client.get(f"/api/analyses/{run_id}/receipt.json")

    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("application/json")
    assert "attachment" in response.headers["content-disposition"]
    assert run_id in response.headers["content-disposition"]
    assert response.json()["run_id"] == run_id
    assert response.json()["replay"]["expected"]["sample_size"] == 40


def test_a_failed_run_is_a_considered_409(client):
    _account(client)
    project_id = client.post("/api/projects", json={"name": "Receipt"}).json()["id"]
    run_id = _completed_run(project_id, status="failed")

    response = client.get(f"/api/analyses/{run_id}/receipt.json")

    assert response.status_code == 409
    assert "failed" in response.text


def test_another_account_cannot_download_the_receipt(client):
    _account(client)
    project_id = client.post("/api/projects", json={"name": "Private"}).json()["id"]
    run_id = _completed_run(project_id)

    with connection() as conn, conn.cursor() as cur:
        auth.create_user(cur, email="other@lab.local", display_name="Other",
                         password="correct-horse-battery")
        conn.commit()
    assert client.post("/api/auth/login", json={
        "email": "other@lab.local",
        "password": "correct-horse-battery",
    }).status_code == 200

    assert client.get(f"/api/analyses/{run_id}/receipt.json").status_code in (403, 404)
