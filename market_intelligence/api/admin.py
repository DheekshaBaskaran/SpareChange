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
from market_intelligence.providers.registry import PROVIDER_KEYS

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

    providers = list(PROVIDER_KEYS) if payload.provider == "all" else [payload.provider]
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
        )

    return IngestionBatchResponse(runs=results, idempotency_key=payload.idempotency_key)


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
