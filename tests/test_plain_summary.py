"""
The plain-language reading of a result, and the route that serves it.

**Neither existed in practice.** `throughline_domain.interpret` was imported by
nothing — not by the API, not by a worker, not by a test — and the route the
interface has been calling since `ResultCard` was written,
`/api/analyses/{id}/plain-summary`, was never registered. Every one of those
requests fell through to the catch-all that serves the interface, so the client
asked for JSON and received a web page.

The property most worth holding is the one that made the summary safe to show
at all: **it contains no numbers**. A paraphrase that restates a figure can
round it, or drift from it as the recorded value changes, and the exact values
are already on screen beside it. The module checks the model's output for
figures and refuses one that carries them — and nothing had ever exercised that
check.
"""

from __future__ import annotations

from typing import Any

import pytest
from throughline_domain import interpret
from throughline_domain.ids import new_id
from throughline_model.schemas import PlainSummary


class _Completion:
    """What a provider reports about the call it just made."""

    class usage:
        prompt_tokens = 10
        completion_tokens = 20
        duration_ms = 5

    model = "test-model"
    prompt_name = "plain_summary"
    prompt_version = 3


class _Provider:
    """A model that returns exactly what a test tells it to."""

    def __init__(self, summary: PlainSummary) -> None:
        self.summary = summary
        self.calls = 0

    def generate_structured(self, **_: Any):
        self.calls += 1
        return self.summary, _Completion()


def _summary(**over: Any) -> PlainSummary:
    return PlainSummary(**{
        "headline": "Antibiotic use tracks resistance across these countries.",
        "what_it_means": "Where more antibiotics are used, more resistance is "
                         "seen. The two move together in this data.",
        "how_confident": "Moderately. The pattern is consistent, and the check "
                         "for unusual points did not flag any.",
        "what_would_change_it": "Data from countries with very different "
                                "prescribing rules.",
        "causal_reading": "association_only",
        **over,
    })


def _use(monkeypatch, provider: _Provider) -> None:
    # Patched on the module that reads it: `interpret` imported the name
    # directly, so replacing it on `throughline_model` would change nothing.
    monkeypatch.setattr(interpret, "provider", lambda: provider)


@pytest.fixture()
def completed_run(cur, project) -> str:
    """One finished analysis with a result worth describing."""
    return _run(cur, project, "completed",
                '{"method": "pearson_correlation", '
                '"evidence_quality": "moderate", '
                '"practical_significance": "meaningful"}')


def _run(cur, project: str, status: str, result: str | None = None) -> str:
    """One analysis run, with the spec every run is required to have."""
    spec_id = new_id("asp")
    # Inserted rather than built through `analysis.create_spec`, which
    # validates variables against a profiled dataset this test does not need:
    # `interpret` reads the result and the research question and nothing else.
    cur.execute(
        "INSERT INTO analysis_specs(id, project_id, analysis_type, method, "
        "research_question, content_hash, created_by) VALUES (%s, %s, "
        "'correlation', 'pearson_correlation', 'Does use track resistance?', "
        "%s, 'test')",
        (spec_id, project, f"sha256:{spec_id}"))
    run_id = new_id("arun")
    cur.execute(
        "INSERT INTO analysis_runs(id, project_id, spec_id, status, result) "
        "VALUES (%s, %s, %s, %s, COALESCE(%s::jsonb, '{}'::jsonb))",
        (run_id, project, spec_id, status, result))
    return run_id


def test_a_summary_is_produced_and_kept(cur, project, completed_run, monkeypatch):
    provider = _Provider(_summary())
    _use(monkeypatch, provider)

    first = interpret.summarise_run(cur, run_id=completed_run)
    assert first["headline"].startswith("Antibiotic use tracks")
    assert first["cached"] is False
    assert first["model"] == "test-model"

    # The same completed run always holds the same recorded numbers, so asking
    # again costs tokens for no new information.
    second = interpret.summarise_run(cur, run_id=completed_run)
    assert second["cached"] is True
    assert provider.calls == 1

    # Unless the caller says the prompt has moved on.
    interpret.summarise_run(cur, run_id=completed_run, refresh=True)
    assert provider.calls == 2


@pytest.mark.parametrize("field", [
    "headline", "what_it_means", "how_confident", "what_would_change_it"])
def test_a_summary_carrying_a_figure_is_refused(cur, project, completed_run,
                                                monkeypatch, field):
    """
    The check the whole thing rests on, and nothing had ever run it.

    A summary that says "r was 0.9" has reintroduced exactly the transcription
    risk that keeping figures out of prose removes: it can round, it can be
    restated, and it can drift from the value beside it as that value changes.
    """
    _use(monkeypatch, _Provider(_summary(**{field: "The correlation was 0.87."})))

    with pytest.raises(interpret.SummaryContainedNumbers) as refused:
        interpret.summarise_run(cur, run_id=completed_run)
    assert field in str(refused.value)

    # And nothing was stored: a refused summary must not be served later from
    # the cache as though it had passed.
    cur.execute("SELECT COUNT(*) n FROM plain_summaries WHERE analysis_run_id = %s",
                (completed_run,))
    assert cur.fetchone()["n"] == 0


def test_prose_that_merely_contains_a_digit_in_a_word_is_allowed(
        cur, project, completed_run, monkeypatch):
    """
    The rule is about figures, not characters. Refusing "COVID-19" or "Phase 3
    trials" would make the check unusable and train somebody to remove it.
    """
    _use(monkeypatch, _Provider(_summary(
        what_it_means="The pattern holds in COVID-19 era data as well.")))
    kept = interpret.summarise_run(cur, run_id=completed_run)
    assert "COVID-19" in kept["what_it_means"]


def test_an_unfinished_run_has_nothing_to_interpret(cur, project):
    run_id = _run(cur, project, "running")
    with pytest.raises(interpret.InterpretationError) as refused:
        interpret.summarise_run(cur, run_id=run_id)
    assert "completed" in str(refused.value)


def test_a_run_nobody_has_heard_of_is_refused_rather_than_summarised(cur):
    with pytest.raises(interpret.InterpretationError):
        interpret.summarise_run(cur, run_id="arun_nothing")


# ---------------------------------------------------------------------------
# The route the interface has been calling all along
# ---------------------------------------------------------------------------


@pytest.fixture()
def client():
    from fastapi.testclient import TestClient

    from throughline_api.app import app
    from throughline_domain.db import connection

    with TestClient(app) as test_client:
        yield test_client
    with connection() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM users WHERE email = %s", ("summary@lab.local",))


def test_the_route_exists_and_needs_a_session(client):
    """
    It answers 401 rather than falling through to the interface.

    That fall-through is the bug this route was added for: with no route
    registered, the request reached the catch-all that serves the interface and
    came back as a web page, which the client then parsed as JSON.
    """
    response = client.get("/api/analyses/arun_x/plain-summary")
    assert response.status_code == 401, response.text
    assert response.headers["content-type"].startswith("application/json")


def test_a_run_that_does_not_exist_is_not_found(client):
    status = client.get("/api/auth/status").json()
    endpoint = "/api/auth/setup" if status["needs_setup"] else "/api/auth/login"
    client.post(endpoint, json={"email": "summary@lab.local",
                                "display_name": "Summary",
                                "password": "correct-horse-battery"})
    assert client.get("/api/analyses/arun_nothing/plain-summary"
                      ).status_code == 404
