from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import httpx
import pytest

from market_intelligence import repository
from market_intelligence.config import Settings
from market_intelligence.core.normalization import money, utc_now
from market_intelligence.database import Database
from market_intelligence.models import NormalizedObservation

PREFIX = "pytest-market-"
GPU = "Relay Test GPU"


def _observation(offer_id: str, price: str, observed_at: datetime) -> NormalizedObservation:
    return NormalizedObservation(
        provider="vastai",
        provider_offer_id=offer_id,
        gpu_model=GPU,
        gpu_count=1,
        vram_gb=80,
        price_per_hour=money(price),
        currency="USD",
        billing_scope="per_instance_hour",
        availability_scope="live_inventory",
        executable=False,
        reliability=0.99,
        source="pytest",
        source_url="https://example.invalid/offer",
        source_record_id=offer_id,
        trust_tier="manual",
        observed_at=observed_at,
        raw_payload={"test": True},
        metadata={"test": True},
    )


async def _insert(db: Database, observations: list[NormalizedObservation]) -> tuple[str, object]:
    run_id = uuid4()
    async with db.connection() as conn:
        await repository.create_run(
            conn,
            run_id=run_id,
            provider="vastai",
            adapter="pytest",
            trigger="test",
            mode="items",
            idempotency_key=f"pytest-run-{run_id}",
            request_id="pytest",
        )
        stats = await repository.insert_observations(conn, run_id=run_id, observations=observations)
        await repository.finish_run(
            conn,
            run_id,
            status="succeeded",
            fetched=len(observations),
            inserted=stats.inserted,
            duplicate=stats.duplicate,
            rejected=stats.rejected,
            errors=0,
            diagnostics={"test": True},
        )
    return str(run_id), stats


async def _cleanup(db: Database) -> None:
    async with db.connection() as conn:
        await conn.execute(
            "DELETE FROM market_observations WHERE provider_offer_id LIKE %s", (f"{PREFIX}%",)
        )
        await conn.execute(
            "DELETE FROM market_observation_keys WHERE provider_offer_id LIKE %s",
            (f"{PREFIX}%",),
        )
        await conn.execute(
            "DELETE FROM ingestion_runs WHERE idempotency_key LIKE %s", ("pytest-%",)
        )


@pytest.mark.asyncio
async def test_offer_read_dedupe_history_and_summary(
    database: Database, api_client: httpx.AsyncClient
) -> None:
    now = utc_now()
    try:
        first = _observation(f"{PREFIX}one", "1.00", now - timedelta(hours=2))
        second = _observation(f"{PREFIX}two", "2.00", now - timedelta(minutes=1))
        run_id, stats = await _insert(database, [first, second])
        assert stats.inserted == 2

        duplicate_run, duplicate_stats = await _insert(database, [second])
        assert duplicate_stats.inserted == 0
        assert duplicate_stats.duplicate == 1

        response = await api_client.get(
            "/v1/market/offers",
            params={"provider": "vastai", "gpu_model": GPU, "limit": 10, "include_stale": True},
        )
        assert response.status_code == 200, response.text
        page = response.json()
        ids = {item["provider_offer_id"] for item in page["items"]}
        assert ids == {f"{PREFIX}one", f"{PREFIX}two"}
        assert all(item["executable"] is False for item in page["items"])
        assert all(item["freshness"] in {"fresh", "stale", "expired"} for item in page["items"])
        assert page["items"][0]["source"] == "pytest"
        assert "price_per_gpu_hour_micros" in page["items"][0]

        history = await api_client.get(
            "/v1/market/history",
            params={
                "gpu_model": GPU,
                "provider": "vastai",
                "bucket": "1h",
                "from": (now - timedelta(hours=4)).isoformat(),
                "to": now.isoformat(),
            },
        )
        assert history.status_code == 200, history.text
        payload = history.json()
        assert len(payload["points"]) == 2
        assert payload["points"][0]["median_price_per_hour_micros"] == 1_000_000
        assert payload["points"][-1]["median_price_per_hour_micros"] == 2_000_000
        assert payload["trend"]["direction"] == "up"
        assert payload["trend"]["change_percent"] == 100.0

        summary = await api_client.get(
            "/v1/market/summary", params={"window": "24h", "provider": "vastai", "limit": 100}
        )
        assert summary.status_code == 200, summary.text
        gpu = next(
            item for item in summary.json()["gpus"] if item["gpu_model_normalized"] == GPU.upper()
        )
        assert gpu["fresh_offer_count"] == 1
        assert gpu["median_price_per_gpu_hour_micros"] == 2_000_000

        single = await api_client.get(
            "/v1/market/offers", params={"gpu_model": f"{PREFIX}two"}
        )
        assert single.status_code == 200
        assert single.json()["items"] == []

        detail = await api_client.get(f"/v1/market/offers/{page['items'][0]['id']}")
        assert detail.status_code == 200
        assert detail.json()["provider_offer_id"] in {f"{PREFIX}one", f"{PREFIX}two"}

        assert run_id != duplicate_run
    finally:
        await _cleanup(database)


@pytest.mark.asyncio
async def test_admin_ingestion_items_and_auth(
    database: Database, api_client: httpx.AsyncClient, settings: Settings
) -> None:
    now = utc_now()
    item = {
        "provider": "vastai",
        "provider_offer_id": f"{PREFIX}admin",
        "gpu_model": "NVIDIA H100 PCIe",
        "gpu_count": 1,
        "vram_gb": 80,
        "price_per_hour_usd": "2.15",
        "currency": "USD",
        "billing_scope": "per_instance_hour",
        "availability_scope": "live_inventory",
        "region": "Oregon, US",
        "observed_at": now.isoformat(),
        "source_url": "https://console.vast.ai/api/v0/bundles/",
        "source_record_id": "admin-test",
    }
    headers = {"Authorization": f"Bearer {settings.market_admin_token}"}
    try:
        unauthorized = await api_client.post(
            "/v1/admin/ingestion/runs", json={"provider": "vastai", "mode": "items", "items": [item]}
        )
        assert unauthorized.status_code == 401

        bad_token = await api_client.post(
            "/v1/admin/ingestion/runs",
            json={"provider": "vastai", "mode": "items", "items": [item]},
            headers={"Authorization": "Bearer wrong"},
        )
        assert bad_token.status_code == 403

        created = await api_client.post(
            "/v1/admin/ingestion/runs",
            json={
                "provider": "vastai",
                "mode": "items",
                "items": [item],
                "idempotency_key": f"pytest-admin-{uuid4()}",
            },
            headers=headers,
        )
        assert created.status_code == 200, created.text
        run = created.json()["runs"][0]
        assert run["status"] == "succeeded"
        assert run["inserted"] == 1

        replay = await api_client.post(
            "/v1/admin/ingestion/runs",
            json={
                "provider": "vastai",
                "mode": "items",
                "items": [item],
            },
            headers=headers,
        )
        assert replay.status_code == 200, replay.text
        assert replay.json()["runs"][0]["duplicate"] == 1

        detail = await api_client.get(
            f"/v1/admin/ingestion/runs/{run['run_id']}", headers=headers
        )
        assert detail.status_code == 200
        assert detail.json()["adapter"] == "actor_items"
        assert detail.json()["diagnostics"]["counts"]["inserted"] == 1

        invalid = await api_client.get(
            "/v1/market/history",
            params={"gpu_model": GPU, "from": now.isoformat(), "to": (now - timedelta(hours=1)).isoformat()},
        )
        assert invalid.status_code == 400
    finally:
        await _cleanup(database)


@pytest.mark.asyncio
async def test_skipped_provider_and_idempotent_replay(
    database: Database, api_client: httpx.AsyncClient, settings: Settings
) -> None:
    headers = {"Authorization": f"Bearer {settings.market_admin_token}"}
    skip_key = f"pytest-skip-{uuid4()}"
    item = {
        "provider": "vastai",
        "provider_offer_id": f"{PREFIX}idem",
        "gpu_model": "NVIDIA L40S",
        "gpu_count": 1,
        "vram_gb": 48,
        "price_per_hour_usd": "0.95",
        "billing_scope": "per_gpu_hour",
        "availability_scope": "advertised",
        "observed_at": utc_now().isoformat(),
    }
    try:
        skipped = await api_client.post(
            "/v1/admin/ingestion/runs",
            json={
                "provider": "lambda",
                "mode": "direct",
                "limit_per_provider": 5,
                "idempotency_key": skip_key,
            },
            headers=headers,
        )
        assert skipped.status_code == 200, skipped.text
        run = skipped.json()["runs"][0]
        assert run["status"] == "skipped"
        assert run["inserted"] == 0

        key = f"pytest-idem-{uuid4()}"
        payload = {
            "provider": "vastai",
            "mode": "items",
            "items": [item],
            "idempotency_key": key,
        }
        first = await api_client.post("/v1/admin/ingestion/runs", json=payload, headers=headers)
        second = await api_client.post("/v1/admin/ingestion/runs", json=payload, headers=headers)
        assert first.status_code == 200 and second.status_code == 200
        assert first.json()["runs"][0]["run_id"] == second.json()["runs"][0]["run_id"]
        assert second.json()["runs"][0]["inserted"] == 1
    finally:
        await _cleanup(database)


@pytest.mark.asyncio
async def test_freshness_and_providers(database: Database, api_client: httpx.AsyncClient) -> None:
    response = await api_client.get("/v1/market/providers")
    assert response.status_code == 200
    providers = {item["provider"] for item in response.json()}
    assert providers == {"vastai", "runpod", "lambda", "tensordock"}

    freshness = await api_client.get("/v1/market/freshness")
    assert freshness.status_code == 200
    payload = freshness.json()
    assert {item["provider"] for item in payload["providers"]} == providers


@pytest.mark.asyncio
async def test_readiness(api_client: httpx.AsyncClient) -> None:
    response = await api_client.get("/readyz")
    assert response.status_code == 200
    assert response.json()["checks"]["tiger_data"] == "ok"
