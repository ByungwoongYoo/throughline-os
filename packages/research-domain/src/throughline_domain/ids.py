"""Prefixed identifiers. The prefix makes a stray id readable in a log or a URL."""

from __future__ import annotations

import uuid


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:20]}"
