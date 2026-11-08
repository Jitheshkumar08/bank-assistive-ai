"""What an application domain is, as plain configuration.

A domain is one application the shared engine serves -- Banking, College.
This module describes a domain; it does no language processing, retrieval or
routing. Everything domain-specific the engine needs is read from a
DomainConfig, so generic code never has to name a domain.

Later phases add the domain's knowledge collection, intent profile and
workflows to this record. Phase 2 needs only identity, how a caller proves it
belongs to the domain, and which request context the domain accepts.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

#: Every context key the engine understands. Each comes from the calling
#: backend (which resolved it from a QR scan or a session), never from the
#: engine itself.
#:
#:   institution_id  the college (College) -- isolates knowledge and sessions
#:   branch_id       the bank branch (Banking)
#:   area            the area of the premises a QR code identified
#:   location_id     a finer location inside that area
CONTEXT_KEYS = frozenset({"institution_id", "branch_id", "area", "location_id"})

#: Domain identifiers: short, lowercase, no separators that could be confused
#: in a log line or a session key.
DOMAIN_ID = re.compile(r"^[a-z][a-z0-9_]{1,31}$")


@dataclass(frozen=True)
class ContextPolicy:
    """Which context keys a domain accepts, requires, and fixes per session.

    allowed   keys a request may carry; any other key is refused, so College
              context can never be smuggled into a Banking turn or vice versa.
    required  keys every turn must carry.
    bound     keys fixed when the session is created. A later turn that
              carries a different value is refused rather than silently
              moving the conversation to another institution or branch.
    """

    allowed: frozenset = frozenset()
    required: frozenset = frozenset()
    bound: frozenset = frozenset()

    def __post_init__(self) -> None:
        unknown = (self.allowed | self.required | self.bound) - CONTEXT_KEYS
        if unknown:
            raise ValueError(f"Unknown context keys: {sorted(unknown)}")
        if not self.required <= self.allowed or not self.bound <= self.allowed:
            raise ValueError("Required and bound context keys must also be allowed.")


@dataclass(frozen=True)
class KnowledgeConfig:
    """
    A domain's own knowledge collection (Phase 3).

    manifest     the collection's manifest.json; documents live under the
                 `documents/` directory next to it and nowhere else.
    min_score    retrieval score below which a question is treated as not
                 answerable from the collection (see domain_retrieval.py).
    institution_scoped
                 every search names an institution and sees only that
                 institution's documents.
    """

    manifest: Path
    min_score: float
    institution_scoped: bool = True
    top_k: int = 2


@dataclass(frozen=True)
class NavigationConfig:
    """
    A domain's own campus map collection (Phase 5): verified places and
    routes per institution (app/navigation/campus_map.py). `manifest` is the
    collection's manifest.json; map files live under `maps/` next to it.
    """

    manifest: Path


@dataclass(frozen=True)
class DomainConfig:
    """One application domain served by the shared engine."""

    id: str
    display_name: str
    #: Environment variable holding the shared secret that identifies a
    #: caller as this domain's backend. The value is never stored here.
    token_env: str
    context: ContextPolicy = field(default_factory=ContextPolicy)
    #: None = the engine's built-in knowledge base (Banking's original
    #: app/knowledge/documents, retrieved exactly as before domains).
    knowledge: Optional[KnowledgeConfig] = None
    #: language -> the session's reply localizer (Phase 4). None = the
    #: engine's ResponseLocalizer over the shared catalog, as before.
    localizer: Optional[Callable] = field(default=None, compare=False)
    #: The domain's own workflow definitions. None = the engine's original
    #: (Banking) workflow folder.
    workflows_dir: Optional[Path] = None
    #: The domain's campus map collection (Phase 5). None = no navigation.
    navigation: Optional[NavigationConfig] = None

    def __post_init__(self) -> None:
        if not DOMAIN_ID.match(self.id):
            raise ValueError(f"Invalid domain id: {self.id!r}")
