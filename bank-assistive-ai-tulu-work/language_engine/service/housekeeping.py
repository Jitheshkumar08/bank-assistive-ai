"""
Periodic cleanup of conversations nobody is using any more.

`SessionRegistry.purge_idle()` existed from the start but nothing ever
called it: eviction only happened once the registry was full. A customer
who walked away without signing out left their conversation in memory
until 500 others had arrived after them.

This module owns the one task that calls it. The task is started and
stopped by the service's lifespan, so there is never a timer the process
does not know about, never two of them, and nothing left running after
shutdown.
"""

from __future__ import annotations

import asyncio
import logging
import math
import os
from typing import Optional

from service.registry import SessionRegistry

logger = logging.getLogger("assistant-service")

#: How often to look for idle conversations. Idleness itself is the
#: registry's idle timeout; this only bounds how late a purge can be.
DEFAULT_PURGE_INTERVAL_SECONDS = 300.0

#: How long a conversation may sit untouched before it is released. An
#: hour comfortably outlasts a customer filling in a slip at the counter.
DEFAULT_IDLE_TIMEOUT_SECONDS = 60.0 * 60


def _positive_seconds(name: str, default: float) -> float:
    """
    A positive, finite number of seconds from the environment, or `default`.

    Anything else falls back rather than disabling cleanup ("inf"),
    purging every conversation at once ("0", "-1"), or spinning in a
    tight loop.
    """
    raw = os.getenv(name, "").strip()

    try:
        value = float(raw)
    except ValueError:
        return default

    return value if math.isfinite(value) and value > 0 else default


def purge_interval_from_env() -> float:
    """ENGINE_SESSION_PURGE_INTERVAL_SECONDS, or the default."""
    return _positive_seconds("ENGINE_SESSION_PURGE_INTERVAL_SECONDS", DEFAULT_PURGE_INTERVAL_SECONDS)


def idle_timeout_from_env() -> float:
    """ENGINE_SESSION_IDLE_SECONDS, or the default."""
    return _positive_seconds("ENGINE_SESSION_IDLE_SECONDS", DEFAULT_IDLE_TIMEOUT_SECONDS)


class IdleSessionReaper:
    """Calls `registry.purge_idle()` every `interval_seconds` while running."""

    def __init__(self, registry: SessionRegistry, interval_seconds: float) -> None:
        if interval_seconds <= 0:
            raise ValueError("interval_seconds must be positive.")

        self._registry = registry
        self._interval_seconds = interval_seconds
        self._task: Optional[asyncio.Task] = None

    @property
    def running(self) -> bool:
        return self._task is not None and not self._task.done()

    def run_once(self) -> int:
        """
        One cleanup pass. Returns how many conversations were dropped.

        Never raises: a failed pass is logged and the next one tries
        again, so one bad pass cannot end cleanup for the process's life.
        """
        try:
            purged = self._registry.purge_idle()
        except Exception as error:
            logger.warning("Idle session cleanup failed: %s", type(error).__name__)
            return 0

        if purged:
            # Counts only. Session ids are customer identifiers.
            logger.info("Released %d idle conversation(s).", purged)

        return purged

    def start(self) -> None:
        """Starts the loop on the running event loop. A second call is a no-op."""
        if self.running:
            return

        self._task = asyncio.get_running_loop().create_task(self._loop())

    async def stop(self) -> None:
        """Stops the loop and waits for it to finish. Safe to call repeatedly."""
        task, self._task = self._task, None

        if task is None or task.done():
            return

        task.cancel()

        try:
            await task
        except asyncio.CancelledError:
            pass

    async def _loop(self) -> None:
        # Sleep first: nothing can be idle the moment the service starts.
        while True:
            await asyncio.sleep(self._interval_seconds)
            self.run_once()
