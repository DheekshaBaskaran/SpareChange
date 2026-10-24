"""Relay Market Intelligence service.

Owned by Duo 1 / Person A. The service is the only writer to Relay's market
tables and the only supported source of normalized GPU market offers.
"""

import asyncio
import sys

# psycopg's async connection pool cannot run on Windows' ProactorEventLoop.
# Set the selector policy at import time, before uvicorn or asyncio.run builds
# the event loop. This is a Windows runtime compatibility requirement, not a
# behavioural change on Linux/macOS.
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

__version__ = "1.0.0"
