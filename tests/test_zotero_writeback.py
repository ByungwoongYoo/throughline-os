"""
Writing into somebody's reference library.

Reading a library is safe. Writing to one is not, and the asymmetry is the point:
a Zotero library is often a decade of somebody's accumulated reading, it is not
version-controlled, and there is no undo in this direction. Every test here is
about a way this could damage that rather than about whether a note arrives.

Four properties, each corresponding to a way real tools have ruined libraries:

  Only notes this system wrote are ever modified. A note without our marker is
  the researcher's, and stays untouched even when it looks like a stale copy of
  ours.

  Writing the same finding twice updates rather than duplicates, or every
  re-export leaves another near-identical note behind.

  A note edited in Zotero since we read it stops the write. Overwriting somebody
  is the one outcome that cannot be undone from here.

  A rejected write is never reported as a success. Zotero answers 200 and puts
  per-item failures in the body, so a status-code check alone tells a researcher
  their finding is filed when it is not.

Nothing here touches the network: the transport is replaced, and what is under
test is the decision logic on top of it.
"""

from __future__ import annotations

import pytest
from throughline_connectors.base import ConnectorError
from throughline_connectors.more_sources import Zotero

HTML = "<p>Resistance rose with consumption.</p>"


class FakeZotero(Zotero):
    """Zotero with the transport replaced and every call recorded."""

    def __init__(self, notes: list[dict] | None = None, **kwargs) -> None:
        super().__init__(api_key="key", library="9999", **kwargs)
        self._notes = notes or []
        self.sent: list[dict] = []
        self.response: tuple[int, object] = (200, {"successful": {"0": {}}})

    def child_notes(self, item_key: str) -> list[dict]:
        return self._notes

    def _send(self, url, *, method, payload, headers=None):
        self.sent.append({"url": url, "method": method, "payload": payload,
                          "headers": headers or {}})
        return self.response


def ours(finding_id: str, body: str = HTML, *, key: str = "NOTE1",
         version: int = 7) -> dict:
    marker = Zotero.MARKER.format(finding_id=finding_id)
    return {"version": version,
            "data": {"key": key, "itemType": "note", "note": f"{marker}\n{body}"}}


def theirs(body: str = "<p>My own reading notes.</p>") -> dict:
    return {"version": 3, "data": {"key": "MINE", "itemType": "note", "note": body}}


# ---------------------------------------------------------------------------
# Never touch what the researcher wrote
# ---------------------------------------------------------------------------

def test_a_researchers_own_note_is_never_modified():
    zotero = FakeZotero(notes=[theirs()])
    zotero.push_note(item_key="ITEM", finding_id="fnd_1", html=HTML)

    assert len(zotero.sent) == 1
    assert zotero.sent[0]["method"] == "POST"          # created alongside
    assert "MINE" not in zotero.sent[0]["url"]         # never addressed theirs


def test_a_note_that_merely_looks_like_ours_is_left_alone():
    """
    Same text, no marker — perhaps pasted by hand from an earlier export. It is
    the researcher's copy now, and matching on content rather than on the marker
    is how a tool starts editing things nobody asked it to.
    """
    zotero = FakeZotero(notes=[theirs(HTML)])
    result = zotero.push_note(item_key="ITEM", finding_id="fnd_1", html=HTML)
    assert result["action"] == "created"


# ---------------------------------------------------------------------------
# Same finding twice is one note
# ---------------------------------------------------------------------------

def test_writing_the_same_finding_twice_updates_in_place():
    zotero = FakeZotero(notes=[ours("fnd_1")])
    zotero.response = (204, None)

    result = zotero.push_note(item_key="ITEM", finding_id="fnd_1",
                              html="<p>Revised.</p>")

    assert result["action"] == "updated"
    assert zotero.sent[0]["method"] == "PATCH"
    assert "NOTE1" in zotero.sent[0]["url"]


def test_a_different_finding_gets_its_own_note():
    zotero = FakeZotero(notes=[ours("fnd_1")])
    result = zotero.push_note(item_key="ITEM", finding_id="fnd_2", html=HTML)
    assert result["action"] == "created"


def test_the_marker_is_invisible_in_a_zotero_client():
    """
    An HTML comment. A marker the researcher can see is one they eventually
    delete, and deleting it silently turns every future write into a duplicate.
    """
    zotero = FakeZotero()
    zotero.push_note(item_key="ITEM", finding_id="fnd_1", html=HTML)
    written = zotero.sent[0]["payload"][0]["note"]
    assert written.startswith("<!--")
    assert "throughline:finding:fnd_1" in written


# ---------------------------------------------------------------------------
# Somebody else edited it first
# ---------------------------------------------------------------------------

def test_a_conflicting_edit_refuses_rather_than_overwrites():
    zotero = FakeZotero(notes=[ours("fnd_1")])
    zotero.response = (412, None)

    with pytest.raises(ConnectorError, match="left alone"):
        zotero.push_note(item_key="ITEM", finding_id="fnd_1", html=HTML)


def test_the_update_carries_the_version_it_read():
    """Without it Zotero has no way to detect the conflict at all."""
    zotero = FakeZotero(notes=[ours("fnd_1", version=42)])
    zotero.response = (204, None)
    zotero.push_note(item_key="ITEM", finding_id="fnd_1", html=HTML)
    assert zotero.sent[0]["headers"]["If-Unmodified-Since-Version"] == "42"


# ---------------------------------------------------------------------------
# A refusal is not a success
# ---------------------------------------------------------------------------

def test_a_rejected_write_inside_a_200_is_reported_as_a_failure():
    """
    Zotero answers 200 and reports per-item outcomes in the body. Checking only
    the status tells the researcher their finding is filed when it is not.
    """
    zotero = FakeZotero()
    zotero.response = (200, {"successful": {},
                             "failed": {"0": {"message": "Invalid parent item"}}})

    with pytest.raises(ConnectorError, match="Invalid parent item"):
        zotero.push_note(item_key="ITEM", finding_id="fnd_1", html=HTML)


def test_unchanged_counts_as_written():
    """The server already holds exactly this — the right outcome, not an error."""
    zotero = FakeZotero()
    zotero.response = (200, {"unchanged": {"0": "ABCD"}, "failed": {}})
    assert zotero.push_note(item_key="ITEM", finding_id="fnd_1",
                            html=HTML)["action"] == "created"


def test_a_read_only_key_is_refused_before_anything_is_sent():
    zotero = Zotero(api_key="", library="9999")
    with pytest.raises(ConnectorError, match="write access"):
        zotero.push_note(item_key="ITEM", finding_id="fnd_1", html=HTML)


# ---------------------------------------------------------------------------
# The transport itself
# ---------------------------------------------------------------------------

def test_writes_do_not_inherit_the_retry_that_reads_have():
    """
    `_get` retries timeouts because fetching twice is free. A write that times
    out may already have been committed, and retrying it puts a second copy in
    the library — so the failure says the outcome is unknown instead.
    """
    import inspect
    from throughline_connectors.base import Connector

    source = inspect.getsource(Connector._send)
    assert "not known whether it took effect" in source
    assert "for attempt in range" not in source


def test_capability_says_it_writes_and_what_it_will_not_touch():
    capability = Zotero(api_key="k", library="1").capability()
    assert capability["writes"] is True
    assert "your own notes are never touched" in capability["note"].lower()
