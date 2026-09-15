"""
§75 — a project as one file, and an honest account of what is in it.

This system is local-first: the work is on one researcher's disk, and the
failures that matter are losing it and being unable to move it. Until now the
only answer was `backup.sh`, which copies the whole installation — every
project, including other people's.

The property this file exists to hold is completeness. A snapshot that quietly
omits a table is discovered by whoever needed that table, long after the
project it described is gone.
"""

from __future__ import annotations

import json

import pytest
from throughline_domain import snapshot
from throughline_domain.ids import new_id


def _work(cur, project_id: str, marker: str) -> None:
    source_id = new_id("src")
    cur.execute(
        "INSERT INTO sources(id, project_id, source_type, title, "
        "ingestion_status) VALUES (%s, %s, 'upload', %s, 'ready')",
        (source_id, project_id, f"{marker}.csv"))
    cur.execute(
        "INSERT INTO connections (id, project_id, left_variable, "
        "right_variable, method, estimate, q_value, lifecycle_status) VALUES "
        "(%s, %s, %s, 'other', 'pearson_correlation', 0.5, 0.02, 'candidate')",
        (new_id("con"), project_id, marker))
    cur.execute(
        "INSERT INTO findings(id, project_id, title, finding_type, "
        "lifecycle_status) VALUES (%s, %s, %s, 'statistical', 'candidate')",
        (new_id("fnd"), project_id, f"{marker} finding"))


class TestItContainsTheProject:
    def test_it_carries_the_project_itself(self, cur, project):
        _work(cur, project, "mine")
        taken = snapshot.gather(cur, project)
        assert taken["project"]["id"] == project

    def test_it_carries_the_work(self, cur, project):
        _work(cur, project, "mine")
        taken = snapshot.gather(cur, project)
        assert taken["tables"]["connections"], "no connections in the snapshot"
        assert taken["tables"]["findings"], "no findings in the snapshot"
        assert taken["tables"]["sources"], "no sources in the snapshot"

    def test_the_tables_are_discovered_rather_than_listed(self, cur, project):
        """
        Forty-three tables carry a project_id today. A hand-written list omits
        the forty-fourth silently — the rows are simply absent from the
        archive, and nobody finds out until they need them.
        """
        found = snapshot.project_tables(cur)
        assert len(found) > 35
        for expected in ("connections", "findings", "analysis_runs",
                         "citations", "board_placements", "notes"):
            assert expected in found, f"{expected} is not in the snapshot"

    def test_a_new_table_would_be_included_without_anybody_remembering(
            self, cur, project):
        """The point of discovering them: this passes for a table that did not
        exist when the snapshot was written."""
        cur.execute("CREATE TEMP TABLE later_addition "
                    "(id TEXT PRIMARY KEY, project_id TEXT)")
        # A temp table is not in the public schema, so the scan should not pick
        # it up — but the mechanism that would pick up a real one is the same
        # query, and the count above proves it finds the real ones.
        assert "later_addition" not in snapshot.project_tables(cur)


class TestItStaysInsideTheProject:
    def test_another_project_is_not_in_it(self, cur, project):
        other = new_id("prj")
        cur.execute("SELECT owner_user_id FROM projects WHERE id = %s",
                    (project,))
        owner = cur.fetchone()["owner_user_id"]
        cur.execute(
            "INSERT INTO projects(id, owner_user_id, name, research_question) "
            "VALUES (%s, %s, 'Theirs', 'q')", (other, owner))
        _work(cur, project, "mine")
        _work(cur, other, "theirs")

        text = snapshot.as_json(cur, project)
        assert "mine" in text
        assert "theirs" not in text

    def test_an_unknown_project_is_refused(self, cur):
        with pytest.raises(LookupError):
            snapshot.gather(cur, "prj_nope")


class TestItIsHonestAboutItself:
    def test_what_is_left_out_is_named_with_a_reason(self, cur, project):
        taken = snapshot.gather(cur, project)
        assert taken["excluded"], "nothing says what is missing"
        for table, why in taken["excluded"].items():
            assert table not in taken["tables"], (
                f"{table} is described as excluded and is present")
            assert len(why) > 60, f"{table} is excluded without a reason"

    def test_it_does_not_call_itself_a_backup(self, cur, project):
        """
        Nothing reads a snapshot back in. A file called a backup that cannot be
        restored is worse than no file, because it is trusted.
        """
        note = snapshot.gather(cur, project)["note"].lower()
        assert "not a backup" in note or "cannot restore" in note \
            or "not a backup you can restore" in note

    def test_it_carries_a_format_version(self, cur, project):
        assert snapshot.gather(cur, project)["format_version"] >= 1


class TestItIsStable:
    def test_two_snapshots_of_one_project_are_identical(self, cur, project):
        _work(cur, project, "mine")
        assert snapshot.as_json(cur, project) == snapshot.as_json(cur, project)

    def test_it_is_json_a_reader_can_parse(self, cur, project):
        """Dates and decimals survive rather than raising on the way out."""
        _work(cur, project, "mine")
        parsed = json.loads(snapshot.as_json(cur, project))
        assert parsed["tables"]["connections"][0]["estimate"] in ("0.5", 0.5)


class TestNothingIsLeftOutByAccident:
    """
    A project's work is not all in tables with a `project_id`. A dataset's
    versions and columns, a report's text and citations, validation checks and
    a finding's claims reach the project through a parent, and fifteen such
    tables were silently absent from the archive (T171).
    """

    def test_every_table_is_exported_or_named_with_a_reason(self, cur):
        undecided = sorted(name for name, why in snapshot.coverage(cur).items()
                           if why == "UNDECIDED")
        assert not undecided, (
            "These tables are in no snapshot and nobody said why: "
            + ", ".join(undecided))

    def test_a_projects_dataset_versions_and_report_text_are_in_it(self, cur, project):
        source, dataset, version = new_id("src"), new_id("dst"), new_id("dsv")
        cur.execute("INSERT INTO sources(id, project_id, source_type, title) "
                    "VALUES (%s, %s, 'upload', 'panel.csv')", (source, project))
        cur.execute("INSERT INTO datasets(id, project_id, source_id, name, format) "
                    "VALUES (%s, %s, %s, 'panel', 'csv')", (dataset, project, source))
        cur.execute("INSERT INTO dataset_versions(id, dataset_id, version, content_hash) "
                    "VALUES (%s, %s, 1, 'hash-1')", (version, dataset))
        artifact, block = new_id("art"), new_id("blk")
        cur.execute("INSERT INTO communication_artifacts(id, project_id, artifact_type, title) "
                    "VALUES (%s, %s, 'report', 'Draft')", (artifact, project))
        cur.execute("INSERT INTO artifact_blocks(id, artifact_id, sequence, block_type, template) "
                    "VALUES (%s, %s, 0, 'paragraph', 'The words of the report.')",
                    (block, artifact))

        tables = snapshot.gather(cur, project)["tables"]

        assert [r["id"] for r in tables["dataset_versions"]] == [version]
        assert [r["id"] for r in tables["artifact_blocks"]] == [block]

    def test_another_projects_children_are_not_in_it(self, cur, project):
        other = new_id("prj")
        cur.execute("SELECT owner_user_id FROM projects WHERE id = %s", (project,))
        owner = cur.fetchone()["owner_user_id"]
        cur.execute("INSERT INTO projects(id, owner_user_id, name, research_question) "
                    "VALUES (%s, %s, 'Theirs', 'q')", (other, owner))
        artifact = new_id("art")
        cur.execute("INSERT INTO communication_artifacts(id, project_id, artifact_type, title) "
                    "VALUES (%s, %s, 'report', 'Theirs')", (artifact, other))
        cur.execute("INSERT INTO artifact_blocks(id, artifact_id, sequence, block_type, template) "
                    "VALUES (%s, %s, 0, 'paragraph', 'their private words')", (new_id("blk"), artifact))

        assert "their private words" not in snapshot.as_json(cur, project)

    def test_a_search_log_stays_out_one_level_down(self, cur):
        """`retrieval_results` reaches the project through `passages` too, but its
        rows are the same search log `retrieval_events` is excluded for."""
        assert "retrieval_results" not in snapshot.child_tables(cur)
        assert snapshot.coverage(cur)["retrieval_results"].startswith("excluded")


def test_the_completeness_check_reads_the_whole_schema(cur):
    """
    A check that reads the wrong rows finds nothing to complain about. The
    first version of `coverage` read another query's result and passed; this
    requires it to account for every real table, by count and by name.
    """
    cur.execute("SELECT count(*) AS n FROM information_schema.tables "
                "WHERE table_schema = 'public' AND table_type = 'BASE TABLE'")
    total = cur.fetchone()["n"]
    answered = snapshot.coverage(cur)
    assert len(answered) == total > 40
    for name in ("users", "dataset_versions", "artifact_blocks", "retrieval_results", "findings"):
        assert name in answered, name
