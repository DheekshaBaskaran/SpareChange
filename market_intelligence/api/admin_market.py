"""Admin event ingestion and operator diagnostics."""

from __future__ import annotations

from fastapi import APIRouter

from market_intelligence import repository
from market_intelligence.api.deps import AdminDep, DatabaseDep, SettingsDep
from market_intelligence.errors import ApiError
from market_intelligence.models import (
    MarketEventIngestRequest,
    MarketEventIngestResponse,
)

router = APIRouter(
    prefix="/v1/admin/market",
    tags=["admin-market"],
)


@router.post("/events", response_model=MarketEventIngestResponse)
async def ingest_market_events(
    payload: MarketEventIngestRequest,
    _admin: AdminDep,
    settings: SettingsDep,
    db: DatabaseDep,
) -> MarketEventIngestResponse:
    if len(payload.events) > settings.market_event_max_batch:
        raise ApiError(
            "invalid_request",
            f"at most {settings.market_event_max_batch} events per request",
            status_code=400,
        )

    rows = [
        {
            "event_id": event.event_id,
            "event_type": event.event_type,
            "provider": event.provider,
            "provider_offer_id": event.provider_offer_id,
            "gpu_model": event.gpu_model,
            "gpu_model_normalized": event.gpu_model_normalized,
            "price_available": event.price_available,
            "previous_price_per_hour_usd": event.previous_price_per_hour_usd,
            "current_price_per_hour_usd": event.current_price_per_hour_usd,
            "price_change_percent": event.price_change_percent,
            "previous_available_gpu_count": event.previous_available_gpu_count,
            "current_available_gpu_count": event.current_available_gpu_count,
            "availability_change": event.availability_change,
            "reason": event.reason,
            "observed_at": event.observed_at,
            "actor_run_id": event.actor_run_id,
            "metadata": event.metadata,
        }
        for event in payload.events
    ]

    async with db.connection() as conn:
        stats = await repository.insert_market_events(
            conn, rows, actor_run_id=payload.actor_run_id
        )

    return MarketEventIngestResponse(
        received=len(payload.events),
        inserted=stats.inserted,
        duplicate=stats.duplicate,
    )
