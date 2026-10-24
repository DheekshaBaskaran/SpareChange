"""Public read-only market intelligence endpoints."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Query, Response

from market_intelligence import repository
from market_intelligence.api.deps import DatabaseDep
from market_intelligence.core.analytics import (
    build_freshness,
    build_history,
    build_offer_page,
    build_providers,
    build_summary,
)
from market_intelligence.core.normalization import ensure_utc, utc_now
from market_intelligence.errors import ApiError
from market_intelligence.models import (
    FreshnessReport,
    MarketOffer,
    MarketOfferPage,
    MarketSummary,
    PriceHistory,
    ProviderRecord,
    PROVIDERS,
)
from market_intelligence.repository import BUCKET_INTERVALS, SUMMARY_WINDOWS, OfferFilters

router = APIRouter(prefix="/v1/market", tags=["market"])


def _no_store(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"


@router.get("/offers", response_model=MarketOfferPage)
async def list_offers(
    response: Response,
    db: DatabaseDep,
    provider: Annotated[str | None, Query()] = None,
    gpu_model: Annotated[str | None, Query(max_length=80)] = None,
    gpu_match: Annotated[Literal["exact", "contains"], Query()] = "exact",
    min_vram_gb: Annotated[float | None, Query(ge=0)] = None,
    max_price_per_gpu_hour_minor: Annotated[int | None, Query(ge=0)] = None,
    region: Annotated[str | None, Query(max_length=120)] = None,
    country: Annotated[str | None, Query(min_length=2, max_length=2)] = None,
    availability_scope: Annotated[
        Literal["live_inventory", "advertised"] | None, Query()
    ] = None,
    executable: Annotated[bool | None, Query()] = None,
    freshness: Annotated[str | None, Query()] = None,
    include_stale: Annotated[bool, Query()] = False,
    sort: Annotated[Literal["price", "observed_at", "reliability"], Query()] = "price",
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    cursor: Annotated[str | None, Query()] = None,
) -> MarketOfferPage:
    _no_store(response)
    if provider and provider not in PROVIDERS:
        raise ApiError("provider_not_found", f"unknown provider: {provider}", status_code=404)

    freshness_states: list[str] | None = None
    if freshness:
        freshness_states = [item.strip() for item in freshness.split(",") if item.strip()]
        invalid = [item for item in freshness_states if item not in {"fresh", "stale", "expired"}]
        if invalid:
            raise ApiError(
                "invalid_request",
                "freshness must contain fresh, stale, or expired",
                status_code=400,
                details={"invalid": invalid},
            )

    filters = OfferFilters(
        provider=provider,
        gpu_model=gpu_model,
        gpu_match=gpu_match,
        min_vram_gb=min_vram_gb,
        max_price_per_gpu_hour_minor=max_price_per_gpu_hour_minor,
        region=region,
        country=country,
        availability_scope=availability_scope,
        executable=executable,
        freshness=freshness_states,
        include_stale=include_stale,
        sort=sort,
        limit=limit,
        cursor=cursor,
    )
    async with db.connection() as conn:
        rows, next_cursor = await repository.fetch_offers(conn, filters)
    return build_offer_page(
        rows,
        next_cursor=next_cursor,
        filters={
            key: value
            for key, value in {
                "provider": provider,
                "gpu_model": gpu_model,
                "gpu_match": gpu_match,
                "freshness": freshness_states,
                "sort": sort,
            }.items()
            if value is not None
        },
    )


@router.get("/offers/{offer_id}", response_model=MarketOffer)
async def get_offer(offer_id: str, response: Response, db: DatabaseDep) -> MarketOffer:
    _no_store(response)
    async with db.connection() as conn:
        row = await repository.fetch_offer(conn, offer_id)
    if row is None:
        raise ApiError("offer_not_found", "offer not found", status_code=404)
    return MarketOffer(**row)


@router.get("/history", response_model=PriceHistory)
async def get_history(
    response: Response,
    db: DatabaseDep,
    gpu_model: Annotated[str, Query(min_length=1, max_length=80)],
    provider: Annotated[str | None, Query()] = None,
    bucket: Annotated[Literal["15m", "1h", "6h", "1d"], Query()] = "15m",
    from_ts: Annotated[datetime | None, Query(alias="from")] = None,
    to_ts: Annotated[datetime | None, Query(alias="to")] = None,
    currency: Annotated[str, Query(min_length=3, max_length=3)] = "USD",
) -> PriceHistory:
    _no_store(response)
    if provider and provider not in PROVIDERS:
        raise ApiError("provider_not_found", f"unknown provider: {provider}", status_code=404)

    now = utc_now()
    to_value = ensure_utc(to_ts) if to_ts else now
    from_value = ensure_utc(from_ts) if from_ts else to_value - timedelta(hours=24)
    if from_value >= to_value:
        raise ApiError("invalid_time_range", "from must be before to", status_code=400)
    if to_value - from_value > timedelta(days=90):
        raise ApiError("invalid_time_range", "history window exceeds 90 days", status_code=400)
    if to_value > now + timedelta(minutes=5):
        raise ApiError("invalid_time_range", "to must not be in the future", status_code=400)

    async with db.connection() as conn:
        rows = await repository.fetch_history(
            conn,
            gpu_model=gpu_model,
            provider=provider,
            bucket=bucket,
            from_ts=from_value,
            to_ts=to_value,
            currency=currency.upper(),
        )
    return build_history(
        rows,
        gpu_model=gpu_model,
        provider=provider,
        bucket=bucket,
        currency=currency.upper(),
        from_ts=from_value,
        to_ts=to_value,
    )


@router.get("/summary", response_model=MarketSummary)
async def get_summary(
    response: Response,
    db: DatabaseDep,
    window: Annotated[Literal["1h", "24h", "7d", "30d"], Query()] = "24h",
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    provider: Annotated[str | None, Query()] = None,
) -> MarketSummary:
    _no_store(response)
    if provider and provider not in PROVIDERS:
        raise ApiError("provider_not_found", f"unknown provider: {provider}", status_code=404)
    async with db.connection() as conn:
        totals, rows = await repository.fetch_summary(
            conn, window=window, limit=limit, provider=provider
        )
    return build_summary(totals, rows, window=window)


@router.get("/providers", response_model=list[ProviderRecord])
async def get_providers(response: Response, db: DatabaseDep) -> list[ProviderRecord]:
    _no_store(response)
    async with db.connection() as conn:
        rows = await repository.fetch_providers(conn)
    return build_providers(rows)


@router.get("/freshness", response_model=FreshnessReport)
async def get_freshness(response: Response, db: DatabaseDep) -> FreshnessReport:
    _no_store(response)
    async with db.connection() as conn:
        rows = await repository.fetch_freshness(conn)
    return build_freshness(rows)
