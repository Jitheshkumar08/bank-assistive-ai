"""
Phase 6 test harness: the REAL engine HTTP service (service.main.app -- token
auth, domain resolution, context policy, session registry, College runtime,
workflow runner, workflow-result endpoint) on SYNTHETIC College fixtures, for
the College backend's cross-process integration test
(college-domain/backend/test/integration/).

Offline: the Banking runtime is a stub (it must never be used for College), the
grounded answerer gets a fake model, documents and campus maps are the
synthetic fixtures (verified=false, test institutions only). NEVER a
production entry point.

    python -m debugging.college_integration_server --port 8765 \
        --bank-token <t1> --college-token <t2>

Prints "READY <port>" once it accepts requests.
"""

from __future__ import annotations

import argparse
import os
import sys


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--bank-token", required=True)
    parser.add_argument("--college-token", required=True)
    args = parser.parse_args()

    # The lifespan insists on a Groq key; nothing here ever calls Groq.
    os.environ.setdefault("GROQ_API_KEY", "offline-integration-test")
    os.environ["AI_ENGINE_ENV"] = "development"

    import uvicorn

    import service.main as main
    from debugging.test_college_runtime import FakeBanking
    from debugging.test_college_workflows import runtime
    from service import engine as engine_module

    banking = FakeBanking()
    main.get_runtime = lambda: banking
    engine_module.get_runtime = lambda: banking
    main.INTERNAL_TOKEN, main.COLLEGE_TOKEN = args.bank_token, args.college_token
    engine_module.unregister_domain_runtime("college")
    engine_module.register_domain_runtime("college", lambda: runtime()[0])

    config = uvicorn.Config(main.app, host="127.0.0.1", port=args.port, log_level="warning")
    server = uvicorn.Server(config)

    original_startup = server.startup

    async def startup(sockets=None):
        await original_startup(sockets=sockets)
        print(f"READY {args.port}", flush=True)

    server.startup = startup
    server.run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
