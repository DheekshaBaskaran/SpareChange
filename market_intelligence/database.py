"""Async connection handling for Tiger Data."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

from psycopg import AsyncConnection
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from market_intelligence.config import Settings

logger = logging.getLogger(__name__)


class Database:
    """Thin lifecycle wrapper around a psycopg async pool."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self.pool: AsyncConnectionPool | None = None

    async def connect(self) -> None:
        if not self._settings.database_url:
            logger.warning("DATABASE_URL is not set; market APIs will return 503 until configured")
            return
        pool = AsyncConnectionPool(
            conninfo=self._settings.database_url,
            min_size=self._settings.database_pool_min,
            max_size=self._settings.database_pool_max,
            timeout=15,
            open=False,
            kwargs={"row_factory": dict_row},
        )
        await pool.open(wait=False)
        self.pool = pool

    async def close(self) -> None:
        if self.pool is not None:
            await self.pool.close()
            self.pool = None

    @asynccontextmanager
    async def connection(self) -> AsyncIterator[AsyncConnection]:
        if self.pool is None:
            from market_intelligence.errors import ApiError

            raise ApiError(
                "database_unavailable",
                "Tiger Data is not configured (DATABASE_URL missing)",
                status_code=503,
            )
        try:
            async with self.pool.connection() as connection:
                yield connection
        except Exception as exc:
            from psycopg_pool import PoolTimeout
            from psycopg import OperationalError

            if isinstance(exc, (PoolTimeout, OperationalError)):
                from market_intelligence.errors import ApiError

                logger.exception("Tiger Data connection failed")
                raise ApiError(
                    "database_unavailable",
                    "Tiger Data is unreachable",
                    status_code=503,
                ) from exc
            raise

    async def ping(self) -> bool:
        try:
            async with self.connection() as connection:
                await connection.execute("SELECT 1")
            return True
        except Exception:
            logger.warning("Tiger Data readiness check failed", exc_info=True)
            return False
