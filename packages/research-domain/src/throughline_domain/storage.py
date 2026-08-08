"""Content-addressed object storage (§12).

Files are stored under the SHA-256 of their bytes and never modified. Two
consequences matter:

* Re-uploading the same document is free and cannot produce a second, divergent
  copy that evidence might point at.
* A stored file can always be re-verified against the hash a finding cited.

The local backend writes to a directory. The interface is deliberately the
subset that maps onto S3 (`put`/`open`/`exists`), so a hosted deployment swaps
the backend without touching callers.
"""

from __future__ import annotations

import hashlib
import os
import shutil
from pathlib import Path
from typing import BinaryIO, Iterator

from .db import data_root
from .ids import new_id

CHUNK = 1024 * 1024


class StorageError(RuntimeError):
    pass


def storage_root() -> Path:
    root = Path(os.environ.get("THROUGHLINE_STORAGE", data_root() / "objects"))
    root.mkdir(parents=True, exist_ok=True)
    return root


def _key_for(content_hash: str) -> str:
    # Two levels of fan-out keeps directory listings usable at scale.
    return f"{content_hash[:2]}/{content_hash[2:4]}/{content_hash}"


def hash_stream(stream: BinaryIO) -> tuple[str, int]:
    digest = hashlib.sha256()
    size = 0
    for block in iter(lambda: stream.read(CHUNK), b""):
        digest.update(block)
        size += len(block)
    return digest.hexdigest(), size


def put(stream: BinaryIO) -> tuple[str, str, int]:
    """Store bytes. Returns (content_hash, storage_key, size_bytes).

    Writes to a temporary path and renames, so an interrupted write can never
    leave a truncated file sitting at a hash that claims to be complete.
    """
    stream.seek(0)
    content_hash, size = hash_stream(stream)
    key = _key_for(content_hash)
    destination = storage_root() / key
    if destination.exists():
        return content_hash, key, size

    destination.parent.mkdir(parents=True, exist_ok=True)
    staging = destination.with_suffix(f".{new_id('tmp')}.part")
    stream.seek(0)
    with staging.open("wb") as handle:
        shutil.copyfileobj(stream, handle, CHUNK)
    staging.replace(destination)
    return content_hash, key, size


def path_for(storage_key: str) -> Path:
    path = storage_root() / storage_key
    # Refuse to resolve outside the store even if a key was tampered with.
    if not path.resolve().is_relative_to(storage_root().resolve()):
        raise StorageError("Storage key escapes the object store")
    if not path.exists():
        raise StorageError(f"Missing object: {storage_key}")
    return path


def verify(storage_key: str, expected_hash: str) -> bool:
    """Re-check stored bytes against the hash a finding cited."""
    with path_for(storage_key).open("rb") as handle:
        actual, _ = hash_stream(handle)
    return hmac_equal(actual, expected_hash)


def hmac_equal(left: str, right: str) -> bool:
    import hmac as _hmac

    return _hmac.compare_digest(left, right)


def register_file(
    cur, *, project_id: str, filename: str, stream: BinaryIO, media_type: str
) -> dict[str, str | int]:
    """Store bytes and record the immutable file row.

    Deduplicated per project: the same content uploaded twice returns the
    original row rather than creating a divergent second artifact.
    """
    content_hash, key, size = put(stream)
    cur.execute(
        "SELECT id, content_hash, storage_key, size_bytes FROM files "
        "WHERE project_id = %s AND content_hash = %s",
        (project_id, content_hash),
    )
    existing = cur.fetchone()
    if existing:
        return dict(existing) | {"deduplicated": True}

    file_id = new_id("fil")
    cur.execute(
        "INSERT INTO files(id, project_id, content_hash, filename, media_type, "
        "size_bytes, storage_key) VALUES (%s, %s, %s, %s, %s, %s, %s)",
        (file_id, project_id, content_hash, filename, media_type, size, key),
    )
    return {
        "id": file_id,
        "content_hash": content_hash,
        "storage_key": key,
        "size_bytes": size,
        "deduplicated": False,
    }
