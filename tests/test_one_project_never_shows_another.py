"""
Reading one project never returns another project's rows.

`test_routes_are_scoped` proves every route checks who owns the project it was
asked for; `test_project_isolation` proves a second account is refused. Both
guard the route. Neither would catch a *domain query* that forgot its project
filter: the route confirms you own the project you asked about, the query
returns everybody's rows, and the check passes on the way to the leak.

Not a hypothetical failure mode — I made it myself. Reading the worked example
through a query with no project filter, I found two connections for one
variable pair with opposite signs, reported it as a contradiction the screen
was hiding, and shipped a change justified by it. The rows were in two
different projects. The reading was mine, not the product's, but the shape is
exactly what this guards.

Scanning for the missing clause does not work: five of the six candidates a
source scan produced were queries that build `WHERE` as a variable, which no
regex sees, and the sixth was a concatenated literal split across lines. So
this asks the questions instead, with two projects that both have work in
them, and checks that each answer contains only its own.
"""

from __future__ import annotations

import pytest
from throughline_domain import analysis, discovery, graphs, tables
from throughline_domain.ids import new_id


def _project(cur, owner: str, name: str) -> str:
    project_id = new_id("prj")
    cur.execute(
        "INSERT INTO projects(id, owner_user_id, name, research_question) "
        "VALUES (%s, %s, %s, 'does it leak?')", (project_id, owner, name))
    return project_id


def _work_in(cur, project_id: str, marker: str) -> None:
    """A dataset, a run and a connection, all findable by `marker`."""
    source_id, dataset_id, version_id = (new_id("src"), new_id("dst"),
                                         new_id("dsv"))
    cur.execute(
        "INSERT INTO sources(id, project_id, source_type, title, "
        "ingestion_status) VALUES (%s, %s, 'upload', %s, 'ready')",
        (source_id, project_id, f"{marker}.csv"))
    cur.execute(
        "INSERT INTO datasets(id, project_id, source_id, name, format) "
        "VALUES (%s, %s, %s, %s, 'csv')",
        (dataset_id, project_id, source_id, f"{marker}.csv"))
    cur.execute(
        "INSERT INTO dataset_versions(id, dataset_id, version, row_count, "
        "column_count, content_hash) VALUES (%s, %s, 1, 100, 3, %s)",
        (version_id, dataset_id, new_id("hash")))

    spec_id = new_id("aspec")
    cur.execute(
        "INSERT INTO analysis_specs(id, project_id, analysis_type, method, "
        "variables, research_question, content_hash, created_by) VALUES "
        "(%s, %s, 'confirmatory', 'pearson_correlation', %s, %s, %s, 'r')",
        (spec_id, project_id, {"x": marker, "y": "other"},
         f"Question about {marker}?", new_id("hash")))
    run_id = analysis.create_run(cur, project_id=project_id, spec_id=spec_id)

    discovery_id = new_id("drun")
    cur.execute(
        "INSERT INTO discovery_runs(id, project_id, dataset_version_id, "
        "status) VALUES (%s, %s, %s, 'complete')",
        (discovery_id, project_id, version_id))
    cur.execute(
        "INSERT INTO connections (id, project_id, discovery_run_id, "
        "analysis_run_id, left_variable, right_variable, method, estimate, "
        "p_value, q_value, sample_size, lifecycle_status) VALUES (%s, %s, %s, "
        "%s, %s, 'other', 'pearson_correlation', 0.5, 0.01, 0.02, 100, "
        "'candidate')",
        (new_id("con"), project_id, discovery_id, run_id, marker))


@pytest.fixture()
def two_projects(cur):
    """
    Two projects with identical shapes and distinguishable contents.

    The owner is created here rather than borrowed from an existing row: the
    cursor fixture rolls back, so there is no user to find, and the first
    version of this skipped every case — a test that always skips is worse
    than none, because the run is green and nothing was asked.
    """
    owner = new_id("usr")
    cur.execute(
        "INSERT INTO users(id, email, display_name, password_hash, "
        "password_salt) VALUES (%s, %s, 'Leak Test', 'x', 'y')",
        (owner, f"{owner}@test.local"))
    mine = _project(cur, owner, "Mine")
    theirs = _project(cur, owner, "Theirs")
    _work_in(cur, mine, "mine_variable")
    _work_in(cur, theirs, "their_variable")
    return mine, theirs


class TestTheListingsStayInTheirProject:
    def test_connections(self, cur, two_projects):
        mine, _ = two_projects
        rows = discovery.list_connections(cur, project_id=mine, limit=100)
        assert rows, "the fixture put nothing in this project"
        assert all(r["left_variable"] == "mine_variable" for r in rows)

    def test_analysis_runs(self, cur, two_projects):
        mine, _ = two_projects
        rows = analysis.list_runs(cur, mine, limit=100)
        assert rows
        assert all("their_variable" not in str(r.get("research_question", ""))
                   for r in rows)

    def test_the_discovery_map_counts_one_project(self, cur, two_projects):
        mine, _ = two_projects
        counts = graphs.discovery_map(cur, project_id=mine)["counts"]
        assert counts["datasets"] == 1, (
            f"the map counted {counts['datasets']} datasets for a project "
            f"with one")

    def test_the_exported_results_table(self, cur, two_projects):
        """
        The one that would travel. A CSV pasted into a paper carrying another
        project's rows is the worst version of this failure.
        """
        mine, _ = two_projects
        text = tables.connections_csv(cur, mine)
        assert "mine_variable" in text
        assert "their_variable" not in text


class TestTheOtherProjectIsStillThere:
    def test_reading_one_does_not_hide_the_other(self, cur, two_projects):
        """
        The opposite mistake: a filter so tight it returns nothing. Both
        projects answer for themselves.
        """
        import csv
        import io

        mine, theirs = two_projects
        assert discovery.list_connections(cur, project_id=theirs, limit=100)
        # Rows, not substrings: the fixture names the dataset after the marker
        # too, so counting occurrences of the word counts the filename as well.
        rows = list(csv.DictReader(
            io.StringIO(tables.connections_csv(cur, theirs))))
        assert len(rows) == 1
        assert rows[0]["Variable A"] == "their_variable"
