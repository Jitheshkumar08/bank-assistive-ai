"""
One conversation per visit.

The engine was written for a single person at a terminal: one process,
one ConversationManager, one banking task at a time. A web service has
many people at once, and a shared ConversationManager would let one
customer's workflow step, entities and history leak into another's.

This registry is the fix. It hands every session_id its own
ConversationManager and never lets two sessions touch the same one. It
imports nothing expensive -- only the engine's own conversation state --
so it stays cheap to construct and cheap to test.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from typing import Callable, Iterator, Optional

from app.conversation.manager import ConversationManager


@dataclass
class SessionEntry:
    """A single visit's conversation, plus when it was last touched."""

    conversation: ConversationManager
    language: str
    last_used_at: float = field(default_factory=time.monotonic)
    # Serialises turns within one session. Two requests for the same
    # visit must not interleave halfway through a workflow step.
    lock: threading.Lock = field(default_factory=threading.Lock)


class SessionRegistry:
    """
    Thread-safe map of session_id to conversation state.

    Two levels of locking, deliberately:

    - a registry lock, held only long enough to find or create an entry
    - a per-session lock, held for the duration of a turn

    Holding one global lock across a whole turn would serialise every
    customer in the branch behind whoever is currently waiting on the
    LLM.
    """

    def __init__(
        self,
        *,
        idle_timeout_seconds: float = 60 * 60,
        max_sessions: int = 500,
        factory: Callable[[], ConversationManager] = ConversationManager,
    ) -> None:
        self._entries: dict[str, SessionEntry] = {}
        self._lock = threading.Lock()
        self._idle_timeout_seconds = idle_timeout_seconds
        self._max_sessions = max_sessions
        self._factory = factory

    # -----------------------------------------------------------------
    # Lookup
    # -----------------------------------------------------------------

    def get_or_create(self, session_id: str, language: str = "en") -> SessionEntry:
        """
        Returns the conversation for `session_id`, creating it on first use.

        A returning session keeps everything it had: workflow state, the
        step it reached, collected entities and history. That is the whole
        point -- a voice turn and a typed turn in the same visit continue
        one conversation rather than starting two.
        """
        if not session_id:
            raise ValueError("session_id is required.")

        with self._lock:
            entry = self._entries.get(session_id)

            if entry is None:
                self._evict_locked()

                conversation = self._factory()
                conversation.start_conversation()
                conversation.language = language

                entry = SessionEntry(conversation=conversation, language=language)
                self._entries[session_id] = entry

            entry.last_used_at = time.monotonic()

            return entry

    def peek(self, session_id: str) -> Optional[SessionEntry]:
        """Returns an existing entry without creating one."""
        with self._lock:
            return self._entries.get(session_id)

    def remove(self, session_id: str) -> bool:
        """Drops a visit's conversation. Returns whether anything was removed."""
        with self._lock:
            return self._entries.pop(session_id, None) is not None

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()

    def __len__(self) -> int:
        with self._lock:
            return len(self._entries)

    def session_ids(self) -> Iterator[str]:
        with self._lock:
            return iter(list(self._entries))

    # -----------------------------------------------------------------
    # Housekeeping
    # -----------------------------------------------------------------

    def purge_idle(self) -> int:
        """
        Forgets conversations nobody has touched for a while.

        Branch visits end without telling us -- people walk away. Without
        this the process would accumulate conversation history for every
        customer who ever used it.
        """
        cutoff = time.monotonic() - self._idle_timeout_seconds

        with self._lock:
            stale = [key for key, entry in self._entries.items() if entry.last_used_at < cutoff]

            for key in stale:
                del self._entries[key]

            return len(stale)

    def _evict_locked(self) -> None:
        """
        Makes room when the registry is full. Caller holds the lock.

        Idle entries go first; if everything is active, the least recently
        used one is dropped. Refusing new customers because the map is
        full would be a worse failure than losing the oldest conversation.
        """
        if len(self._entries) < self._max_sessions:
            return

        cutoff = time.monotonic() - self._idle_timeout_seconds
        stale = [key for key, entry in self._entries.items() if entry.last_used_at < cutoff]

        for key in stale:
            del self._entries[key]

        if len(self._entries) < self._max_sessions:
            return

        oldest = min(self._entries, key=lambda key: self._entries[key].last_used_at)
        del self._entries[oldest]
