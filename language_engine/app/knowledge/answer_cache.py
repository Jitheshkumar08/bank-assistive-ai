"""A small cache of LLM answers for repeated, non-personal questions.

WHAT MAKES A CACHED ANSWER SAFE

The key is a hash of everything that determines the answer: the model, the
full system message and prompt (which contain the question, the session
language, the workflow context, the current step and the evidence) and the
knowledge version. The answer call uses temperature 0. So a hit is
returned only for a byte-identical request against the same knowledge --
the cached answer is the answer that request would get.

The caller additionally refuses to cache (see dialogue_understanding):

  - turns with remembered side-question context (conversation-specific),
  - questions containing digits (could carry an account or phone number),
  - fallbacks, validation replacements and "not in knowledge" answers.

Bounded (MAX_ENTRIES, least recently used evicted) and time-limited
(TTL_SECONDS), so nothing stays forever, and clear() is called whenever the
knowledge is refreshed. The key's knowledge version would already make old
entries unreachable; clearing frees them.
"""

import hashlib
import threading
import time
from collections import OrderedDict

MAX_ENTRIES = 256
TTL_SECONDS = 30 * 60


def cache_key(*parts):
    digest = hashlib.sha256()
    for part in parts:
        digest.update(str(part).encode("utf-8"))
        digest.update(b"\x00")
    return digest.hexdigest()


class AnswerCache:

    def __init__(self, max_entries=MAX_ENTRIES, ttl_seconds=TTL_SECONDS, clock=time.monotonic):
        self.max_entries = max_entries
        self.ttl_seconds = ttl_seconds
        self._clock = clock
        self._entries = OrderedDict()
        self._lock = threading.Lock()
        self.hits = 0
        self.misses = 0

    def get(self, key):
        with self._lock:
            entry = self._entries.get(key)
            if entry is None:
                self.misses += 1
                return None
            stored_at, value = entry
            if self._clock() - stored_at > self.ttl_seconds:
                del self._entries[key]
                self.misses += 1
                return None
            self._entries.move_to_end(key)
            self.hits += 1
            return value

    def put(self, key, value):
        with self._lock:
            self._entries[key] = (self._clock(), value)
            self._entries.move_to_end(key)
            while len(self._entries) > self.max_entries:
                self._entries.popitem(last=False)

    def clear(self):
        with self._lock:
            self._entries.clear()

    def __len__(self):
        return len(self._entries)
