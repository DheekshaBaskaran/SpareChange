"""Liveness and readiness endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Response
from fastapi.responses import JSONResponse

from market_intelligence import __version__
from market_intelligence.api.deps import DatabaseDep, SettingsDep

router = APIRouter(tags=["health"])


@router.get("/healthz")
async def healthz(settings: SettingsDep) -> dict[str, str]:
    return {
        "status": "ok",
        "service": "relay-market-intelligence",
        "version": __version__,
        "environment": settings.environment,
    }


@router.get("/readyz")
async def readyz(db: DatabaseDep, response: Response) -> JSONResponse:
    ok = await db.ping()
    response.headers["Cache-Control"] = "no-store"
    return JSONResponse(
        status_code=200 if ok else 503,
        content={
            "status": "ready" if ok else "degraded",
            "checks": {"tiger_data": "ok" if ok else "unavailable"},
            "version": __version__,
        },
    )


@router.get("/")
async def service_info(settings: SettingsDep) -> dict[str, str]:
    return {
        "service": "relay-market-intelligence",
        "version": __version__,
        "docs": "/docs",
        "openapi": "/openapi.json",
        "contract": "docs/MARKET_INTELLIGENCE_INTERFACE.md",
        "trust_model": "public listings are reference prices; executable capacity requires authorization",
    }
