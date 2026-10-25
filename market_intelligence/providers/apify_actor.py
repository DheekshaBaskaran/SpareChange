"""Apify Actor orchestration for the GPU Market Intelligence collector."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote

import httpx

from market_intelligence.config import Settings
from market_intelligence.core.normalization import (
    content_hash,
    money,
    parse_country,
    trim_payload,
    utc_now,
)
from market_intelligence.errors import ProviderCredentialsMissing, ProviderError
from market_intelligence.models import NormalizedObservation

logger = logging.getLogger(__name__)

APIFY_API = "https://api.apify.com/v2"
TERMINAL_FAILURES = {"FAILED", "ABORTED", "TIMED-OUT"}


class ApifyActorClient:
    def __init__(self, settings: Settings, client: httpx.AsyncClient) -> None:
        self.settings = settings
        self.client = client

    async def run_and_fetch(
        self,
        provider: str,
        limit: int,
        *,
        actor_id: str | None = None,
        actor_input: dict[str, Any] | None = None,
    ) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        token = self.settings.apify_token
        if not token:
            raise ProviderCredentialsMissing("apify", "APIFY_TOKEN")
        actor = actor_id or self.settings.apify_actor_id
        if not actor:
            raise ProviderCredentialsMissing("apify", "APIFY_ACTOR_ID")

        payload: dict[str, Any] = {
            "providers": [provider],
            "maxItemsPerProvider": max(1, limit),
            "includeRawPayload": True,
        }
        payload.update(actor_input or {})
        url = f"{APIFY_API}/acts/{quote(actor, safe='~')}/runs"
        response = await self.client.post(
            url,
            json=payload,
            headers={"Authorization": f"Bearer {token}"},
            timeout=30,
        )
        if response.status_code >= 400:
            raise ProviderError(
                "apify",
                f"Apify rejected the actor run (HTTP {response.status_code})",
                retryable=response.status_code >= 500,
                upstream_status=response.status_code,
                details={"body_excerpt": response.text[:240]},
            )
        run = response.json().get("data", {})
        run_id = run.get("id")
        dataset_id = run.get("defaultDatasetId")
        if not run_id or not dataset_id:
            raise ProviderError(
                "apify", "Apify run response did not include run/dataset IDs", retryable=False
            )

        status = run.get("status", "READY")
        deadline = utc_now().timestamp() + self.settings.apify_timeout_seconds
        while status not in {"SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"}:
            if utc_now().timestamp() > deadline:
                raise ProviderError(
                    "apify",
                    f"Apify actor did not finish within {self.settings.apify_timeout_seconds}s",
                    retryable=True,
                    details={"run_id": run_id, "status": status},
                )
            await asyncio.sleep(2)
            poll = await self.client.get(
                f"{APIFY_API}/actor-runs/{run_id}",
                headers={"Authorization": f"Bearer {token}"},
                timeout=30,
            )
            if poll.status_code >= 400:
                raise ProviderError(
                    "apify",
                    f"Apify run polling failed (HTTP {poll.status_code})",
                    retryable=True,
                    upstream_status=poll.status_code,
                    details={"run_id": run_id},
                )
            run = poll.json().get("data", {})
            status = run.get("status", status)

        if status in TERMINAL_FAILURES:
            raise ProviderError(
                "apify",
                f"Apify actor ended with status {status}",
                retryable=status == "TIMED-OUT",
                details={"run_id": run_id, "status": status},
            )

        items_response = await self.client.get(
            f"{APIFY_API}/datasets/{dataset_id}/items",
            params={"format": "json", "clean": "true", "limit": 5000},
            headers={"Authorization": f"Bearer {token}"},
            timeout=60,
        )
        if items_response.status_code >= 400:
            raise ProviderError(
                "apify",
                f"Apify dataset download failed (HTTP {items_response.status_code})",
                retryable=True,
                upstream_status=items_response.status_code,
                details={"run_id": run_id, "dataset_id": dataset_id},
            )
        items = items_response.json()
        if not isinstance(items, list):
            raise ProviderError(
                "apify", "Apify dataset did not return a JSON array", retryable=False
            )
        diagnostics = {
            "run_id": run_id,
            "dataset_id": dataset_id,
            "status": status,
            "actor_id": actor,
            "items_downloaded": len(items),
        }
        return [item for item in items if isinstance(item, dict)], diagnostics

    async def fetch_existing_run_events(self, run_id: str) -> list[dict[str, Any]]:
        """Fetch the named ``events`` dataset from a completed Actor run.

        Older runs may not have a SUMMARY or events dataset; those are treated
        as empty rather than as a failure so offer replay still works.
        """
        token = self.settings.apify_token
        if not token:
            raise ProviderCredentialsMissing("apify", "APIFY_TOKEN")

        response = await self.client.get(
            f"{APIFY_API}/actor-runs/{quote(run_id, safe='')}",
            headers={"Authorization": f"Bearer {token}"},
            timeout=30,
        )
        if response.status_code >= 400:
            return []
        run = response.json().get("data", {})
        store_id = run.get("defaultKeyValueStoreId")
        if not store_id:
            return []

        summary_response = await self.client.get(
            f"{APIFY_API}/key-value-stores/{quote(store_id, safe='')}/records/SUMMARY",
            headers={"Authorization": f"Bearer {token}"},
            timeout=30,
        )
        if summary_response.status_code >= 400:
            return []
        summary = summary_response.json()
        events_dataset_id = (
            summary.get("datasets", {}).get("events_dataset_id")
            if isinstance(summary, dict)
            else None
        )
        if not events_dataset_id:
            return []

        items_response = await self.client.get(
            f"{APIFY_API}/datasets/{quote(str(events_dataset_id), safe='')}/items",
            params={"format": "json", "clean": "true", "limit": 5000},
            headers={"Authorization": f"Bearer {token}"},
            timeout=60,
        )
        if items_response.status_code >= 400:
            return []
        items = items_response.json()
        return [item for item in items if isinstance(item, dict)] if isinstance(items, list) else []

    async def fetch_existing_run(self, run_id: str) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        """Fetch the default dataset of an already completed Actor run.

        Used by the Apify webhook fallback. The run must have succeeded; a
        failed or aborted run never overwrites market state.
        """
        token = self.settings.apify_token
        if not token:
            raise ProviderCredentialsMissing("apify", "APIFY_TOKEN")

        response = await self.client.get(
            f"{APIFY_API}/actor-runs/{quote(run_id, safe='')}",
            headers={"Authorization": f"Bearer {token}"},
            timeout=30,
        )
        if response.status_code >= 400:
            raise ProviderError(
                "apify",
                f"Apify run lookup failed (HTTP {response.status_code})",
                retryable=response.status_code >= 500,
                upstream_status=response.status_code,
                details={"run_id": run_id},
            )
        run = response.json().get("data", {})
        status = str(run.get("status") or "UNKNOWN")
        dataset_id = run.get("defaultDatasetId")
        if status != "SUCCEEDED":
            raise ProviderError(
                "apify",
                f"Apify run {run_id} is {status}; dataset was not ingested",
                retryable=False,
                details={"run_id": run_id, "status": status},
            )
        if not dataset_id:
            raise ProviderError(
                "apify", "Apify run has no default dataset", retryable=False
            )

        items_response = await self.client.get(
            f"{APIFY_API}/datasets/{dataset_id}/items",
            params={"format": "json", "clean": "true", "limit": 5000},
            headers={"Authorization": f"Bearer {token}"},
            timeout=60,
        )
        if items_response.status_code >= 400:
            raise ProviderError(
                "apify",
                f"Apify dataset download failed (HTTP {items_response.status_code})",
                retryable=True,
                upstream_status=items_response.status_code,
                details={"run_id": run_id, "dataset_id": dataset_id},
            )
        items = items_response.json()
        if not isinstance(items, list):
            raise ProviderError(
                "apify", "Apify dataset did not return a JSON array", retryable=False
            )
        return [item for item in items if isinstance(item, dict)], {
            "run_id": run_id,
            "dataset_id": dataset_id,
            "status": status,
            "items_downloaded": len(items),
        }


def actor_item_to_observation(
    item: dict[str, Any],
    *,
    expected_provider: str,
    actor_run_id: str | None = None,
) -> NormalizedObservation:
    """Validate an Actor output item and convert it to the canonical observation."""
    provider = item.get("provider")
    if provider != expected_provider:
        raise ValueError(f"item provider {provider!r} does not match {expected_provider!r}")

    price_value = item.get("price_per_hour_usd", item.get("price_per_hour"))
    if price_value is None:
        raise ValueError("price_per_hour_usd missing")
    price_available = bool(item.get("price_available", True))
    if not price_available:
        price_value = 0

    observed_raw = item.get("observed_at")
    observed_at = utc_now()
    if isinstance(observed_raw, str):
        try:
            observed_at = datetime.fromisoformat(observed_raw.replace("Z", "+00:00"))
            if observed_at.tzinfo is None:
                observed_at = observed_at.replace(tzinfo=timezone.utc)
        except ValueError:
            pass

    raw_payload = item.get("raw_payload") if isinstance(item.get("raw_payload"), dict) else item
    metadata = dict(item.get("metadata") or {})
    metadata["collection_channel"] = "apify_actor"
    if actor_run_id:
        metadata["actor_run_id"] = actor_run_id

    region = item.get("region")
    observation = NormalizedObservation(
        provider=expected_provider,
        provider_offer_id=str(item.get("provider_offer_id") or ""),
        gpu_model=str(item.get("gpu_model") or ""),
        gpu_model_normalized=item.get("gpu_model_normalized"),
        gpu_count=int(item.get("gpu_count") or 1),
        vram_gb=item.get("vram_gb"),
        cpu_cores=item.get("cpu_cores"),
        ram_gb=item.get("ram_gb"),
        disk_gb=item.get("disk_gb"),
        region=region,
        country=item.get("country") or parse_country(region),
        price_per_hour=money(price_value),
        price_available=price_available,
        pricing_model=item.get("pricing_model") or "fixed",
        currency=str(item.get("currency") or "USD"),
        billing_scope=item.get("billing_scope") or "per_instance_hour",
        availability_scope=item.get("availability_scope") or "live_inventory",
        executable=False,
        available_gpu_count=item.get("available_gpu_count"),
        capacity_scope=item.get("capacity_scope") or "offer",
        reliability=item.get("reliability"),
        source="apify_actor",
        source_url=item.get("source_url"),
        source_record_id=item.get("source_record_id"),
        trust_tier="apify_actor",
        observed_at=observed_at,
        raw_payload=trim_payload(raw_payload),
        metadata=metadata,
    )
    return observation


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
