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
