"""Local embedding provider.

Local-first means the semantic half of hybrid retrieval cannot depend on an API
key. `model2vec` static embeddings give real semantics from a ~30 MB local model
with no torch and no network at query time.

The provider is swappable. If no model is present, retrieval degrades to
lexical-only and *says so* in the strategy field rather than silently returning
worse results.
"""

from __future__ import annotations

import os
import threading
from pathlib import Path
from typing import Protocol, Sequence

from .db import data_root

DEFAULT_MODEL = os.environ.get("THROUGHLINE_EMBEDDING_MODEL", "potion-base-8M")
EMBEDDING_DIMENSION = 256  # must match the vector(256) column in migration 0002


class EmbeddingProvider(Protocol):
    name: str
    dimension: int

    def embed(self, texts: Sequence[str]) -> list[list[float]]: ...


class LocalStaticEmbeddings:
    """model2vec static embeddings, loaded once per process."""

    def __init__(self, model_path: Path) -> None:
        from model2vec import StaticModel

        self._model = StaticModel.from_pretrained(str(model_path))
        self.name = f"model2vec:{model_path.name}"
        self.dimension = int(self._model.dim)
        if self.dimension != EMBEDDING_DIMENSION:
            raise RuntimeError(
                f"Model {self.name} produces {self.dimension}-d vectors but the "
                f"passage_embeddings column is vector({EMBEDDING_DIMENSION}). "
                "Add a migration before changing models."
            )

    def embed(self, texts: Sequence[str]) -> list[list[float]]:
        if not texts:
            return []
        vectors = self._model.encode(list(texts))
        return [[float(x) for x in row] for row in vectors]


_lock = threading.Lock()
_provider: EmbeddingProvider | None = None
_resolved = False


def model_dir() -> Path:
    """Where the local embedding model lives.

    Deliberately *not* under THROUGHLINE_HOME: that directory is per-instance
    state (a test run overrides it to isolate its database), while a downloaded
    model is a shared machine-level asset. Tying them together would make every
    isolated instance silently lose semantic search.
    """
    override = os.environ.get("THROUGHLINE_MODEL_DIR")
    root = Path(override) if override else Path.home() / ".throughline-os" / "models"
    return root / DEFAULT_MODEL


def provider() -> EmbeddingProvider | None:
    """Return the embedding provider, or None when no local model is installed.

    None is a legitimate state, not an error: the system still retrieves
    lexically and reports ``strategy='lexical'`` so nobody mistakes a degraded
    search for a semantic one.
    """
    global _provider, _resolved
    with _lock:
        if _resolved:
            return _provider
        _resolved = True
        path = model_dir()
        if not path.exists():
            _provider = None
            return None
        try:
            _provider = LocalStaticEmbeddings(path)
        except Exception:
            _provider = None
        return _provider


def reset() -> None:
    """Force re-resolution — used by tests and after installing a model."""
    global _provider, _resolved
    with _lock:
        _provider = None
        _resolved = False


def is_available() -> bool:
    return provider() is not None
