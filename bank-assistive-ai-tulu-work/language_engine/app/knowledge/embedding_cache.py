"""Content-addressed embedding cache (domain integration, Phase 3).

KnowledgeRetriever encodes every article and section when it is built. For the
fifteen Banking articles that is quick, so Banking keeps doing exactly that.
A College collection grows with every official document an institution
supplies, and re-encoding all of them on every start-up is wasted work.

HOW IT WORKS

  - A vector is stored under the SHA-256 of the exact text it was computed
    from. A document whose text is unchanged is never re-encoded; an edited
    document gets new keys and only it is encoded again. That is incremental
    ingestion without any bookkeeping of "what changed".
  - One cache file per collection (domain + institution). Once a collection
    is fully built, prune() drops vectors for text it no longer contains, so
    edited or removed documents leave nothing stale behind.
  - The file records the encoder's name. A cache written by a different model
    is ignored, never mixed in -- vectors from two models are not comparable.

The cache holds embeddings of knowledge-base text only: never a user's
question, never anything personal. It lives in a git-ignored directory
(`.cache/embeddings` under language_engine/ unless KNOWLEDGE_CACHE_DIR says
otherwise) and can be deleted at any time; it is rebuilt on demand.
"""

from __future__ import annotations

import hashlib
import os
import re
import threading
from pathlib import Path
from typing import Optional, Sequence

import numpy as np

#: language_engine/.cache/embeddings
DEFAULT_CACHE_DIR = Path(__file__).resolve().parents[2] / ".cache" / "embeddings"

_SAFE_NAME = re.compile(r"[^a-z0-9_.-]+")


def cache_dir_from_env() -> Path:
    configured = os.getenv("KNOWLEDGE_CACHE_DIR", "").strip()
    return Path(configured) if configured else DEFAULT_CACHE_DIR


def text_key(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


class EmbeddingCache:
    """
    Encodes texts through `model`, reusing vectors already computed.

    `encode(texts)` returns normalised vectors in the order given -- the same
    thing `model.encode(texts, normalize_embeddings=True)` returns -- so it
    can stand in for that call.
    """

    def __init__(self, model, model_name: str, collection: str, directory: Optional[Path] = None) -> None:
        self.model = model
        self.model_name = model_name
        self.path = Path(directory or cache_dir_from_env()) / f"{_SAFE_NAME.sub('_', collection.lower())}.npz"
        self._lock = threading.Lock()
        #: Texts encoded by the model (not served from the cache) in the
        #: last encode() call. For ingestion reports and tests.
        self.last_encoded = 0
        self.last_reused = 0
        #: Totals across every encode() call on this object.
        self.total_encoded = 0
        self.total_reused = 0
        self._seen: set = set()

    def _read(self) -> dict:
        if not self.path.exists():
            return {}

        try:
            with np.load(self.path, allow_pickle=False) as data:
                if str(data["model"]) != self.model_name:
                    return {}
                return dict(zip((str(k) for k in data["keys"]), data["vectors"]))
        except Exception:
            # A damaged cache is only a slower start, never a failure.
            return {}

    def _write(self, vectors: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        keys = sorted(vectors)
        matrix = np.stack([vectors[k] for k in keys]) if keys else np.zeros((0, 0), dtype=np.float32)
        temporary = self.path.with_suffix(".tmp.npz")
        np.savez(temporary, model=np.array(self.model_name), keys=np.array(keys), vectors=matrix)
        os.replace(temporary, self.path)

    def encode(self, texts: Sequence[str]) -> np.ndarray:
        """Vectors for `texts`; only texts not already cached reach the model."""
        with self._lock:
            stored = self._read()
            keys = [text_key(text) for text in texts]

            missing = sorted({k: t for k, t in zip(keys, texts) if k not in stored}.items())
            if missing:
                fresh = self.model.encode([t for _, t in missing], normalize_embeddings=True)
                for (key, _), vector in zip(missing, fresh):
                    stored[key] = np.asarray(vector, dtype=np.float32)
                self._write(stored)

            self.last_encoded = len(missing)
            self.last_reused = len(set(keys)) - len(missing)
            self.total_encoded += self.last_encoded
            self.total_reused += self.last_reused
            self._seen.update(keys)

            if not texts:
                return np.zeros((0, 0), dtype=np.float32)

            return np.stack([stored[k] for k in keys])

    def prune(self) -> int:
        """
        Drops every vector not requested since this cache object was made.

        Called once a collection is fully built, so edited or removed
        documents do not leave stale vectors behind. Returns how many went.
        """
        with self._lock:
            stored = self._read()
            kept = {k: v for k, v in stored.items() if k in self._seen}
            removed = len(stored) - len(kept)
            if removed:
                self._write(kept)
            return removed

