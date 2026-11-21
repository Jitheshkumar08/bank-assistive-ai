"""The registry of application domains the shared engine serves.

Adding a domain means adding its config module and listing it here. Nothing
else in the engine enumerates domains.
"""

from __future__ import annotations

from typing import Dict, Tuple

from app.domains.banking.config import BANKING
from app.domains.base import CONTEXT_KEYS, ContextPolicy, DomainConfig
from app.domains.college.config import COLLEGE

DOMAINS: Dict[str, DomainConfig] = {config.id: config for config in (BANKING, COLLEGE)}


class UnknownDomainError(ValueError):
    """Raised for a domain id that is not registered. Never defaulted."""


def domain_ids() -> Tuple[str, ...]:
    return tuple(DOMAINS)


def get_domain(domain_id: str) -> DomainConfig:
    """The registered domain, or UnknownDomainError. There is no fallback."""
    config = DOMAINS.get(domain_id) if isinstance(domain_id, str) else None

    if config is None:
        raise UnknownDomainError("Unknown assistant domain.")

    return config


# ---------------------------------------------------------------------------
# Domain DATA (restored from the 6 November Banking work).
#
# The Banking knowledge pipeline (fast path, answer prompt, request policy,
# spelling) reads its domain-specific data from a domain folder:
#
#     app/domains/banking/
#         domain.json        scope, fixed replies, extra policy patterns,
#                            where the knowledge collection is
#         faq.json           exact-answer index into knowledge articles
#         terminology.json   approved spellings
#
# Selected with ASSISTANT_DOMAIN=<name> (default banking). This is separate
# from the registry above, which decides which domain serves a request.
# ---------------------------------------------------------------------------

import json
import os
from functools import lru_cache
from pathlib import Path

DOMAINS_PATH = Path(__file__).parent
APP_PATH = DOMAINS_PATH.parent
DEFAULT_DOMAIN = "banking"


class Domain:

    def __init__(self, name, config, folder):
        self.name = name
        self.config = config
        self.folder = folder

    @property
    def replies(self):
        return self.config.get("replies", {})

    def reply(self, key):
        return self.replies[key]

    @property
    def policy(self):
        return self.config.get("policy", {})

    @property
    def scope_description(self):
        return self.config.get("scope_description", "")

    @property
    def unrelated_questions(self):
        """'redirect' (default) or 'answer' -- how the answer prompt treats off-topic questions."""
        return self.config.get("unrelated_questions", "redirect")

    @property
    def answerability(self):
        """Patterns for questions the knowledge cannot answer (app/knowledge/answerability.py)."""
        return self.config.get("answerability", {})

    @property
    def knowledge_collection(self):
        return APP_PATH / self.config["knowledge_collection"]

    def _data(self, key):
        filename = self.config.get(key)
        if not filename:
            return {}
        return json.loads((self.folder / filename).read_text(encoding="utf-8"))

    def faq(self):
        return self._data("faq_file")

    def terminology(self):
        return self._data("terminology_file")


@lru_cache(maxsize=None)
def load_domain(name=None):
    name = name or os.getenv("ASSISTANT_DOMAIN", "").strip() or DEFAULT_DOMAIN
    folder = DOMAINS_PATH / name
    config = json.loads((folder / "domain.json").read_text(encoding="utf-8"))
    return Domain(name, config, folder)


__all__ = [
    "BANKING",
    "COLLEGE",
    "CONTEXT_KEYS",
    "ContextPolicy",
    "DOMAINS",
    "Domain",
    "DomainConfig",
    "UnknownDomainError",
    "domain_ids",
    "get_domain",
    "load_domain",
]
