"""Liveness and readiness endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Response
from fastapi.responses import JSONResponse

from market_intelligence import __version__, repository
from market_intelligence.api.deps import DatabaseDep, SettingsDep
from market_intelligence.models import ReadinessResponse

router = APIRouter(tags=["health"])


@router.get("/healthz")
async def healthz(settings: SettingsDep) -> dict[str, str]:
    return {
        "status": "ok",
        "service": "relay-market-intelligence",
        "version": __version__,
        "environment": settings.environment,
    }


@router.get(
    "/readyz",
    response_model=ReadinessResponse,
    responses={503: {"model": ReadinessResponse, "description": "Tiger Data is unreachable"}},
)
async def readyz(db: DatabaseDep, response: Response) -> JSONResponse:
    ok = await db.ping()
    checks: dict[str, str] = {"tiger_data": "ok" if ok else "unavailable"}
    warnings: list[str] = []
    if ok:
        try:
            async with db.connection() as conn:
                if await repository.market_offer_state_available(conn):
                    checks["current_offer_state"] = "ok"
                else:
                    checks["current_offer_state"] = "missing"
                    warnings.append(
                        "migration 005_market_offer_state is not applied; current-offer "
                        "reads use the legacy view and ingestion skips state upserts"
                    )
        except Exception:
            checks["current_offer_state"] = "unknown"
    response.headers["Cache-Control"] = "no-store"
    return JSONResponse(
        status_code=200 if ok else 503,
        content={
            "status": "ready" if ok else "degraded",
            "checks": checks,
            "warnings": warnings,
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
