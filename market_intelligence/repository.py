"""Tiger Data persistence and query layer for market intelligence."""

from __future__ import annotations

import base64
import json
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID, uuid4

from psycopg import AsyncConnection
from psycopg.types.json import Jsonb

from market_intelligence.core.freshness import freshness_state
from market_intelligence.core.normalization import (
    content_hash,
    observation_bucket,
    utc_now,
)
from market_intelligence.models import NormalizedObservation

logger = logging.getLogger(__name__)


@dataclass
class InsertStats:
    inserted: int = 0
    duplicate: int = 0
    rejected: int = 0
    state_skipped: int = 0


_state_table_supported = False


async def market_offer_state_available(conn: AsyncConnection) -> bool:
    """Report whether migration 005 has been applied for the current role.

    ``market_offer_state`` is created by an owner connection, and the runtime
    role cannot create it. Collection must keep working before that migration
    runs, so a missing table skips the current-offer upsert (reads fall back to
    the legacy view) instead of failing the ingestion transaction.
    """
    global _state_table_supported
    if _state_table_supported:
        return True
    cursor = await conn.execute(
        "SELECT to_regclass('public.market_offer_state') IS NOT NULL AS present"
    )
    row = await cursor.fetchone()
    if row is None:
        present = False
    elif isinstance(row, dict):
        present = bool(row.get("present"))
    else:
        present = bool(row[0])
    _state_table_supported = present
    if not present:
        logger.warning(
            "market_offer_state is missing; skipping current-offer upserts. "
            "Apply migrations/market_intelligence/005_market_offer_state.sql as the owner role."
        )
    return present


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def observation_fingerprint(observation: NormalizedObservation) -> str:
    return content_hash(
        {
            "provider": observation.provider,
            "provider_offer_id": observation.provider_offer_id,
            "gpu_model_normalized": observation.gpu_model_normalized,
            "gpu_count": observation.gpu_count,
            "price_per_hour": str(observation.price_per_hour),
            "price_available": observation.price_available,
            "pricing_model": observation.pricing_model,
            "region": observation.region,
            "availability_scope": observation.availability_scope,
            "available_gpu_count": observation.available_gpu_count,
        }
    )


# ---------------------------------------------------------------------------
# Ingestion runs and observations
# ---------------------------------------------------------------------------


async def find_run_by_idempotency(
    conn: AsyncConnection, provider: str, idempotency_key: str
) -> dict[str, Any] | None:
    cursor = await conn.execute(
        """
        SELECT * FROM ingestion_runs
        WHERE provider = %s AND idempotency_key = %s
        """,
        (provider, idempotency_key),
    )
    return await cursor.fetchone()


async def create_run(
    conn: AsyncConnection,
    *,
    run_id: UUID,
    provider: str,
    adapter: str,
    trigger: str,
    mode: str,
    idempotency_key: str | None,
    request_id: str | None,
) -> dict[str, Any]:
    cursor = await conn.execute(
        """
        INSERT INTO ingestion_runs
            (id, provider, adapter, trigger, mode, status, idempotency_key, request_id)
        VALUES (%s, %s, %s, %s, %s, 'running', %s, %s)
        RETURNING *
        """,
        (run_id, provider, adapter, trigger, mode, idempotency_key, request_id),
    )
    row = await cursor.fetchone()
    if row is None:
        raise RuntimeError("failed to create ingestion run")
    return row


async def get_run(conn: AsyncConnection, run_id: str) -> dict[str, Any] | None:
    cursor = await conn.execute(
        "SELECT * FROM ingestion_runs WHERE id::text = %s",
        (run_id,),
    )
    return await cursor.fetchone()


async def finish_run(
    conn: AsyncConnection,
    run_id: UUID,
    *,
    status: str,
    fetched: int,
    inserted: int,
    duplicate: int,
    rejected: int,
    errors: int,
    diagnostics: dict[str, Any],
) -> None:
    await conn.execute(
        """
        UPDATE ingestion_runs
        SET status = %s,
            finished_at = now(),
            fetched_count = %s,
            inserted_count = %s,
            duplicate_count = %s,
            rejected_count = %s,
            error_count = %s,
            diagnostics = %s
        WHERE id = %s
        """,
        (
            status,
            fetched,
            inserted,
            duplicate,
            rejected,
            errors,
            Jsonb(diagnostics),
            run_id,
        ),
    )


_STATE_UPSERT = """
    INSERT INTO market_offer_state (
        id, provider, provider_offer_id, gpu_model, gpu_model_normalized,
        gpu_count, vram_gb, cpu_cores, ram_gb, disk_gb, region, country,
        price_per_hour, price_available, pricing_model, currency,
        billing_scope, availability_scope, executable,
        available_gpu_count, capacity_scope, reliability,
        source, source_url, source_record_id, trust_tier, content_hash,
        raw_payload, metadata, observed_at, run_id
    ) VALUES (
        %s, %s, %s, %s, %s,
        %s, %s, %s, %s, %s, %s, %s,
        %s, %s, %s, %s, %s,
        %s, %s, %s, %s, %s,
        %s, %s, %s, %s, %s,
        %s, %s, %s, %s
    )
    ON CONFLICT (provider, provider_offer_id) DO UPDATE SET
        id = EXCLUDED.id,
        gpu_model = EXCLUDED.gpu_model,
        gpu_model_normalized = EXCLUDED.gpu_model_normalized,
        gpu_count = EXCLUDED.gpu_count,
        vram_gb = EXCLUDED.vram_gb,
        cpu_cores = EXCLUDED.cpu_cores,
        ram_gb = EXCLUDED.ram_gb,
        disk_gb = EXCLUDED.disk_gb,
        region = EXCLUDED.region,
        country = EXCLUDED.country,
        price_per_hour = EXCLUDED.price_per_hour,
        price_available = EXCLUDED.price_available,
        pricing_model = EXCLUDED.pricing_model,
        currency = EXCLUDED.currency,
        billing_scope = EXCLUDED.billing_scope,
        availability_scope = EXCLUDED.availability_scope,
        executable = EXCLUDED.executable,
        available_gpu_count = EXCLUDED.available_gpu_count,
        capacity_scope = EXCLUDED.capacity_scope,
        reliability = EXCLUDED.reliability,
        source = EXCLUDED.source,
        source_url = EXCLUDED.source_url,
        source_record_id = EXCLUDED.source_record_id,
        trust_tier = EXCLUDED.trust_tier,
        content_hash = EXCLUDED.content_hash,
        raw_payload = EXCLUDED.raw_payload,
        metadata = EXCLUDED.metadata,
        observed_at = EXCLUDED.observed_at,
        ingested_at = EXCLUDED.ingested_at,
        run_id = EXCLUDED.run_id
    WHERE (
        EXCLUDED.observed_at,
        (EXCLUDED.trust_tier = 'provider_api'),
        EXCLUDED.ingested_at
    ) > (
        market_offer_state.observed_at,
        (market_offer_state.trust_tier = 'provider_api'),
        market_offer_state.ingested_at
    )
"""


async def insert_observations(
    conn: AsyncConnection,
    *,
    run_id: UUID,
    observations: list[NormalizedObservation],
    bucket_seconds: int = 300,
    reobserve_seconds: int = 300,
) -> InsertStats:
    """Append observations and maintain the one-row-per-offer read model.

    The whole batch shares one transaction; each record uses a savepoint so a
    malformed row cannot roll back the rest. Current-offer state is upserted in
    one executemany call after the records are accepted, keeping reads O(offers)
    instead of O(observations).
    """
    stats = InsertStats()
    state_rows: list[tuple[Any, ...]] = []
    async with conn.transaction():
        for observation in observations:
            bucket = observation_bucket(observation.observed_at, bucket_seconds)
            observation_id = uuid4()
            fingerprint = observation_fingerprint(observation)
            try:
                async with conn.transaction():
                    if reobserve_seconds > 0:
                        unchanged = await conn.execute(
                            """
                            SELECT 1
                            FROM market_observation_keys
                            WHERE provider = %s
                              AND provider_offer_id = %s
                              AND content_hash = %s
                              AND bucket_start > %s
                            LIMIT 1
                            """,
                            (
                                observation.provider,
                                observation.provider_offer_id,
                                fingerprint,
                                bucket - timedelta(seconds=reobserve_seconds),
                            ),
                        )
                        if await unchanged.fetchone() is not None:
                            stats.duplicate += 1
                            continue
                    cursor = await conn.execute(
                        """
                        INSERT INTO market_observation_keys
                            (provider, provider_offer_id, bucket_start, observation_id, content_hash, run_id)
                        VALUES (%s, %s, %s, %s, %s, %s)
                        ON CONFLICT (provider, provider_offer_id, bucket_start) DO NOTHING
                        """,
                        (
                            observation.provider,
                            observation.provider_offer_id,
                            bucket,
                            observation_id,
                            fingerprint,
                            run_id,
                        ),
                    )
                    if cursor.rowcount == 0:
                        stats.duplicate += 1
                        continue
                    await conn.execute(
                        """
                        INSERT INTO market_observations (
                            id, provider, provider_offer_id, gpu_model, gpu_model_normalized,
                            gpu_count, vram_gb, cpu_cores, ram_gb, disk_gb, region, country,
                            price_per_hour, price_available, pricing_model, currency,
                            billing_scope, availability_scope, executable,
                            available_gpu_count, capacity_scope, reliability,
                            source, source_url, source_record_id, trust_tier, content_hash,
                            raw_payload, metadata, observed_at, ingested_at, run_id
                        ) VALUES (
                            %s, %s, %s, %s, %s,
                            %s, %s, %s, %s, %s, %s, %s,
                            %s, %s, %s, %s, %s,
                            %s, %s, %s, %s, %s,
                            %s, %s, %s, %s, %s,
                            %s, %s, %s, now(), %s
                        )
                        """,
                        (
                            observation_id,
                            observation.provider,
                            observation.provider_offer_id,
                            observation.gpu_model,
                            observation.gpu_model_normalized,
                            observation.gpu_count,
                            observation.vram_gb,
                            observation.cpu_cores,
                            observation.ram_gb,
                            observation.disk_gb,
                            observation.region,
                            observation.country,
                            observation.price_per_hour,
                            observation.price_available,
                            observation.pricing_model,
                            observation.currency,
                            observation.billing_scope,
                            observation.availability_scope,
                            observation.executable,
                            observation.available_gpu_count,
                            observation.capacity_scope,
                            observation.reliability,
                            observation.source,
                            observation.source_url,
                            observation.source_record_id,
                            observation.trust_tier,
                            fingerprint,
                            Jsonb(observation.raw_payload),
                            Jsonb(observation.metadata),
                            observation.observed_at,
                            run_id,
                        ),
                    )
                    stats.inserted += 1
                    state_rows.append(
                        (
                            observation_id,
                            observation.provider,
                            observation.provider_offer_id,
                            observation.gpu_model,
                            observation.gpu_model_normalized,
                            observation.gpu_count,
                            observation.vram_gb,
                            observation.cpu_cores,
                            observation.ram_gb,
                            observation.disk_gb,
                            observation.region,
                            observation.country,
                            observation.price_per_hour,
                            observation.price_available,
                            observation.pricing_model,
                            observation.currency,
                            observation.billing_scope,
                            observation.availability_scope,
                            observation.executable,
                            observation.available_gpu_count,
                            observation.capacity_scope,
                            observation.reliability,
                            observation.source,
                            observation.source_url,
                            observation.source_record_id,
                            observation.trust_tier,
                            fingerprint,
                            Jsonb(observation.raw_payload),
                            Jsonb(observation.metadata),
                            observation.observed_at,
                            run_id,
                        )
                    )
            except Exception:
                stats.rejected += 1
                logger.exception(
                    "failed to insert observation provider=%s offer=%s",
                    observation.provider,
                    observation.provider_offer_id,
                )
        if state_rows:
            if await market_offer_state_available(conn):
                async with conn.cursor() as cursor:
                    await cursor.executemany(_STATE_UPSERT, state_rows)
            else:
                stats.state_skipped += len(state_rows)
    return stats


async def record_provider_attempt(
    conn: AsyncConnection,
    *,
    provider: str,
    success: bool,
    run_id: UUID,
    error: str | None = None,
    skipped: bool = False,
) -> None:
    if success:
        await conn.execute(
            """
            INSERT INTO provider_health
                (provider, last_attempt_at, last_success_at, consecutive_failures, last_run_id, updated_at)
            VALUES (%s, now(), now(), 0, %s, now())
            ON CONFLICT (provider) DO UPDATE SET
                last_attempt_at = now(),
                last_success_at = now(),
                last_error = NULL,
                consecutive_failures = 0,
                last_run_id = EXCLUDED.last_run_id,
                updated_at = now()
            """,
            (provider, run_id),
        )
    elif skipped:
        await conn.execute(
            """
            INSERT INTO provider_health
                (provider, last_attempt_at, last_run_id, updated_at)
            VALUES (%s, now(), %s, now())
            ON CONFLICT (provider) DO UPDATE SET
                last_attempt_at = now(),
                last_run_id = EXCLUDED.last_run_id,
                updated_at = now()
            """,
            (provider, run_id),
        )
    else:
        await conn.execute(
            """
            INSERT INTO provider_health
                (provider, last_attempt_at, last_error_at, last_error, consecutive_failures, last_run_id, updated_at)
            VALUES (%s, now(), now(), %s, 1, %s, now())
            ON CONFLICT (provider) DO UPDATE SET
                last_attempt_at = now(),
                last_error_at = now(),
                last_error = EXCLUDED.last_error,
                consecutive_failures = provider_health.consecutive_failures + 1,
                last_run_id = EXCLUDED.last_run_id,
                updated_at = now()
            """,
            (provider, (error or "unknown provider error")[:500], run_id),
        )


# ---------------------------------------------------------------------------
# Offer reads
# ---------------------------------------------------------------------------

_OFFER_COLUMNS = """
    id::text AS id,
    provider,
    provider_offer_id,
    gpu_model,
    gpu_model_normalized,
    gpu_count,
    vram_gb::float8 AS vram_gb,
    cpu_cores::float8 AS cpu_cores,
    ram_gb::float8 AS ram_gb,
    disk_gb::float8 AS disk_gb,
    region,
    country,
    price_per_hour_minor,
    price_per_hour_micros,
    price_per_gpu_hour_minor,
    price_per_gpu_hour_micros,
    currency,
    billing_scope,
    availability_scope,
    executable,
    price_available,
    pricing_model,
    available_gpu_count,
    capacity_scope,
    source,
    source_url,
    source_record_id,
    trust_tier,
    freshness,
    observed_at,
    expires_at,
    ingested_at,
    reliability::float8 AS reliability,
    raw_hash,
    metadata
"""


@dataclass
class OfferFilters:
    provider: str | None = None
    gpu_model: str | None = None
    gpu_match: str = "exact"
    min_vram_gb: float | None = None
    max_price_per_gpu_hour_minor: int | None = None
    region: str | None = None
    country: str | None = None
    availability_scope: str | None = None
    executable: bool | None = None
    include_unpriced: bool = False
    freshness: list[str] | None = None
    include_stale: bool = False
    sort: str = "price"
    limit: int = 50
    cursor: str | None = None


def encode_cursor(sort: str, values: list[Any]) -> str:
    payload = {"s": sort, "v": values}
    return base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode()


def decode_cursor(cursor: str, sort: str) -> list[Any]:
    try:
        payload = json.loads(base64.urlsafe_b64decode(cursor.encode()).decode())
    except Exception as exc:
        from market_intelligence.errors import ApiError

        raise ApiError("invalid_cursor", "cursor is not valid", status_code=400) from exc
    if payload.get("s") != sort or not isinstance(payload.get("v"), list):
        from market_intelligence.errors import ApiError

        raise ApiError("invalid_cursor", "cursor does not match the requested sort", status_code=400)
    return payload["v"]


async def fetch_offers(
    conn: AsyncConnection, filters: OfferFilters
) -> tuple[list[dict[str, Any]], str | None]:
    where: list[str] = []
    params: list[Any] = []

    fresh_states = filters.freshness
    if filters.include_stale:
        fresh_states = ["fresh", "stale", "expired"]
    if not fresh_states:
        fresh_states = ["fresh", "stale"]
    where.append("freshness = ANY(%s)")
    params.append(fresh_states)

    if filters.provider:
        where.append("provider = %s")
        params.append(filters.provider)
    if filters.gpu_model:
        if filters.gpu_match == "contains":
            where.append("gpu_model_normalized ILIKE %s")
            params.append(f"%{filters.gpu_model}%")
        else:
            where.append("lower(gpu_model_normalized) = lower(%s)")
            params.append(filters.gpu_model)
    if filters.min_vram_gb is not None:
        where.append("vram_gb >= %s")
        params.append(filters.min_vram_gb)
    if filters.max_price_per_gpu_hour_minor is not None:
        where.append("price_per_gpu_hour_minor <= %s")
        params.append(filters.max_price_per_gpu_hour_minor)
    if filters.region:
        where.append("region ILIKE %s")
        params.append(f"%{filters.region}%")
    if filters.country:
        where.append("country = %s")
        params.append(filters.country.upper())
    if filters.availability_scope:
        where.append("availability_scope = %s")
        params.append(filters.availability_scope)
    if filters.executable is not None:
        where.append("executable = %s")
        params.append(filters.executable)
    if not filters.include_unpriced:
        where.append("price_available = true")

    if filters.sort == "price":
        order = "(NOT price_available) ASC, price_per_gpu_hour_micros ASC, provider ASC, provider_offer_id ASC"
        comparison = (
            "((NOT price_available), price_per_gpu_hour_micros, provider, provider_offer_id) "
            "> (%s, %s, %s, %s)"
        )
    elif filters.sort == "observed_at":
        order = "observed_at DESC, provider DESC, provider_offer_id DESC"
        comparison = "(observed_at, provider, provider_offer_id) < (%s::timestamptz, %s, %s)"
    elif filters.sort == "reliability":
        order = "COALESCE(reliability, -1) DESC, provider DESC, provider_offer_id DESC"
        comparison = "(COALESCE(reliability, -1), provider, provider_offer_id) < (%s, %s, %s)"
    else:
        from market_intelligence.errors import ApiError

        raise ApiError("invalid_request", "unsupported sort", status_code=400)

    if filters.cursor:
        values = decode_cursor(filters.cursor, filters.sort)
        expected = 4 if filters.sort == "price" else 3
        if len(values) != expected:
            from market_intelligence.errors import ApiError

            raise ApiError("invalid_cursor", "cursor is malformed", status_code=400)
        if filters.sort == "price":
            values[0] = bool(values[0])
            values[1] = int(values[1])
        elif filters.sort == "observed_at":
            try:
                values[0] = datetime.fromisoformat(str(values[0]).replace("Z", "+00:00"))
            except ValueError as exc:
                from market_intelligence.errors import ApiError

                raise ApiError("invalid_cursor", "cursor timestamp is malformed", status_code=400) from exc
        else:
            values[0] = float(values[0])
        where.append(comparison)
        params.extend(values)

    sql = f"""
        SELECT {_OFFER_COLUMNS}
        FROM market_offers_current
        WHERE {' AND '.join(where)}
        ORDER BY {order}
        LIMIT %s
    """
    params.append(filters.limit + 1)
    cursor = await conn.execute(sql, params)
    rows = list(await cursor.fetchall())

    next_cursor: str | None = None
    if len(rows) > filters.limit:
        rows = rows[: filters.limit]
        last = rows[-1]
        if filters.sort == "price":
            values = [
                not last["price_available"],
                last["price_per_gpu_hour_micros"],
                last["provider"],
                last["provider_offer_id"],
            ]
        elif filters.sort == "observed_at":
            values = [
                _as_utc(last["observed_at"]).isoformat().replace("+00:00", "Z"),
                last["provider"],
                last["provider_offer_id"],
            ]
        else:
            values = [
                last["reliability"] if last["reliability"] is not None else -1,
                last["provider"],
                last["provider_offer_id"],
            ]
        next_cursor = encode_cursor(filters.sort, values)
    return rows, next_cursor


async def fetch_offer(conn: AsyncConnection, offer_id: str) -> dict[str, Any] | None:
    cursor = await conn.execute(
        f"SELECT {_OFFER_COLUMNS} FROM market_offers_current WHERE id::text = %s",
        (offer_id,),
    )
    return await cursor.fetchone()


# ---------------------------------------------------------------------------
# Historical analytics
# ---------------------------------------------------------------------------

BUCKET_INTERVALS = {
    "15m": "15 minutes",
    "1h": "1 hour",
    "6h": "6 hours",
    "1d": "1 day",
}

SUMMARY_WINDOWS = {"1h": "1 hour", "24h": "24 hours", "7d": "7 days", "30d": "30 days"}


async def fetch_history(
    conn: AsyncConnection,
    *,
    gpu_model: str,
    provider: str | None,
    bucket: str,
    from_ts: datetime,
    to_ts: datetime,
    currency: str = "USD",
) -> list[dict[str, Any]]:
    interval = BUCKET_INTERVALS[bucket]
    cursor = await conn.execute(
        """
        SELECT
            time_bucket(%s::interval, observed_at) AS bucket_start,
            min(gpu_model_normalized) AS gpu_model_normalized,
            count(*)::int AS sample_count,
            ROUND(min(price_per_hour) * 1000000)::bigint AS min_micros,
            ROUND(percentile_cont(0.25) WITHIN GROUP (ORDER BY price_per_hour) * 1000000)::bigint AS p25_micros,
            ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY price_per_hour) * 1000000)::bigint AS median_micros,
            ROUND(percentile_cont(0.75) WITHIN GROUP (ORDER BY price_per_hour) * 1000000)::bigint AS p75_micros,
            ROUND(max(price_per_hour) * 1000000)::bigint AS max_micros,
            ROUND(avg(price_per_hour) * 1000000)::bigint AS avg_micros
        FROM market_observations
        WHERE lower(gpu_model_normalized) = lower(%s)
          AND observed_at >= %s
          AND observed_at < %s
          AND currency = %s
          AND executable = false
          AND price_available = true
          AND (%s::text IS NULL OR provider = %s)
        GROUP BY 1
        ORDER BY 1
        """,
        (interval, gpu_model, from_ts, to_ts, currency, provider, provider),
    )
    return list(await cursor.fetchall())


async def fetch_summary(
    conn: AsyncConnection,
    *,
    window: str,
    limit: int,
    provider: str | None = None,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    interval = SUMMARY_WINDOWS[window]
    cursor = await conn.execute(
        """
        SELECT
            count(*)::int AS total,
            count(*) FILTER (WHERE freshness = 'fresh')::int AS fresh,
            count(DISTINCT provider)::int AS providers,
            count(*) FILTER (WHERE executable)::int AS executable,
            count(*) FILTER (WHERE price_available)::int AS priced,
            count(*) FILTER (WHERE NOT price_available)::int AS unpriced
        FROM market_offers_current
        WHERE (%s::text IS NULL OR provider = %s)
        """,
        (provider, provider),
    )
    totals = await cursor.fetchone()
    if totals is None:
        totals = {
            "total": 0,
            "fresh": 0,
            "providers": 0,
            "executable": 0,
            "priced": 0,
            "unpriced": 0,
        }

    cursor = await conn.execute(
        """
        WITH current AS (
            SELECT * FROM market_offers_current
            WHERE freshness IN ('fresh', 'stale')
              AND price_available = true
              AND (%s::text IS NULL OR provider = %s)
        ),
        windowed AS (
            SELECT *,
                observed_at >= now() - %s::interval AS in_window,
                observed_at >= now() - (%s::interval * 2)
                    AND observed_at < now() - %s::interval AS in_prev
            FROM current
        )
        SELECT
            gpu_model_normalized,
            count(DISTINCT provider) FILTER (WHERE in_window)::int AS provider_count,
            count(*) FILTER (WHERE in_window)::int AS fresh_offer_count,
            ROUND(
                percentile_cont(0.5) WITHIN GROUP (ORDER BY price_per_gpu_hour_micros)
                FILTER (WHERE in_window)
            )::bigint AS median_now,
            MIN(price_per_gpu_hour_micros) FILTER (WHERE in_window)::bigint AS min_now,
            ROUND(
                percentile_cont(0.5) WITHIN GROUP (ORDER BY price_per_gpu_hour_micros)
                FILTER (WHERE in_prev)
            )::bigint AS median_prev
        FROM windowed
        GROUP BY gpu_model_normalized
        HAVING count(*) FILTER (WHERE in_window) > 0
        ORDER BY fresh_offer_count DESC, gpu_model_normalized ASC
        LIMIT %s
        """,
        (provider, provider, interval, interval, interval, limit),
    )
    return totals, list(await cursor.fetchall())


# ---------------------------------------------------------------------------
# Provider registry and freshness
# ---------------------------------------------------------------------------


async def fetch_providers(conn: AsyncConnection) -> list[dict[str, Any]]:
    cursor = await conn.execute(
        """
        SELECT
            s.provider,
            s.display_name,
            s.enabled,
            s.collection_mode,
            s.trust_tier,
            s.freshness_ttl_seconds,
            h.last_attempt_at,
            h.last_success_at,
            h.last_error_at,
            COALESCE(h.consecutive_failures, 0)::int AS consecutive_failures,
            h.last_run_id::text AS last_run_id
        FROM market_sources s
        LEFT JOIN provider_health h ON h.provider = s.provider
        ORDER BY s.provider
        """
    )
    return list(await cursor.fetchall())


async def insert_market_events(
    conn: AsyncConnection, events: list[dict[str, Any]], *, actor_run_id: str | None = None
) -> InsertStats:
    """Insert Actor events idempotently.

    Each event uses a deterministic event_id. A retry or a webhook replay
    therefore reports duplicates rather than appending a second event.
    """
    stats = InsertStats()
    for event in events:
        cursor = await conn.execute(
            """
            INSERT INTO market_events (
                event_id, event_type, provider, provider_offer_id, gpu_model,
                gpu_model_normalized, price_available, previous_price_per_hour,
                current_price_per_hour, price_change_percent,
                previous_available_gpu_count, current_available_gpu_count,
                availability_change, reason, observed_at, actor_run_id,
                source, metadata
            ) VALUES (
                %s, %s, %s, %s, %s,
                %s, %s, %s,
                %s, %s,
                %s, %s,
                %s, %s, %s, %s,
                %s, %s
            )
            ON CONFLICT (event_id) DO NOTHING
            """,
            (
                event["event_id"],
                event["event_type"],
                event["provider"],
                event["provider_offer_id"],
                event["gpu_model"],
                event["gpu_model_normalized"],
                event["price_available"],
                event.get("previous_price_per_hour_usd"),
                event.get("current_price_per_hour_usd"),
                event.get("price_change_percent"),
                event.get("previous_available_gpu_count"),
                event.get("current_available_gpu_count"),
                event.get("availability_change"),
                event["reason"],
                event["observed_at"],
                actor_run_id or event.get("actor_run_id"),
                event.get("source") or "apify_actor",
                Jsonb(event.get("metadata") or {}),
            ),
        )
        if cursor.rowcount:
            stats.inserted += 1
        else:
            stats.duplicate += 1
    return stats


async def fetch_events(
    conn: AsyncConnection,
    *,
    provider: str | None = None,
    event_type: str | None = None,
    gpu_model: str | None = None,
    since: datetime | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    where = ["1 = 1"]
    params: list[Any] = []
    if provider:
        where.append("provider = %s")
        params.append(provider)
    if event_type:
        where.append("event_type = %s")
        params.append(event_type)
    if gpu_model:
        where.append("lower(gpu_model_normalized) = lower(%s)")
        params.append(gpu_model)
    if since:
        where.append("observed_at >= %s")
        params.append(since)
    params.append(limit)
    cursor = await conn.execute(
        f"""
        SELECT
            event_id, event_type, provider, provider_offer_id, gpu_model,
            gpu_model_normalized, price_available,
            ROUND(previous_price_per_hour * 1000000)::bigint
                AS previous_price_per_hour_micros,
            ROUND(current_price_per_hour * 1000000)::bigint
                AS current_price_per_hour_micros,
            price_change_percent::float8 AS price_change_percent,
            previous_available_gpu_count, current_available_gpu_count,
            availability_change, reason, observed_at, actor_run_id, metadata
        FROM market_events
        WHERE {' AND '.join(where)}
        ORDER BY observed_at DESC, event_id ASC
        LIMIT %s
        """,
        params,
    )
    return list(await cursor.fetchall())


async def fetch_freshness(conn: AsyncConnection) -> list[dict[str, Any]]:
    cursor = await conn.execute(
        """
        WITH counts AS (
            SELECT
                provider,
                count(*) FILTER (WHERE freshness = 'fresh')::int AS fresh_offer_count,
                count(*) FILTER (WHERE freshness = 'stale')::int AS stale_offer_count,
                min(observed_at) FILTER (WHERE freshness = 'fresh') AS oldest_fresh_observed_at
            FROM market_offers_current
            GROUP BY provider
        )
        SELECT
            s.provider,
            s.display_name,
            s.enabled,
            s.freshness_ttl_seconds,
            h.last_attempt_at,
            h.last_success_at,
            h.last_error_at,
            COALESCE(h.consecutive_failures, 0)::int AS consecutive_failures,
            h.last_run_id::text AS last_run_id,
            COALESCE(c.fresh_offer_count, 0)::int AS fresh_offer_count,
            COALESCE(c.stale_offer_count, 0)::int AS stale_offer_count,
            c.oldest_fresh_observed_at
        FROM market_sources s
        LEFT JOIN provider_health h ON h.provider = s.provider
        LEFT JOIN counts c ON c.provider = s.provider
        ORDER BY s.provider
        """
    )
    rows = list(await cursor.fetchall())
    now = utc_now()
    for row in rows:
        if not row["enabled"]:
            row["state"] = "disabled"
        elif row["consecutive_failures"] and row["consecutive_failures"] >= 3:
            row["state"] = "failed"
        elif row["last_success_at"] is None:
            row["state"] = (
                "failed" if row["consecutive_failures"] else "never_ingested"
            )
        elif row["consecutive_failures"] and row["consecutive_failures"] > 0:
            row["state"] = "degraded"
        elif (
            now - _as_utc(row["last_success_at"])
        ).total_seconds() > row["freshness_ttl_seconds"] * 2:
            row["state"] = "degraded"
        else:
            row["state"] = "healthy"
    return rows
