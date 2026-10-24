"""Ingestion orchestration: fetch, normalize, validate, deduplicate, persist."""

from __future__ import annotations

import logging
from typing import Any
from uuid import UUID, uuid4

import httpx
from psycopg import errors as pg_errors

from market_intelligence import repository
from market_intelligence.config import Settings
from market_intelligence.database import Database
from market_intelligence.errors import ApiError, ProviderCredentialsMissing, ProviderError
from market_intelligence.models import (
    IngestionRunDetail,
    IngestionRunSummary,
    NormalizedObservation,
)
from market_intelligence.providers.apify_actor import ApifyActorClient, actor_item_to_observation
from market_intelligence.providers.registry import PROVIDER_KEYS, build_adapter

logger = logging.getLogger(__name__)


def _summary_from_row(row: dict[str, Any]) -> IngestionRunSummary:
    return IngestionRunSummary(
        run_id=str(row["id"]),
        provider=row["provider"],
        status=row["status"],
        started_at=row["started_at"],
        finished_at=row["finished_at"],
        fetched=row["fetched_count"],
        inserted=row["inserted_count"],
        duplicate=row["duplicate_count"],
        rejected=row["rejected_count"],
        errors=row["error_count"],
    )


def detail_from_row(row: dict[str, Any]) -> IngestionRunDetail:
    return IngestionRunDetail(
        run_id=str(row["id"]),
        provider=row["provider"],
        status=row["status"],
        started_at=row["started_at"],
        finished_at=row["finished_at"],
        fetched=row["fetched_count"],
        inserted=row["inserted_count"],
        duplicate=row["duplicate_count"],
        rejected=row["rejected_count"],
        errors=row["error_count"],
        adapter=row["adapter"],
        trigger=row["trigger"],
        idempotency_key=row["idempotency_key"],
        request_id=row["request_id"],
        diagnostics=row["diagnostics"] or {},
    )


async def run_ingestion(
    *,
    settings: Settings,
    db: Database,
    client: httpx.AsyncClient,
    provider: str,
    mode: str,
    limit: int,
    trigger: str = "api",
    idempotency_key: str | None = None,
    request_id: str | None = None,
    items: list[dict[str, Any]] | None = None,
    apify_actor_id: str | None = None,
    apify_input: dict[str, Any] | None = None,
) -> IngestionRunSummary:
    if provider not in PROVIDER_KEYS:
        raise ApiError(
            "provider_not_found",
            f"unknown provider: {provider}",
            status_code=404,
            details={"provider": provider},
        )
    limit = max(1, min(limit, settings.market_max_ingest_items))

    if idempotency_key:
        async with db.connection() as conn:
            existing = await repository.find_run_by_idempotency(conn, provider, idempotency_key)
        if existing:
            return _summary_from_row(existing)

    run_id = uuid4()
    adapter_name = {
        "direct": provider,
        "apify": "apify_actor",
        "items": "actor_items",
    }.get(mode, mode)

    async with db.connection() as conn:
        try:
            await repository.create_run(
                conn,
                run_id=run_id,
                provider=provider,
                adapter=adapter_name,
                trigger=trigger,
                mode=mode,
                idempotency_key=idempotency_key,
                request_id=request_id,
            )
        except pg_errors.UniqueViolation:
            existing = await repository.find_run_by_idempotency(conn, provider, idempotency_key or "")
            if existing:
                return _summary_from_row(existing)
            raise

    observations: list[NormalizedObservation] = []
    fetched = 0
    rejected = 0
    errors = 0
    diagnostics: dict[str, Any] = {"provider": provider, "mode": mode}
    status = "succeeded"

    try:
        if mode == "direct":
            adapter = build_adapter(provider, settings, client)
            outcome = await adapter.fetch(limit)
            observations = outcome.items
            fetched = outcome.fetched
            rejected = outcome.rejected
            diagnostics.update(outcome.diagnostics)
            diagnostics["adapter"] = adapter_name
        elif mode == "apify":
            actor = ApifyActorClient(settings, client)
            raw_items, actor_diagnostics = await actor.run_and_fetch(
                provider,
                limit,
                actor_id=apify_actor_id,
                actor_input=apify_input,
            )
            fetched = len(raw_items)
            observations, rejected, reasons = _normalize_actor_items(
                raw_items, provider=provider, actor_run_id=actor_diagnostics.get("run_id")
            )
            diagnostics.update(actor_diagnostics)
            diagnostics["rejected_reasons"] = reasons
        elif mode == "items":
            raw_items = items or []
            fetched = len(raw_items)
            observations, rejected, reasons = _normalize_actor_items(
                raw_items, provider=provider, actor_run_id=None
            )
            diagnostics["rejected_reasons"] = reasons
        else:
            raise ApiError("invalid_request", f"unsupported ingestion mode: {mode}", status_code=400)
    except ProviderCredentialsMissing as exc:
        status = "skipped"
        rejected = 0
        diagnostics["skipped"] = exc.diagnostics()
        logger.info("provider collection skipped provider=%s reason=%s", provider, exc.message)
    except ProviderError as exc:
        status = "failed"
        errors = 1
        diagnostics["error"] = exc.diagnostics()
        logger.warning("provider collection failed provider=%s error=%s", provider, exc.message)
    except ApiError:
        raise
    except Exception as exc:  # defensive: never leave a run stuck in "running"
        status = "failed"
        errors = 1
        diagnostics["error"] = {
            "code": "internal_error",
            "message": type(exc).__name__,
        }
        logger.exception("unexpected ingestion failure provider=%s", provider)

    insert_stats = repository.InsertStats()
    if observations and status not in {"failed", "skipped"}:
        try:
            async with db.connection() as conn:
                insert_stats = await repository.insert_observations(
                    conn,
                    run_id=run_id,
                    observations=observations,
                    bucket_seconds=settings.market_observation_bucket_seconds,
                )
        except Exception as exc:
            logger.exception("failed to persist ingestion results provider=%s", provider)
            status = "failed"
            errors = 1
            diagnostics["persistence_error"] = type(exc).__name__

    status = _resolve_status(status, rejected, insert_stats)
    diagnostics["counts"] = {
        "fetched": fetched,
        "inserted": insert_stats.inserted,
        "duplicate": insert_stats.duplicate,
        "rejected": rejected + insert_stats.rejected,
    }

    # Always finalize in a fresh connection so a failed insert cannot leave the
    # run stuck in "running".
    async with db.connection() as conn:
        await repository.finish_run(
            conn,
            run_id,
            status=status,
            fetched=fetched,
            inserted=insert_stats.inserted,
            duplicate=insert_stats.duplicate,
            rejected=rejected + insert_stats.rejected,
            errors=errors,
            diagnostics=diagnostics,
        )
        await repository.record_provider_attempt(
            conn,
            provider=provider,
            success=status in {"succeeded", "partial"},
            run_id=run_id,
            error=(
                diagnostics.get("error", {}).get("message")
                if isinstance(diagnostics.get("error"), dict)
                else None
            ),
            skipped=status == "skipped",
        )

    async with db.connection() as conn:
        row = await repository.get_run(conn, str(run_id))
    if row is None:
        raise ApiError("internal_error", "ingestion run disappeared", status_code=500)
    return _summary_from_row(row)


def _resolve_status(
    current: str, rejected: int, insert_stats: repository.InsertStats
) -> str:
    if current in {"failed", "skipped"}:
        return current
    if rejected > 0 or insert_stats.rejected > 0:
        return "partial"
    return "succeeded"


def _normalize_actor_items(
    raw_items: list[dict[str, Any]],
    *,
    provider: str,
    actor_run_id: str | None,
) -> tuple[list[NormalizedObservation], int, dict[str, int]]:
    observations: list[NormalizedObservation] = []
    rejected = 0
    reasons: dict[str, int] = {}
    for index, item in enumerate(raw_items):
        try:
            observations.append(
                actor_item_to_observation(
                    item, expected_provider=provider, actor_run_id=actor_run_id
                )
            )
        except Exception as exc:
            rejected += 1
            reason = str(exc)[:160] or type(exc).__name__
            reasons[reason] = reasons.get(reason, 0) + 1
            if rejected <= 5:
                logger.warning("rejected actor item %s: %s", index, reason)
    return observations, rejected, reasons


async def run_ingestion_batch(
    *,
    settings: Settings,
    db: Database,
    client: httpx.AsyncClient,
    providers: list[str],
    mode: str,
    limit: int,
    trigger: str = "api",
    idempotency_key: str | None = None,
    request_id: str | None = None,
    items: list[dict[str, Any]] | None = None,
    apify_actor_id: str | None = None,
    apify_input: dict[str, Any] | None = None,
) -> list[IngestionRunSummary]:
    results: list[IngestionRunSummary] = []
    for provider in providers:
        key = f"{idempotency_key}:{provider}" if idempotency_key else None
        results.append(
            await run_ingestion(
                settings=settings,
                db=db,
                client=client,
                provider=provider,
                mode=mode,
                limit=limit,
                trigger=trigger,
                idempotency_key=key,
                request_id=request_id,
                items=items,
                apify_actor_id=apify_actor_id,
                apify_input=apify_input,
            )
        )
    return results


def parse_uuid(value: str) -> UUID | None:
    try:
        return UUID(value)
    except (ValueError, AttributeError):
        return None
