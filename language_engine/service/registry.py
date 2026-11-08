"""
One conversation per visit.

The engine was written for a single person at a terminal: one process,
one ConversationManager, one banking task at a time. A web service has
many people at once, and a shared ConversationManager would let one
customer's workflow step, entities and history leak into another's.

This registry is the fix. It hands every session_id its own
ConversationManager and never lets two sessions touch the same one. It
imports nothing expensive -- the engine's own conversation state and its
response localizer, both of which are plain Python with no model behind
them -- so it stays cheap to construct and cheap to test.
"""

from __future__ import annotations

import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Callable, Iterator, Mapping, Optional, Tuple

from app.conversation.manager import ConversationManager
from app.dialogue.localization import ResponseLocalizer
from app.domains import UnknownDomainError, get_domain
from service.domains import LEGACY_DOMAIN, ContextConflict
from service.language import normalise_language

def _localizer_for(domain: str, language: str) -> ResponseLocalizer:
    """The domain's own reply localizer (Phase 4); the shared one by default."""
    try:
        factory = get_domain(domain).localizer
    except UnknownDomainError:
        factory = None
    return factory(language) if factory is not None else ResponseLocalizer(language)


#: Domain used by in-process callers that name none (the debugging suites and
#: anything written before domains existed). The HTTP layer always passes the
#: domain it resolved, so this never decides a web request's domain.
DEFAULT_DOMAIN = LEGACY_DOMAIN


@dataclass
class SessionEntry:
    """A single visit's conversation, plus when it was last touched."""

    conversation: ConversationManager
    language: str
    last_used_at: float = field(default_factory=time.monotonic)
    # Serialises turns within one session. Two requests for the same
    # visit must not interleave halfway through a workflow step.
    lock: threading.Lock = field(default_factory=threading.Lock)

    # Renders this visit's replies in this visit's language, at the one
    # output boundary (Phase 3.2B-16A).
    #
    # PER SESSION, not shared. ResponseLocalizer holds the language it
    # renders into, so a single shared instance would render a Kannada
    # customer's reply in whichever language the previous request used --
    # a correctness bug, not merely leaked state. It also remembers the
    # last canonical reply, which belongs to one visit and nobody else.
    #
    # Created in __post_init__ rather than defaulted, so its language can
    # never disagree with the entry's however the entry was built.
    localizer: Optional[ResponseLocalizer] = None

    #: The application domain this visit belongs to. Part of the registry
    #: key, so a College visit and a Banking visit can never share state,
    #: even when their backends happen to use the same session id.
    domain: str = DEFAULT_DOMAIN

    #: Context fixed when the visit began (College: institution_id). A later
    #: turn naming a different value is refused, never followed.
    bound_context: dict = field(default_factory=dict)

    #: The latest per-turn context (area, location). Replaced by each turn
    #: that carries context; left as it was by turns that carry none.
    context: dict = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.localizer is None:
            self.localizer = _localizer_for(self.domain, self.language)

    def apply_language(self, language: str) -> bool:
        """
        Makes `language` this visit's language everywhere it is held.

        Three places hold it -- the entry (which speech recognition reads),
        the conversation, and the localizer -- and they change together or
        not at all. Before M2 only creation set them, so a visit whose
        language changed kept transcribing and replying in the old one
        while NestJS had TTS speak the new one.

        Nothing else is touched: workflow state, the current step,
        collected entities and history all carry over. So does the
        localizer's remembered canonical reply, which is what lets
        "repeat" after a switch replay the last reply in the NEW language.

        Returns whether anything changed. Callers hold the entry's lock.
        """
        if language == self.language:
            return False

        self.language = language
        self.conversation.language = language
        self.localizer.set_language(language)
        return True


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
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        # Keyed by (domain, session_id): sessions are isolated per domain.
        self._entries: dict[Tuple[str, str], SessionEntry] = {}
        self._lock = threading.Lock()
        self._idle_timeout_seconds = idle_timeout_seconds
        self._max_sessions = max_sessions
        self._factory = factory
        # Injectable so idleness can be tested without waiting an hour.
        self._clock = clock

    @property
    def idle_timeout_seconds(self) -> float:
        return self._idle_timeout_seconds

    # -----------------------------------------------------------------
    # Lookup
    # -----------------------------------------------------------------

    def get_or_create(
        self,
        session_id: str,
        language: str = "en",
        *,
        domain: str = DEFAULT_DOMAIN,
        bound: Optional[Mapping[str, str]] = None,
    ) -> SessionEntry:
        """
        Returns the conversation for `session_id`, creating it on first use.

        A returning session keeps everything it had: workflow state, the
        step it reached, collected entities and history. That is the whole
        point -- a voice turn and a typed turn in the same visit continue
        one conversation rather than starting two.

        `language` sets the language of a NEW entry only. A returning
        session's language is changed by in_turn(), under that session's
        turn lock, so a turn already running never sees its language change
        halfway through.

        `domain` selects which domain's sessions to look in. `bound` is the
        context fixed for the session (see SessionEntry.bound_context): it
        is recorded when the session is created, and a returning session
        whose bound value differs raises ContextConflict -- the turn is
        refused rather than continued under another institution or branch.
        """
        if not session_id:
            raise ValueError("session_id is required.")

        language = normalise_language(language)
        bound = dict(bound or {})
        key = (domain, session_id)

        with self._lock:
            entry = self._entries.get(key)

            if entry is not None:
                for name, value in bound.items():
                    if entry.bound_context.get(name) != value:
                        raise ContextConflict(
                            "This conversation belongs to a different context. "
                            "Start a new session for it."
                        )

            if entry is None:
                self._evict_locked()

                conversation = self._factory()
                conversation.start_conversation()
                conversation.language = language

                entry = SessionEntry(
                    conversation=conversation,
                    language=language,
                    last_used_at=self._clock(),
                    domain=domain,
                    bound_context=bound,
                )
                self._entries[key] = entry

            entry.last_used_at = self._clock()

            return entry

    def touch(self, entry: SessionEntry) -> None:
        """Marks a conversation as used just now."""
        with self._lock:
            entry.last_used_at = self._clock()

    @contextmanager
    def in_turn(
        self,
        entry: SessionEntry,
        language: Optional[str] = None,
        context: Optional[Mapping[str, str]] = None,
    ) -> Iterator[SessionEntry]:
        """
        Holds a conversation for one turn.

        Serialises turns on the same visit, and stamps the conversation as
        used when the turn FINISHES as well as when it began. Idleness is
        time since the customer was last answered: a turn that spent two
        minutes in speech recognition must not leave the conversation two
        minutes closer to being purged.

        `language` is the visit's language as NestJS sent it with this
        turn (M2). NestJS owns the visit, re-reads its language from the
        database on every request and sends the same value to /tts, so it
        is the single source of truth. Applying it HERE -- after the lock
        is taken, before the turn runs -- means the whole turn, from speech
        recognition to the rendered reply, uses one language, and a
        concurrent turn on the same visit can never switch it mid-way.
        None leaves the language as it is (callers written before M2).

        `context` is this turn's validated context, applied the same way:
        under the lock, so a running turn never sees it change. None leaves
        it as it is.
        """
        with entry.lock:
            if language is not None:
                entry.apply_language(normalise_language(language))
            if context is not None:
                entry.context = dict(context)
            try:
                yield entry
            finally:
                self.touch(entry)

    def peek(self, session_id: str, *, domain: str = DEFAULT_DOMAIN) -> Optional[SessionEntry]:
        """Returns an existing entry of `domain` without creating one."""
        with self._lock:
            return self._entries.get((domain, session_id))

    def remove(self, session_id: str, *, domain: str = DEFAULT_DOMAIN) -> bool:
        """Drops a visit's conversation. Returns whether anything was removed."""
        with self._lock:
            return self._entries.pop((domain, session_id), None) is not None

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()

    def __len__(self) -> int:
        with self._lock:
            return len(self._entries)

    def session_ids(self, *, domain: Optional[str] = None) -> Iterator[str]:
        """Session ids held, for one domain or (domain=None) for all of them."""
        with self._lock:
            return iter([sid for (dom, sid) in self._entries if domain is None or dom == domain])

    # -----------------------------------------------------------------
    # Housekeeping
    # -----------------------------------------------------------------

    def purge_idle(self) -> int:
        """
        Forgets conversations nobody has touched for a while.

        Branch visits end without telling us -- people walk away. Without
        this the process would accumulate conversation history for every
        customer who ever used it.

        A conversation whose turn is still running is never purged, however
        long ago that turn began: its lock is held, and dropping it mid-turn
        would lose the reply's effect on the workflow.
        """
        cutoff = self._clock() - self._idle_timeout_seconds

        with self._lock:
            stale = [
                key
                for key, entry in self._entries.items()
                if entry.last_used_at < cutoff and not entry.lock.locked()
            ]

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

        cutoff = self._clock() - self._idle_timeout_seconds
        stale = [key for key, entry in self._entries.items() if entry.last_used_at < cutoff]

        for key in stale:
            del self._entries[key]

        if len(self._entries) < self._max_sessions:
            return

        oldest = min(self._entries, key=lambda key: self._entries[key].last_used_at)
        del self._entries[oldest]
