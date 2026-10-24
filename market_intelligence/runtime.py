"""Runtime launcher.

psycopg's async pool requires a selector event loop. Uvicorn's Windows
``asyncio`` loop factory defaults to ProactorEventLoop, so the market service
exposes an explicit factory and uses it in the launcher.
"""

from __future__ import annotations

import argparse
import asyncio


def selector_loop_factory(use_subprocess: bool = False) -> type[asyncio.AbstractEventLoop]:
    """Uvicorn-compatible loop factory (signature receives use_subprocess)."""
    return asyncio.SelectorEventLoop


def main() -> None:
    import sys

    import uvicorn

    parser = argparse.ArgumentParser(description="Run the Relay Market Intelligence API")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--log-level", default="info")
    args = parser.parse_args()

    config = uvicorn.Config(
        "market_intelligence.main:app",
        host=args.host,
        port=args.port,
        log_level=args.log_level,
    )
    server = uvicorn.Server(config)
    loop = asyncio.SelectorEventLoop() if sys.platform == "win32" else asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        loop.run_until_complete(server.serve())
    finally:
        loop.close()


if __name__ == "__main__":
    main()
