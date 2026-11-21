"""The Banking domain: the engine's original and, until now, only application.

Its token is the engine's existing AI_ENGINE_TOKEN, so the Banking backend's
configuration and requests keep working unchanged.
"""

from app.domains.base import ContextPolicy, DomainConfig

BANKING = DomainConfig(
    id="banking",
    display_name="Banking",
    token_env="AI_ENGINE_TOKEN",
    # The Banking backend sends no context today. A branch may be supplied,
    # and is then fixed for the visit; College keys are refused.
    context=ContextPolicy(
        allowed=frozenset({"branch_id"}),
        bound=frozenset({"branch_id"}),
    ),
)
