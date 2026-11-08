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


__all__ = [
    "BANKING",
    "COLLEGE",
    "CONTEXT_KEYS",
    "ContextPolicy",
    "DOMAINS",
    "DomainConfig",
    "UnknownDomainError",
    "domain_ids",
    "get_domain",
]
