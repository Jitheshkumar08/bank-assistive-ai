"""
Which domain a request belongs to, and whether its context is acceptable.

THE RULE

The domain is derived from WHO is calling, not chosen by the request.

  - Each domain's backend holds its own shared secret (AI_ENGINE_TOKEN for
    Banking, AI_ENGINE_COLLEGE_TOKEN for College). The token a request
    presents decides its domain.
  - A request may also DECLARE its domain (the X-Assistant-Domain header, or
    `domain` in a /turn body). A declaration can only confirm the token's
    domain: a mismatch is refused (403), an unregistered value is refused
    (422). Nothing is ever re-routed to another domain.

LOCAL DEVELOPMENT WITHOUT TOKENS

With AI_ENGINE_ENV=development and no token configured, there is no caller
identity to derive a domain from, so the declaration decides. A request that
declares nothing is a pre-domain caller, and the pre-domain contract was
Banking's -- so it is served as Banking (LEGACY_DOMAIN). That keeps the
Banking backend and every existing Banking test working byte-for-byte. The
College backend always declares `college`; its tests assert it.

With AI_ENGINE_ENV=production the service refuses to start unless every
domain has its own token (see startup_problems). Authentication is never
silently off outside local development.

Nothing here logs or echoes a token or a rejected value.
"""

from __future__ import annotations

import hmac
import os
import re
from dataclasses import dataclass
from typing import Iterable, Mapping, Optional

from app.domains import DOMAINS, UnknownDomainError, get_domain

#: The domain a request that declares none is served as, and only while
#: authentication is disabled in development. See the module docstring.
LEGACY_DOMAIN = "banking"

DEVELOPMENT = "development"
PRODUCTION = "production"
ENVIRONMENTS = (DEVELOPMENT, PRODUCTION)

#: A production token must be at least this long.
MIN_PRODUCTION_TOKEN_LENGTH = 32

#: Context values: identifiers, never free text. Checked here as well as by
#: the request model, because the audio route reads them from form fields.
CONTEXT_VALUE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")


class DomainError(Exception):
    """A refusal with an HTTP status, a stable code and a customer-safe message."""

    status_code = 400
    code = "domain_error"

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class NotAuthorised(DomainError):
    status_code = 401
    code = "not_authorised"


class DomainForbidden(DomainError):
    status_code = 403
    code = "domain_forbidden"


class ContextConflict(DomainError):
    status_code = 409
    code = "context_conflict"


class UnknownDomain(DomainError):
    status_code = 422
    code = "unknown_domain"


class InvalidContext(DomainError):
    status_code = 422
    code = "invalid_context"


class NoPendingWorkflowAction(DomainError):
    """A workflow result for an action the visit is not waiting for."""

    status_code = 409
    code = "no_pending_action"


class ExpiredWorkflowAction(NoPendingWorkflowAction):
    """A workflow result that arrived after its action expired (Phase 6)."""

    code = "action_expired"


class MismatchedWorkflowAction(NoPendingWorkflowAction):
    """A workflow result naming a different action type than the pending one (Phase 6)."""

    code = "action_mismatch"


class InvalidWorkflowResult(DomainError):
    """A workflow result whose outcome the workflow does not define."""

    status_code = 422
    code = "invalid_workflow_result"


class DomainUnavailable(DomainError):
    status_code = 503
    code = "domain_unavailable"


def engine_environment(environ: Mapping[str, str] = os.environ) -> str:
    """AI_ENGINE_ENV, lowercased. Defaults to development; validated at startup."""
    return (environ.get("AI_ENGINE_ENV") or DEVELOPMENT).strip().lower()


def tokens_from_env(environ: Mapping[str, str] = os.environ) -> dict:
    """{domain id: token} for every registered domain; "" where unset."""
    return {
        domain_id: (environ.get(config.token_env) or "").strip()
        for domain_id, config in DOMAINS.items()
    }


def _declared_domain(value: Optional[str]) -> Optional[str]:
    """A declared domain, validated. None when nothing was declared."""
    if value is None:
        return None

    domain_id = value.strip().lower()

    if not domain_id:
        return None

    try:
        return get_domain(domain_id).id
    except UnknownDomainError as error:
        raise UnknownDomain("Unknown assistant domain.") from error


class DomainAuth:
    """Token-to-domain resolution for one snapshot of configuration."""

    def __init__(self, tokens: Mapping[str, str], environment: str = DEVELOPMENT) -> None:
        self._tokens = {domain: (token or "").strip() for domain, token in tokens.items()}
        self.environment = environment

    @property
    def auth_enabled(self) -> bool:
        """True as soon as ANY token is configured: then every request needs one."""
        return any(self._tokens.values())

    def startup_problems(self) -> list:
        """
        Configuration that must stop the service from starting.

        Messages name variables, never values.
        """
        problems = []

        if self.environment not in ENVIRONMENTS:
            problems.append(f"AI_ENGINE_ENV must be one of {', '.join(ENVIRONMENTS)}.")

        configured = [token for token in self._tokens.values() if token]
        if len(configured) != len(set(configured)):
            problems.append("Each domain must have its own token; two domains share one.")

        if self.environment == PRODUCTION:
            for domain_id, token in self._tokens.items():
                name = DOMAINS[domain_id].token_env
                if not token:
                    problems.append(f"{name} is required when AI_ENGINE_ENV=production.")
                elif len(token) < MIN_PRODUCTION_TOKEN_LENGTH:
                    problems.append(
                        f"{name} must be at least {MIN_PRODUCTION_TOKEN_LENGTH} characters "
                        "when AI_ENGINE_ENV=production."
                    )

        return problems

    def authenticate(self, presented: Optional[str]) -> Optional[str]:
        """
        The domain whose token was presented.

        None only when authentication is disabled (development, no tokens).
        Every token is compared in constant time, and all of them are
        compared, so timing does not reveal which domain a guess was near.
        """
        if not self.auth_enabled:
            return None

        presented = presented or ""
        matched = None

        for domain_id, token in self._tokens.items():
            if token and hmac.compare_digest(presented.encode(), token.encode()):
                matched = domain_id

        if matched is None:
            raise NotAuthorised("Not authorised.")

        return matched

    def resolve(self, authenticated: Optional[str], declared: Iterable[Optional[str]] = ()) -> str:
        """
        The request's domain, from its token and any declarations.

        `declared` holds every place the request named a domain (header,
        body); they must agree with each other and with the token.
        """
        names = {name for name in (_declared_domain(value) for value in declared) if name}

        if len(names) > 1:
            raise DomainForbidden("The request names more than one assistant domain.")

        declared_domain = next(iter(names), None)

        if authenticated is not None:
            if declared_domain is not None and declared_domain != authenticated:
                raise DomainForbidden("This caller may not use that assistant domain.")
            return authenticated

        if self.auth_enabled:
            # authenticate() returns None only when auth is disabled, so a
            # caller reaching here skipped it. Refuse rather than guess.
            raise NotAuthorised("Not authorised.")

        return declared_domain or LEGACY_DOMAIN


@dataclass(frozen=True)
class Caller:
    """
    An authenticated caller, before its final domain is known.

    A /turn body may also declare a domain, which is only readable inside the
    endpoint, so resolution finishes there with resolve(body_domain).
    """

    auth: DomainAuth
    authenticated: Optional[str]
    declared: Optional[str] = None

    def resolve(self, *more_declared: Optional[str]) -> str:
        return self.auth.resolve(self.authenticated, (self.declared, *more_declared))


def validate_context(domain_id: str, context: Optional[Mapping[str, object]]) -> dict:
    """
    The turn's context, checked against the domain's policy.

    Returns only keys with a value. Refuses keys the domain does not accept
    (College context in a Banking turn, or the reverse), a missing required
    key, and anything that is not an identifier.
    """
    policy = get_domain(domain_id).context
    supplied = {key: value for key, value in (context or {}).items() if value is not None}

    unexpected = set(supplied) - policy.allowed
    if unexpected:
        raise InvalidContext("The request carries context this assistant does not accept.")

    for key, value in supplied.items():
        if not isinstance(value, str) or not CONTEXT_VALUE.match(value):
            raise InvalidContext("The request context is not valid.")

    missing = policy.required - set(supplied)
    if missing:
        raise InvalidContext("The request is missing required context.")

    return supplied


def bound_context(domain_id: str, context: Mapping[str, str]) -> dict:
    """The part of a validated context that is fixed for the session."""
    policy = get_domain(domain_id).context
    return {key: context[key] for key in policy.bound if key in context}
