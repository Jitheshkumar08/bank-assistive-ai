"""
Turns the ``.env`` file next to this package into process environment.

The engine reads its Groq key straight from the environment --
``app/dialogue/llm/dialogue_understanding.py`` calls
``os.getenv("GROQ_API_KEY")`` and raises if it is missing -- and nothing
in ``app/`` ever opens a file to find it. A ``.env`` sitting in the
directory therefore does nothing on its own. This module is the piece
that makes it count, and it runs before any engine module is imported.

A real environment variable always wins. A value exported in the shell,
injected by a container, or supplied as a CI secret is never overwritten
by the file, so a stale checkout cannot quietly override a deployment.

Nothing here logs a value. Only names are ever reported.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Dict, List, Mapping, MutableMapping, Optional

#: language_engine/.env -- resolved from this file, not the working
#: directory, so the service behaves the same however it is launched.
DEFAULT_ENV_PATH = Path(__file__).resolve().parent.parent / ".env"

#: Names that must never be echoed, even in a "loaded these" line.
SECRET_NAMES = frozenset({"GROQ_API_KEY", "AI_ENGINE_TOKEN"})


def make_console_utf8_safe() -> None:
    """
    Stops a status message from killing the service.

    The engine prints check marks as it loads ("Whisper loaded OK"), and
    on Windows a redirected stream defaults to cp1252, which cannot
    encode them. Uvicorn writing to a log file was therefore enough to
    crash startup inside SpeechToText -- an encoding fault wearing a
    Whisper failure's clothing.

    Setting PYTHONIOENCODING in .env cannot fix this: the interpreter
    reads that at startup, long before the file is loaded. The streams
    have to be reconfigured in the running process instead, which is
    done here rather than by touching the engine's own prints.
    """
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is None:
            continue

        try:
            reconfigure(encoding="utf-8", errors="replace")
        except (ValueError, OSError):
            # A stream that refuses is not worth failing a service over.
            pass


def _strip_quotes(value: str) -> str:
    """Removes one matching pair of surrounding quotes, if present."""
    if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
        return value[1:-1]

    return value


def parse_env_file(text: str) -> Dict[str, str]:
    """
    Parses ``KEY=value`` lines.

    Deliberately small: comments, blank lines, an optional ``export``
    prefix, surrounding quotes, and a trailing ``# comment`` after an
    unquoted value. Anything more exotic belongs in a real config file,
    not in a secret drop.
    """
    values: Dict[str, str] = {}

    for raw in text.splitlines():
        line = raw.strip()

        if not line or line.startswith("#"):
            continue

        if line.startswith("export "):
            line = line[len("export ") :].lstrip()

        name, separator, value = line.partition("=")
        if not separator:
            # Not an assignment. Skipped rather than guessed at.
            continue

        name = name.strip()
        if not name.isidentifier():
            continue

        value = value.strip()
        quoted = len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"')

        if not quoted and " #" in value:
            value = value.split(" #", 1)[0].rstrip()

        values[name] = _strip_quotes(value)

    return values


def load_env(
    path: Optional[Path] = None,
    *,
    environ: Optional[MutableMapping[str, str]] = None,
) -> List[str]:
    """
    Applies the file's values to the environment and returns the names
    it set.

    Empty values are skipped: a placeholder line like ``GROQ_API_KEY=``
    must not shadow a key the shell already exported, and must not turn
    "missing" into "present but blank", which fails much later and far
    less clearly.

    A missing file is not an error -- exporting the variables by hand is
    a perfectly good way to run this service.
    """
    target: MutableMapping[str, str] = os.environ if environ is None else environ
    source = DEFAULT_ENV_PATH if path is None else Path(path)

    if not source.is_file():
        return []

    try:
        text = source.read_text(encoding="utf-8")
    except OSError:
        # An unreadable .env should not stop a service that may well
        # have everything it needs in the real environment.
        return []

    applied: List[str] = []

    for name, value in parse_env_file(text).items():
        if not value:
            continue
        if target.get(name):
            continue

        target[name] = value
        applied.append(name)

    return applied


def describe(names: Mapping[str, str] | List[str]) -> str:
    """A log-safe summary: names only, never values."""
    return ", ".join(sorted(names)) if names else "nothing"
