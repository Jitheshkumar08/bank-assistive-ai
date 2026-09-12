"""
Thin HTTP integration layer around the existing engine.

Nothing in `app/` is modified or re-implemented here. This package only
holds the engine's own objects, gives each visit its own conversation
state, and exposes the result over HTTP for the NestJS API to call.
"""

from service.config import load_env, make_console_utf8_safe

# Importing this package is the first thing that happens when the
# service starts (`uvicorn service.main:app` imports `service` before
# `service.main`), so this runs before any `app.*` module is imported
# and before any module-level `os.getenv` in this package is evaluated.
# The engine reads GROQ_API_KEY from the environment during model load;
# by then it has to already be there.
# Before anything in app/ prints its first status line.
make_console_utf8_safe()

LOADED_ENV_NAMES = load_env()

__all__ = ["LOADED_ENV_NAMES"]
