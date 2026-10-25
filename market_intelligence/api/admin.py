"""Admin ingestion endpoints used by schedulers and the Apify Actor."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request

from market_intelligence import repository
from market_intelligence.api.deps import AdminDep, DatabaseDep, HttpClientDep, SettingsDep
from market_intelligence.core.ingestion import detail_from_row, run_ingestion_batch
from market_intelligence.errors import ApiError
from market_intelligence.models import (
    IngestionBatchResponse,
    IngestionRunDetail,
    IngestionRunRequest,
    IngestionRunSummary,
    PROVIDERS,
)
from market_intelligence.providers.apify_actor import ApifyActorClient
from market_intelligence.providers.registry import PROVIDER_KEYS, enabled_provider_keys

router = APIRouter(
    prefix="/v1/admin/ingestion",
    tags=["admin-ingestion"],
    dependencies=[],
)


@router.post("/runs", response_model=IngestionBatchResponse)
async def start_ingestion_run(
    payload: IngestionRunRequest,
    request: Request,
    _admin: AdminDep,
    settings: SettingsDep,
    db: DatabaseDep,
    client: HttpClientDep,
) -> IngestionBatchResponse:
    request_id = getattr(request.state, "request_id", None)

    providers = (
        enabled_provider_keys(settings)
        if payload.provider == "all"
        else [payload.provider]
    )
    if payload.provider != "all" and not settings.provider_enabled(payload.provider):
        if not payload.allow_deferred:
            raise ApiError(
                "provider_disabled",
                f"{payload.provider} is deferred and excluded from scheduled collection",
                status_code=409,
                details={
                    "provider": payload.provider,
                    "enabled_providers": settings.enabled_providers,
                    "hint": "pass allow_deferred=true only for explicit development ingestion",
                },
            )
    items = payload.items

    if payload.mode == "items":
        if not items:
            raise ApiError(
                "invalid_request",
                "items mode requires a non-empty items array",
                status_code=400,
            )
        if payload.provider == "all":
            grouped: dict[str, list[dict[str, Any]]] = {}
            for item in items:
                item_provider = item.get("provider")
                if item_provider not in PROVIDERS:
                    raise ApiError(
                        "invalid_request",
                        "each item must name a known provider when provider=all",
                        status_code=400,
                        details={"item_provider": item_provider},
                    )
                grouped.setdefault(item_provider, []).append(item)
            providers = list(grouped.keys())
            disabled = [key for key in providers if not settings.provider_enabled(key)]
            if disabled and not payload.allow_deferred:
                raise ApiError(
                    "provider_disabled",
                    "items contain a deferred provider",
                    status_code=409,
                    details={"disabled_providers": disabled},
                )
        else:
            mismatched = [item for item in items if item.get("provider") not in (None, payload.provider)]
            if mismatched:
                raise ApiError(
                    "invalid_request",
                    "items contain a different provider than requested",
                    status_code=400,
                )
    elif payload.mode == "apify" and not (settings.apify_token or payload.apify_actor_id):
        raise ApiError(
            "source_credentials_missing",
            "APIFY_TOKEN is required for actor mode",
            status_code=400,
        )

    if len(items or []) > 5000:
        raise ApiError("invalid_request", "at most 5000 items per request", status_code=400)

    if payload.mode == "items" and payload.provider == "all":
        results = []
        for provider in providers:
            results.extend(
                await run_ingestion_batch(
                    settings=settings,
                    db=db,
                    client=client,
                    providers=[provider],
                    mode="items",
                    limit=payload.limit_per_provider,
                    trigger="api",
                    idempotency_key=payload.idempotency_key,
                    request_id=request_id,
                    items=[item for item in items or [] if item.get("provider") == provider],
                    allow_deferred=payload.allow_deferred,
                )
            )
    elif payload.mode == "apify":
        results = await run_ingestion_batch(
            settings=settings,
            db=db,
            client=client,
            providers=providers,
            mode="apify",
            limit=payload.limit_per_provider,
            trigger="api",
            idempotency_key=payload.idempotency_key,
            request_id=request_id,
            apify_actor_id=payload.apify_actor_id,
            apify_input=payload.apify_input,
            allow_deferred=payload.allow_deferred,
        )
    else:
        results = await run_ingestion_batch(
            settings=settings,
            db=db,
            client=client,
            providers=providers,
            mode=payload.mode,
            limit=payload.limit_per_provider,
            trigger="api",
            idempotency_key=payload.idempotency_key,
            request_id=request_id,
            items=items,
            allow_deferred=payload.allow_deferred,
        )

    return IngestionBatchResponse(runs=results, idempotency_key=payload.idempotency_key)


@router.post("/apify-webhook")
async def apify_webhook(
    payload: dict[str, Any],
    request: Request,
    _admin: AdminDep,
    settings: SettingsDep,
    db: DatabaseDep,
    client: HttpClientDep,
) -> dict[str, Any]:
    """Ingest a completed Actor run after an Apify webhook.

    The Actor normally pushes directly, and both paths use the same
    idempotency key per (run, provider). A webhook replay is therefore a
    duplicate no-op rather than a second observation.
    """
    event_data = payload.get("eventData") if isinstance(payload.get("eventData"), dict) else {}
    resource = payload.get("resource") if isinstance(payload.get("resource"), dict) else {}
    run_id = (
        event_data.get("actorRunId")
        or resource.get("id")
        or payload.get("actorRunId")
    )
    if not isinstance(run_id, str) or not run_id.strip():
        raise ApiError(
            "invalid_request", "webhook payload does not contain actorRunId", status_code=400
        )

    actor = ApifyActorClient(settings, client)
    try:
        items, diagnostics = await actor.fetch_existing_run(run_id)
    except Exception as exc:
        from market_intelligence.errors import ProviderError

        if isinstance(exc, ProviderError):
            raise ApiError(
                "source_unavailable",
                exc.message,
                status_code=502,
                details=exc.details,
            ) from exc
        raise

    grouped: dict[str, list[dict[str, Any]]] = {}
    for item in items:
        provider = item.get("provider")
        if isinstance(provider, str):
            grouped.setdefault(provider, []).append(item)

    runs: list[IngestionRunSummary] = []
    for provider, provider_items in grouped.items():
        if provider not in PROVIDER_KEYS:
            continue
        runs.extend(
            await run_ingestion_batch(
                settings=settings,
                db=db,
                client=client,
                providers=[provider],
                mode="items",
                limit=settings.market_max_ingest_items,
                trigger="apify_webhook",
                idempotency_key=f"apify:{run_id}:{provider}",
                request_id=getattr(request.state, "request_id", None),
                items=provider_items,
            )
        )

    # Replay the Actor's named events dataset too. A failed direct push can
    # leave offers delivered but events missing; both inserts are idempotent.
    event_rows = await actor.fetch_existing_run_events(run_id)
    event_stats = repository.InsertStats()
    if event_rows:
        async with db.connection() as conn:
            event_stats = await repository.insert_market_events(
                conn, event_rows, actor_run_id=run_id
            )

    return {
        "run_id": run_id,
        "actor_status": diagnostics.get("status"),
        "items": len(items),
        "runs": [run.model_dump(mode="json") for run in runs],
        "events": {
            "received": len(event_rows),
            "inserted": event_stats.inserted,
            "duplicate": event_stats.duplicate,
        },
    }


@router.get("/runs/{run_id}", response_model=IngestionRunDetail)
async def get_ingestion_run(
    run_id: str,
    _admin: AdminDep,
    db: DatabaseDep,
) -> IngestionRunDetail:
    async with db.connection() as conn:
        row = await repository.get_run(conn, run_id)
    if row is None:
        raise ApiError("run_not_found", "ingestion run not found", status_code=404)
    return detail_from_row(row)
