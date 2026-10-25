"""Response assembly for market offers, history, summary, and freshness."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from market_intelligence.config import Settings
from market_intelligence.core.normalization import normalize_gpu_model, utc_now
from market_intelligence.models import (
    MarketEvent,
    MarketEventPage,
    FreshnessReport,
    GpuSummary,
    MarketOffer,
    MarketOfferPage,
    MarketSummary,
    OfferCounts,
    PriceHistory,
    PricePoint,
    PriceTrend,
    ProviderFreshness,
    ProviderRecord,
)
from market_intelligence.providers.registry import provider_metadata


def build_offer_page(
    rows: list[dict[str, Any]],
    *,
    next_cursor: str | None,
    filters: dict[str, Any],
) -> MarketOfferPage:
    return MarketOfferPage(
        items=[MarketOffer(**row) for row in rows],
        next_cursor=next_cursor,
        generated_at=utc_now(),
        filters=filters,
    )


def build_history(
    rows: list[dict[str, Any]],
    *,
    gpu_model: str,
    provider: str | None,
    bucket: str,
    currency: str,
    from_ts: datetime,
    to_ts: datetime,
) -> PriceHistory:
    points = [
        PricePoint(
            bucket_start=row["bucket_start"],
            sample_count=row["sample_count"],
            min_price_per_hour_micros=row["min_micros"],
            p25_price_per_hour_micros=row["p25_micros"],
            median_price_per_hour_micros=row["median_micros"],
            p75_price_per_hour_micros=row["p75_micros"],
            max_price_per_hour_micros=row["max_micros"],
            avg_price_per_hour_micros=row["avg_micros"],
        )
        for row in rows
    ]
    first = rows[0]["median_micros"] if rows else None
    last = rows[-1]["median_micros"] if rows else None
    direction: str = "flat"
    change_micros = 0
    change_percent: float | None = None
    if first is not None and last is not None:
        change_micros = int(last - first)
        if change_micros > 0:
            direction = "up"
        elif change_micros < 0:
            direction = "down"
        if first:
            change_percent = round(change_micros / first * 100, 2)

    canonical = (
        rows[0].get("gpu_model_normalized") if rows and rows[0].get("gpu_model_normalized") else None
    )
    return PriceHistory(
        gpu_model=gpu_model,
        gpu_model_normalized=canonical or normalize_gpu_model(gpu_model),
        provider=provider,
        currency=currency,
        bucket=bucket,
        from_=from_ts,
        to=to_ts,
        points=points,
        trend=PriceTrend(
            direction=direction,
            change_micros=change_micros,
            change_percent=change_percent,
            first_median_micros=first,
            last_median_micros=last,
        ),
    )


def build_summary(
    totals: dict[str, Any],
    rows: list[dict[str, Any]],
    *,
    window: str,
    currency: str = "USD",
) -> MarketSummary:
    gpus: list[GpuSummary] = []
    for row in rows:
        median_now = row["median_now"]
        median_prev = row["median_prev"]
        change_percent = None
        if median_prev and median_now is not None:
            change_percent = round((median_now - median_prev) / median_prev * 100, 2)
        gpus.append(
            GpuSummary(
                gpu_model_normalized=row["gpu_model_normalized"],
                provider_count=row["provider_count"],
                fresh_offer_count=row["fresh_offer_count"],
                median_price_per_gpu_hour_micros=median_now,
                min_price_per_gpu_hour_micros=row["min_now"],
                change_percent=change_percent,
            )
        )
    return MarketSummary(
        generated_at=utc_now(),
        window=window,
        currency=currency,
        offers=OfferCounts(
            total=totals.get("total", 0),
            fresh=totals.get("fresh", 0),
            providers=totals.get("providers", 0),
            executable=totals.get("executable", 0),
            priced=totals.get("priced", 0),
            unpriced=totals.get("unpriced", 0),
        ),
        gpus=gpus,
    )


def build_providers(rows: list[dict[str, Any]], settings: Settings) -> list[ProviderRecord]:
    records: list[ProviderRecord] = []
    for row in rows:
        meta = provider_metadata(row["provider"])
        row_data = {key: value for key, value in row.items() if key != "enabled"}
        records.append(
            ProviderRecord(
                **row_data,
                enabled=settings.provider_enabled(row["provider"]),
                status=meta.status,
                pricing_model=meta.pricing_model,
                requires_credentials=meta.requires_credentials,
            )
        )
    return records


def build_freshness(rows: list[dict[str, Any]], settings: Settings) -> FreshnessReport:
    providers: list[ProviderFreshness] = []
    for row in rows:
        meta = provider_metadata(row["provider"])
        enabled = settings.provider_enabled(row["provider"])
        state = row["state"]
        if not enabled:
            state = "disabled"
        providers.append(
            ProviderFreshness(
                provider=row["provider"],
                display_name=row["display_name"],
                enabled=enabled,
                status=meta.status,
                pricing_model=meta.pricing_model,
                last_attempt_at=row["last_attempt_at"],
                last_success_at=row["last_success_at"],
                last_error_at=row["last_error_at"],
                consecutive_failures=row["consecutive_failures"],
                fresh_offer_count=row["fresh_offer_count"],
                stale_offer_count=row["stale_offer_count"],
                oldest_fresh_observed_at=row["oldest_fresh_observed_at"],
                last_run_id=row["last_run_id"],
                state=state,
            )
        )
    return FreshnessReport(providers=providers, generated_at=utc_now())


def build_events(rows: list[dict[str, Any]]) -> MarketEventPage:
    return MarketEventPage(
        items=[MarketEvent(**row) for row in rows],
        generated_at=utc_now(),
    )
