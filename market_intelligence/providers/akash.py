"""Akash Network public GPU capacity adapter.

Akash exposes a public, unauthenticated provider inventory at
``https://console-api.akash.network/v1/providers``. The inventory reports GPU
models and provider-level capacity, but **no price**. Real prices are submitted
as bids for a specific deployment (``/v1/bids?dseq=...`` with a Console API
key), so they cannot be represented as a fixed offer price.

This adapter therefore emits explicit capacity observations:

- ``price_available=False`` and ``pricing_model="bid"``
- ``price_per_hour=0`` (a sentinel, never used for price analytics)
- ``availability_scope="advertised"`` because inventory is not a reservation
- ``executable=False`` because Relay has not authorized any capacity

The provider-level ``stats.gpu.available`` count is stored on every model row
with ``capacity_scope="provider"``. It must not be read as an offer-level count
when a provider advertises more than one GPU model.
"""

from __future__ import annotations

import re
from typing import Any

from market_intelligence.core.normalization import (
    as_int,
    money,
    normalize_gpu_model,
    parse_country,
    parse_vram_gb,
    trim_payload,
    utc_now,
)
from market_intelligence.errors import ProviderError
from market_intelligence.models import NormalizedObservation
from market_intelligence.providers.base import FetchOutcome, ProviderAdapter


def _slug(value: str) -> str:
    cleaned = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return cleaned or "unknown"


def humanize_akash_model(vendor: Any, model: Any) -> str:
    """Turn ``nvidia`` + ``rtx4060ti`` into ``NVIDIA RTX 4060 Ti``."""
    raw_model = str(model or "").strip()
    if not raw_model:
        raise ValueError("gpu model missing")
    text = re.sub(r"[_-]+", " ", raw_model)
    text = re.sub(r"(?i)rtx\s*(\d{4})\s*(ti|super)?", r"RTX \1 \2", text)
    text = re.sub(r"(?i)\b([ahblm])\s*(\d{2,3})\b", r"\1\2", text)
    text = re.sub(r"\s+", " ", text).strip()
    vendor_text = str(vendor or "").strip()
    if vendor_text and vendor_text.lower() not in text.lower():
        text = f"{vendor_text} {text}"
    return re.sub(r"\s+", " ", text).strip()


class AkashAdapter(ProviderAdapter):
    key = "akash"
    display_name = "Akash Network"
    source = "akash_console_api"
    trust_tier = "provider_api"
    pricing_model = "bid"

    async def fetch(self, limit: int) -> FetchOutcome:
        requested = max(1, min(limit, 1000))
        payload = await self._get_json(
            f"{self.settings.akash_base_url.rstrip('/')}/providers"
        )
        # The documented response is a top-level array. Accept a wrapped array
        # for resilience, but reject anything that is not provider records.
        if isinstance(payload, dict):
            providers = payload.get("data") or payload.get("providers")
        else:
            providers = payload
        if not isinstance(providers, list):
            raise ProviderError(
                self.key,
                "Akash response did not contain a provider array",
                retryable=False,
            )

        now = utc_now()
        items: list[NormalizedObservation] = []
        rejected = 0
        reasons: dict[str, int] = {}
        online = 0
        with_gpu = 0
        capacity_available = 0

        for provider in providers:
            if not isinstance(provider, dict):
                rejected += 1
                reasons["provider is not an object"] = reasons.get("provider is not an object", 0) + 1
                continue
            if provider.get("isOnline") is False:
                continue
            online += 1
            try:
                offers, available = self._normalize_provider(provider, now)
            except (ValueError, TypeError, KeyError) as exc:
                rejected += 1
                reason = str(exc)[:160] or type(exc).__name__
                reasons[reason] = reasons.get(reason, 0) + 1
                continue
            if not offers:
                continue
            with_gpu += 1
            capacity_available += available
            items.extend(offers)

        complete = len(items) <= requested and len(providers) > 0
        items = items[:requested]
        return FetchOutcome(
            items=items,
            fetched=len(providers),
            rejected=rejected,
            complete=complete,
            diagnostics={
                "returned_providers": len(providers),
                "online_providers": online,
                "providers_with_gpus": with_gpu,
                "emitted_offers": len(items),
                "provider_available_gpus": capacity_available,
                "truncated": len(items) >= requested,
                "rejected_reasons": reasons,
                "pricing": "bid-based; public inventory exposes no price",
                "endpoint": f"{self.settings.akash_base_url.rstrip('/')}/providers",
            },
        )

    def _normalize_provider(
        self, provider: dict[str, Any], observed_at
    ) -> tuple[list[NormalizedObservation], int]:
        owner = provider.get("owner") or provider.get("ownerAddress")
        if not owner:
            raise ValueError("provider owner missing")
        stats = provider.get("stats") or {}
        gpu_stats = stats.get("gpu") if isinstance(stats, dict) else None
        if not isinstance(gpu_stats, dict):
            gpu_stats = {}
        available = as_int(gpu_stats.get("available"))
        if available is None or available <= 0:
            return [], 0

        models = provider.get("gpuModels")
        if not isinstance(models, list) or not models:
            return [], available

        region = provider.get("ipRegion")
        if not isinstance(region, str) or not region.strip():
            region = None
        if not region:
            for attribute in provider.get("attributes") or []:
                if not isinstance(attribute, dict):
                    continue
                if str(attribute.get("key", "")).lower() == "location-region":
                    region = str(attribute.get("value") or "").strip() or None
                    if region:
                        break

        country = parse_country(
            provider.get("ipCountryCode") or provider.get("ipCountry"), region=region
        )
        host_uri = provider.get("hostUri")
        source_url = (
            str(host_uri).rstrip("/")
            if isinstance(host_uri, str) and host_uri.startswith("http")
            else f"{self.settings.akash_base_url.rstrip('/')}/providers/{owner}"
        )
        reliability = None
        uptime = provider.get("uptime")
        if isinstance(uptime, (int, float)) and 0 <= uptime <= 1:
            reliability = round(float(uptime), 4)

        offers: list[NormalizedObservation] = []
        seen_models: set[str] = set()
        for model in models:
            if not isinstance(model, dict):
                continue
            model_name = model.get("model")
            if not model_name:
                continue
            display = humanize_akash_model(model.get("vendor"), model_name)
            model_key = _slug(str(model_name))
            if model_key in seen_models:
                continue
            seen_models.add(model_key)
            offers.append(
                NormalizedObservation(
                    provider=self.key,
                    provider_offer_id=f"akash:{owner}:{model_key}",
                    gpu_model=display,
                    gpu_model_normalized=normalize_gpu_model(display),
                    gpu_count=1,
                    vram_gb=parse_vram_gb(model.get("ram")),
                    cpu_cores=None,
                    ram_gb=None,
                    disk_gb=None,
                    region=region,
                    country=country,
                    price_per_hour=money(0),
                    price_available=False,
                    pricing_model="bid",
                    currency="USD",
                    billing_scope="per_gpu_hour",
                    availability_scope="advertised",
                    executable=False,
                    available_gpu_count=available,
                    capacity_scope="provider",
                    reliability=reliability,
                    source=self.source,
                    source_url=source_url,
                    source_record_id=str(owner),
                    trust_tier=self.trust_tier,
                    observed_at=observed_at,
                    raw_payload=trim_payload(provider),
                    metadata={
                        "provider_owner": owner,
                        "host_uri": host_uri,
                        "gpu_vendor": model.get("vendor"),
                        "gpu_model": model_name,
                        "gpu_interface": model.get("interface"),
                        "provider_gpu_available": available,
                        "provider_gpu_total": gpu_stats.get("total"),
                        "provider_gpu_active": gpu_stats.get("active"),
                        "provider_gpu_pending": gpu_stats.get("pending"),
                        "capacity_scope": "provider_total_not_per_model",
                        "pricing_model": "bid",
                        "price_available": False,
                        "collection_channel": "public_provider_api",
                    },
                )
            )
        return offers, available
