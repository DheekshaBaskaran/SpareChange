"""Vast.ai public GPU offer adapter.

The bundle search endpoint is public; an API key is optional and only raises
rate limits. Offers are live inventory references, not Relay-executable
capacity, so ``executable`` stays false.
"""

from __future__ import annotations

import json
from typing import Any

from market_intelligence.core.normalization import (
    as_float,
    as_int,
    money,
    normalize_gpu_model,
    parse_country,
    trim_payload,
    utc_now,
)
from market_intelligence.errors import ProviderError
from market_intelligence.models import NormalizedObservation
from market_intelligence.providers.base import FetchOutcome, ProviderAdapter

MAX_VAST_LIMIT = 500


class VastAiAdapter(ProviderAdapter):
    key = "vastai"
    display_name = "Vast.ai"
    source = "vastai_api"
    trust_tier = "provider_api"

    async def fetch(self, limit: int) -> FetchOutcome:
        requested = max(1, min(limit, MAX_VAST_LIMIT))
        query = {
            "verified": {"eq": True},
            "rentable": {"eq": True},
            "order": [["dph_total", "asc"]],
            "limit": requested,
        }
        headers: dict[str, str] = {}
        if self.settings.vastai_api_key:
            headers["Authorization"] = f"Bearer {self.settings.vastai_api_key}"

        payload = await self._get_json(
            f"{self.settings.vastai_base_url.rstrip('/')}/bundles/",
            params={"q": json.dumps(query, separators=(",", ":"))},
            headers=headers,
        )
        offers = payload.get("offers") if isinstance(payload, dict) else None
        if not isinstance(offers, list):
            raise ProviderError(
                self.key,
                "Vast.ai response did not contain an offers array",
                retryable=False,
            )

        now = utc_now()
        items: list[NormalizedObservation] = []
        rejected = 0
        reject_reasons: dict[str, int] = {}

        for offer in offers:
            try:
                items.append(self._normalize(offer, now))
            except (ValueError, TypeError, KeyError) as exc:
                rejected += 1
                reason = str(exc)[:160] or type(exc).__name__
                reject_reasons[reason] = reject_reasons.get(reason, 0) + 1

        # The public Vast search returns a capped sample, not the full
        # inventory: repeated identical queries return different offer sets and
        # no pagination is exposed. Never infer disappearances from it, even
        # when the provider reports ``truncated=False``.
        source_truncated = bool(payload.get("truncated", False))
        diagnostics: dict[str, Any] = {
            "requested_limit": requested,
            "returned": len(offers),
            "sampled": True,
            "source_truncated": source_truncated,
            "truncated": True,
            "rejected_reasons": reject_reasons,
            "endpoint": f"{self.settings.vastai_base_url.rstrip('/')}/bundles/",
        }
        if len(offers) >= requested and requested == MAX_VAST_LIMIT:
            diagnostics["note"] = "Vast.ai adapter caps a single run at 500 offers"

        return FetchOutcome(
            items=items,
            fetched=len(offers),
            rejected=rejected,
            complete=False,
            diagnostics=diagnostics,
        )

    def _normalize(self, raw: dict[str, Any], observed_at) -> NormalizedObservation:
        if not isinstance(raw, dict):
            raise ValueError("offer is not an object")
        offer_id = raw.get("id")
        if offer_id is None:
            raise ValueError("offer id missing")
        gpu_name = raw.get("gpu_name")
        if not gpu_name:
            raise ValueError("gpu_name missing")
        gpu_count = as_int(raw.get("num_gpus")) or 1
        if gpu_count < 1:
            raise ValueError("invalid gpu count")

        total_price = raw.get("dph_total")
        if total_price is None:
            total_price = raw.get("dph_base")
        price = money(total_price)

        vram_mb = as_float(raw.get("gpu_total_ram")) or as_float(raw.get("gpu_ram"))
        vram_gb = round(vram_mb / 1024, 2) if vram_mb and vram_mb > 0 else None
        ram_mb = as_float(raw.get("cpu_ram"))
        region = raw.get("geolocation") if isinstance(raw.get("geolocation"), str) else None
        reliability = as_float(raw.get("reliability2")) or as_float(raw.get("reliability"))

        raw_payload = trim_payload(raw)
        normalized = {
            "provider": self.key,
            "provider_offer_id": str(offer_id),
            "gpu_model": str(gpu_name),
            "gpu_model_normalized": normalize_gpu_model(str(gpu_name)),
            "gpu_count": gpu_count,
            "vram_gb": vram_gb,
            "cpu_cores": as_float(raw.get("cpu_cores_effective")) or as_float(raw.get("cpu_cores")),
            "ram_gb": round(ram_mb / 1024, 2) if ram_mb else None,
            "disk_gb": as_float(raw.get("disk_space")),
            "region": region,
            "country": parse_country(region),
            "price_per_hour": price,
            "currency": "USD",
            "billing_scope": "per_instance_hour",
            "availability_scope": "live_inventory",
            "executable": False,
            "reliability": min(1.0, max(0.0, reliability)) if reliability is not None else None,
            "source": self.source,
            "source_url": "https://console.vast.ai/api/v0/bundles/",
            "source_record_id": str(offer_id),
            "trust_tier": self.trust_tier,
            "observed_at": observed_at,
            "raw_payload": raw_payload,
            "metadata": {
                "host_id": raw.get("host_id"),
                "machine_id": raw.get("machine_id"),
                "verification": raw.get("verification"),
                "gpu_price_per_hour_usd": raw.get("dph_base"),
                "disk_price_per_hour_usd": raw.get("storage_total_cost"),
                "min_bid_usd": raw.get("min_bid"),
                "cuda_max_good": raw.get("cuda_max_good"),
                "inet_down_mbps": raw.get("inet_down"),
                "inet_up_mbps": raw.get("inet_up"),
                "disk_bw_mbps": raw.get("disk_bw"),
                "gpu_arch": raw.get("gpu_arch"),
                "num_gpus": gpu_count,
                "collection_channel": "public_provider_api",
            },
        }
        return NormalizedObservation(**normalized)
