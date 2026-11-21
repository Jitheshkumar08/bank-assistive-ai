"""Stage-level latency for one turn, measured with a monotonic clock.

A turn passes through components that know nothing of each other --
normalisation, intent detection, exact lookup, retrieval, the LLM -- so
timings are collected through a context variable instead of being threaded
through every signature:

    with turn_timer() as timer:          # EngineRuntime.run_turn
        ...
        with stage("retrieval"):         # anywhere below, in any module
            ...
    timer.as_dict()  ->  {"retrieval": 12.4, "llm_answer": 812.0, "total": 840.1}

Outside a turn, stage() still runs the block and records nothing, so a
component can be used on its own (tests, the CLI, evaluation) unchanged.

Durations are milliseconds from time.perf_counter(), which is monotonic. A
stage entered twice in one turn (two LLM calls) is summed, and its count is
kept, because "the LLM was called twice" is itself the finding.
"""

import contextvars
import time
from contextlib import contextmanager

_current = contextvars.ContextVar("turn_timer", default=None)


class TurnTimer:

    def __init__(self):
        self._started = time.perf_counter()
        self.stages = {}
        self.counts = {}
        self.total_ms = None

    def add(self, name, milliseconds):
        self.stages[name] = self.stages.get(name, 0.0) + milliseconds
        self.counts[name] = self.counts.get(name, 0) + 1

    def finish(self):
        self.total_ms = (time.perf_counter() - self._started) * 1000
        return self

    def as_dict(self):
        out = {name: round(ms, 2) for name, ms in self.stages.items()}
        if self.total_ms is not None:
            out["total"] = round(self.total_ms, 2)
        return out

    def summary(self):
        parts = []
        for name, ms in self.stages.items():
            count = self.counts[name]
            parts.append(f"{name}={ms:.1f}ms" + (f"x{count}" if count > 1 else ""))
        if self.total_ms is not None:
            parts.append(f"total={self.total_ms:.1f}ms")
        return " ".join(parts)


@contextmanager
def turn_timer():
    """Collects every stage() entered inside the block."""
    timer = TurnTimer()
    token = _current.set(timer)
    try:
        yield timer
    finally:
        timer.finish()
        _current.reset(token)


def current_timer():
    return _current.get()


@contextmanager
def stage(name):
    """Times the block into the current turn, if there is one."""
    started = time.perf_counter()
    try:
        yield
    finally:
        timer = _current.get()
        if timer is not None:
            timer.add(name, (time.perf_counter() - started) * 1000)
