"""
Communication artifacts.

The whole design turns on one decision: **a block never stores a number.**

A paragraph stores a template — "the association is r = {{ref:r}} at q =
{{ref:q}}" — plus a map of references, each naming an analysis run and a path
into its recorded result. Rendering resolves them. Nothing writes a literal
statistic into a document, so the number on the page is not a copy of the
computed value that might have drifted; it *is* the computed value, read at
render time.

That converts numerical fidelity from something to be audited into something
that cannot fail. It also gives  invalidation for free: re-run the analysis
and the document either shows the new number or refuses to render, depending on
whether the reference still resolves. There is no third state where it displays
the old one.

The cost is that authoring is stricter — you cannot type a result into a
sentence. That is the point. this rule says an LLM may explain a number and may not
produce one, and the only way to enforce that against a text generator is to
give it no field in which a number would be believed.
"""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any

from . import citations as citations_mod
from .db import jsonb
from .ids import new_id

# {{ref:name}} — the only way a value enters rendered text.
REF = re.compile(r"\{\{ref:([A-Za-z0-9_.]+)\}\}")


class CommunicationError(RuntimeError):
    """An artifact could not be built or rendered."""


class UnresolvedReference(CommunicationError):
    """A block references a value that cannot be read back."""


class LiteralNumberRejected(CommunicationError):
    """A template tried to hard-code a statistic."""


# ---------------------------------------------------------------------------
# Authoring
# ---------------------------------------------------------------------------

def create_artifact(
    cur,
    *,
    project_id: str,
    artifact_type: str,
    title: str,
    audience: str = "researcher",
    purpose: str = "",
    finding_ids: list[str] | None = None,
) -> str:
    """Create an artifact and bind it to the findings it communicates."""
    artifact_id = new_id("art")
    cur.execute(
        "INSERT INTO communication_artifacts(id, project_id, artifact_type, title, "
        "audience, purpose) VALUES (%s, %s, %s, %s, %s, %s)",
        (artifact_id, project_id, artifact_type, title, audience, purpose),
    )
    for finding_id in finding_ids or []:
        cur.execute("SELECT project_id FROM findings WHERE id = %s", (finding_id,))
        row = cur.fetchone()
        if not row:
            raise CommunicationError(f"No such finding: {finding_id}")
        if row["project_id"] != project_id:
            raise CommunicationError("That finding belongs to a different project.")
        cur.execute(
            "INSERT INTO artifact_findings(artifact_id, finding_id) VALUES (%s, %s) "
            "ON CONFLICT DO NOTHING",
            (artifact_id, finding_id),
        )
    return artifact_id


# Statistics that must never be typed. Ordinary prose numbers — "three studies",
# "2019", "Figure 1" — are fine and common, so a blanket ban on digits would make
# the system unusable. What is refused is a digit sitting where a *result* goes.
_LITERAL_STAT = re.compile(
    r"""(?ix)
    \b(?:
        [pqr]\s*[=<>]\s*-?[\d.]                 # p = .03, q < 0.05, r = 0.9
      | rho\s*[=<>]\s*-?[\d.]
      | n\s*=\s*\d                              # n = 180
      | (?:beta|coefficient|estimate|effect|OR|RR|HR)\s*[=:]\s*-?[\d.]
      | \d+(?:\.\d+)?\s*%                       # 31.2%
      | 95\s*%?\s*CI
      | -?\d+\.\d{2,}                           # a precise decimal, i.e. a result
      | \d+(?:\.\d+)?[eE][-+]?\d+               # 5.17e-66
    )
    """,
)


def add_block(
    cur,
    *,
    artifact_id: str,
    sequence: int,
    block_type: str,
    template: str = "",
    value_refs: dict[str, dict[str, Any]] | None = None,
    visual_id: str | None = None,
    notes: str = "",
    citation_ids: list[str] | None = None,
) -> str:
    """
    Add a block, refusing any template that states a statistic directly.

    The refusal is the mechanism, not a lint. Once a number can only arrive
    through `value_refs`, "does the displayed number equal the computed output"
    stops being a question — there is no other place it could have come from.
    """
    stray = _LITERAL_STAT.search(REF.sub("", template))
    if stray:
        raise LiteralNumberRejected(
            f"This template states a result directly: {stray.group(0)!r}. "
            "Statistics must be written as {{ref:name}} and resolved from a recorded "
            "analysis run, so that the page cannot disagree with the computation "
            "."
        )

    refs = value_refs or {}
    named = set(REF.findall(template))
    missing = named - set(refs)
    if missing:
        raise UnresolvedReference(
            f"Template references {sorted(missing)}, which are not in value_refs."
        )
    unused = set(refs) - named
    if unused:
        # Not fatal, but it means the author believes a number is on the page
        # when it is not — worth refusing rather than silently dropping.
        raise CommunicationError(
            f"value_refs defines {sorted(unused)}, which the template never uses."
        )

    block_id = new_id("blk")
    cur.execute(
        "INSERT INTO artifact_blocks(id, artifact_id, sequence, block_type, template, "
        "value_refs, visual_id, notes) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
        (block_id, artifact_id, sequence, block_type, template, jsonb(refs),
         visual_id, notes),
    )
    for citation_id in citation_ids or []:
        cur.execute(
            "INSERT INTO block_citations(block_id, citation_id) VALUES (%s, %s) "
            "ON CONFLICT DO NOTHING",
            (block_id, citation_id),
        )
    _touch(cur, artifact_id)
    return block_id


def _touch(cur, artifact_id: str) -> None:
    cur.execute(
        "UPDATE communication_artifacts SET updated_at = now(), version = version + 1 "
        "WHERE id = %s",
        (artifact_id,),
    )


# ---------------------------------------------------------------------------
# Resolution
# ---------------------------------------------------------------------------

def _dig(value: Any, path: str) -> Any:
    """Walk a dotted path into a stored result, with list indices allowed."""
    node = value
    for part in path.split("."):
        if node is None:
            return None
        if isinstance(node, dict):
            node = node.get(part)
        elif isinstance(node, (list, tuple)):
            try:
                node = node[int(part)]
            except (ValueError, IndexError):
                return None
        else:
            return None
    return node


def _present(value: Any, fmt: str) -> str:
    """
    Format a resolved value for display.

    Formatting is presentation, never alteration: `sig` chooses how many digits
    to show, and no option rounds a value to something it is not, or replaces a
    null with a plausible number. A missing value is caught before this by
    `resolve_block`.
    """
    if isinstance(value, bool):
        return "yes" if value else "no"
    if isinstance(value, (int,)) and not isinstance(value, bool):
        return f"{value:,}"
    if isinstance(value, float):
        if fmt == "exp":
            return f"{value:.2e}"
        if fmt == "int":
            return f"{round(value):,}"
        if fmt.startswith("dp"):
            return f"{value:.{int(fmt[2:])}f}"
        # Very small or very large values are unreadable in fixed notation, and
        # a q-value is exactly where that matters.
        if value != 0 and (abs(value) < 1e-3 or abs(value) >= 1e6):
            return f"{value:.2e}"
        return f"{value:.4g}"
    return str(value)


def resolve_block(cur, block: dict[str, Any]) -> dict[str, Any]:
    """
    Substitute a block's references with values read from recorded runs.

    Raises on anything it cannot resolve. A renderer must never be handed a
    partially-resolved block, because the failure mode of doing so is a document
    that looks finished and contains a blank where a p-value belongs.
    """
    refs: dict[str, dict[str, Any]] = block.get("value_refs") or {}
    resolved: dict[str, Any] = {}
    provenance: list[dict[str, str]] = []

    for name, ref in refs.items():
        run_id = ref.get("analysis_run_id")
        path = ref.get("path", "")
        if not run_id or not path:
            raise UnresolvedReference(
                f"Reference {name!r} must name both an analysis_run_id and a path."
            )

        cur.execute("SELECT id, status, result FROM analysis_runs WHERE id = %s", (run_id,))
        run = cur.fetchone()
        if not run:
            raise UnresolvedReference(
                f"Reference {name!r} points at analysis run {run_id}, which does not exist."
            )
        if run["status"] != "completed":
            raise UnresolvedReference(
                f"Reference {name!r} points at analysis run {run_id}, which is "
                f"{run['status']}. A number may only be shown once it has been computed."
            )

        value = _dig(run["result"], path)
        if value is None:
            raise UnresolvedReference(
                f"Reference {name!r} resolves to nothing: {run_id} has no value at "
                f"{path!r}. Rendering stops rather than printing a blank where a "
                "result belongs."
            )

        resolved[name] = value
        provenance.append({"name": name, "analysis_run_id": run_id, "path": path})

    text = REF.sub(
        lambda m: _present(resolved[m.group(1)], refs[m.group(1)].get("format", "auto")),
        block.get("template", ""),
    )

    return {
        **block,
        "text": text,
        "resolved": resolved,
        "value_provenance": provenance,
        "citations": citations_mod.for_block(cur, block["id"]),
    }


def load_artifact(cur, artifact_id: str, *, resolve: bool = True) -> dict[str, Any]:
    """The artifact with its blocks, resolved unless the caller is editing."""
    cur.execute("SELECT * FROM communication_artifacts WHERE id = %s", (artifact_id,))
    artifact = cur.fetchone()
    if not artifact:
        raise CommunicationError(f"No such artifact: {artifact_id}")

    cur.execute(
        "SELECT * FROM artifact_blocks WHERE artifact_id = %s ORDER BY sequence",
        (artifact_id,),
    )
    blocks = list(cur.fetchall())
    artifact["blocks"] = [resolve_block(cur, b) for b in blocks] if resolve else blocks

    cur.execute(
        "SELECT f.id, f.title, f.lifecycle_status, f.statement FROM artifact_findings af "
        "JOIN findings f ON f.id = af.finding_id WHERE af.artifact_id = %s",
        (artifact_id,),
    )
    artifact["findings"] = list(cur.fetchall())
    return artifact


def resolved_hash(artifact: dict[str, Any]) -> str:
    """
    A hash of every resolved value in the artifact.

    Comparing this against a stored render's hash answers "is this document
    still showing what the analyses currently say" exactly, rather than by
    timestamp heuristics.
    """
    payload = [
        {"block": b["id"], "resolved": b.get("resolved", {})}
        for b in artifact.get("blocks", [])
    ]
    encoded = json.dumps(payload, sort_keys=True, default=str).encode()
    return hashlib.sha256(encoded).hexdigest()


# ---------------------------------------------------------------------------
# Integrity
# ---------------------------------------------------------------------------

def check_integrity(cur, artifact_id: str) -> dict[str, Any]:
    """
    Everything that must hold before an artifact may be published.

    Returns `publishable` only when nothing is broken. The three failure kinds
    are kept apart because they are different problems: an unresolved value is a
    correctness failure, a dangling citation is a provenance failure, and an
    unchecked entailment is an honest gap rather than either.
    """
    problems: list[dict[str, str]] = []
    warnings: list[dict[str, str]] = []

    cur.execute(
        "SELECT * FROM artifact_blocks WHERE artifact_id = %s ORDER BY sequence",
        (artifact_id,),
    )
    blocks = list(cur.fetchall())

    resolved_blocks: list[dict[str, Any]] = []
    for block in blocks:
        try:
            resolved_blocks.append(resolve_block(cur, block))
        except (UnresolvedReference, citations_mod.DanglingCitation) as exc:
            problems.append({
                "block_id": block["id"],
                "kind": "unresolved_value" if isinstance(exc, UnresolvedReference)
                        else "dangling_citation",
                "detail": str(exc),
            })

    # Every block carrying a number must say where it came from.
    for block in resolved_blocks:
        if block["resolved"] and not block["citations"]:
            warnings.append({
                "block_id": block["id"],
                "kind": "uncited_statistic",
                "detail": ("This block states a computed value with no citation "
                           "attached. The value is traceable through its reference, "
                           "but the reader is not shown the source."),
            })
        for citation in block["citations"]:
            if citation["entailment"] == citations_mod.UNSUPPORTED:
                problems.append({
                    "block_id": block["id"],
                    "kind": "unsupported_citation",
                    "detail": f"{citation['id']}: {citation['entailment_detail']}",
                })
            elif citation["entailment"] in (citations_mod.UNVERIFIED,
                                            citations_mod.NOT_CHECKABLE):
                warnings.append({
                    "block_id": block["id"],
                    "kind": "unverified_citation",
                    "detail": (f"{citation['id']} is {citation['entailment']}. "
                               "It resolves to a real source, but whether that source "
                               "supports the sentence has not been established."),
                })

    #  — an artifact should not present a candidate as a result.
    cur.execute(
        "SELECT f.id, f.title, f.lifecycle_status FROM artifact_findings af "
        "JOIN findings f ON f.id = af.finding_id WHERE af.artifact_id = %s",
        (artifact_id,),
    )
    for finding in cur.fetchall():
        if finding["lifecycle_status"] in ("candidate", "exploratory"):
            warnings.append({
                "block_id": "",
                "kind": "premature_finding",
                "detail": (f"{finding['title']!r} is {finding['lifecycle_status']}. "
                           "Communicating it is legitimate if the artifact says so, "
                           "but it is not a validated result."),
            })

    return {
        "artifact_id": artifact_id,
        "publishable": not problems,
        "problems": problems,
        "warnings": warnings,
        "blocks_checked": len(blocks),
    }


__all__ = [
    "CommunicationError", "LiteralNumberRejected", "UnresolvedReference",
    "add_block", "check_integrity", "create_artifact", "load_artifact",
    "resolve_block", "resolved_hash",
]
