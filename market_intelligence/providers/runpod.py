"""RunPod GPU pricing adapter.

RunPod's public GraphQL endpoint exposes per-GPU-type advertised prices without
an API key. Each GPU type/cloud tier becomes an ``advertised`` reference offer;
there is no per-host inventory identifier, so the synthetic ID is stable.
"""

from __future__ import annotations

from typing import Any

from market_intelligence.core.normalization import (
    as_float,
    money,
    normalize_gpu_model,
    trim_payload,
    utc_now,
)
from market_intelligence.errors import ProviderError
from market_intelligence.models import NormalizedObservation
from market_intelligence.providers.base import FetchOutcome, ProviderAdapter

GPU_TYPES_QUERY = """
query RelayGpuMarket($gpuCount: Int!) {
  gpuTypes {
    id
    displayName
    memoryInGb
    secureCloud
    communityCloud
    lowestPrice(input: {gpuCount: $gpuCount}) {
      minimumBidPrice
      uninterruptablePrice
    }
  }
}
"""


class RunpodAdapter(ProviderAdapter):
    key = "runpod"
    display_name = "RunPod"
    source = "runpod_graphql"
    trust_tier = "provider_api"

    async def fetch(self, limit: int) -> FetchOutcome:
        headers: dict[str, str] = {"Content-Type": "application/json"}
        if self.settings.runpod_api_key:
            headers["Authorization"] = f"Bearer {self.settings.runpod_api_key}"

        payload = await self._post_json(
            self.settings.runpod_graphql_url,
            payload={"query": GPU_TYPES_QUERY, "variables": {"gpuCount": 1}},
            headers=headers,
        )
        if isinstance(payload, dict) and payload.get("errors"):
            raise ProviderError(
                self.key,
                "RunPod GraphQL returned errors",
                retryable=False,
                details={"errors": [_graphql_error(item) for item in payload["errors"][:3]]},
            )
        gpu_types = (
            payload.get("data", {}).get("gpuTypes") if isinstance(payload, dict) else None
        )
        if not isinstance(gpu_types, list):
            raise ProviderError(
                self.key,
                "RunPod response did not contain gpuTypes",
                retryable=False,
            )

        now = utc_now()
        items: list[NormalizedObservation] = []
        rejected = 0
        reasons: dict[str, int] = {}

        for gpu_type in gpu_types:
            try:
                items.extend(self._normalize(gpu_type, now))
            except (ValueError, TypeError, KeyError) as exc:
                rejected += 1
                reason = str(exc)[:160] or type(exc).__name__
                reasons[reason] = reasons.get(reason, 0) + 1

        emitted = len(items)
        truncated = emitted > limit
        items = items[:limit]
        return FetchOutcome(
            items=items,
            fetched=len(gpu_types),
            rejected=rejected,
            complete=not truncated,
            diagnostics={
                "returned_gpu_types": len(gpu_types),
                "emitted_offers": len(items),
                "truncated": truncated,
                "rejected_reasons": reasons,
                "endpoint": self.settings.runpod_graphql_url,
                "authenticated": bool(self.settings.runpod_api_key),
            },
        )

    def _normalize(self, raw: dict[str, Any], observed_at) -> list[NormalizedObservation]:
        if not isinstance(raw, dict):
            raise ValueError("gpu type is not an object")
        gpu_id = raw.get("id")
        display_name = raw.get("displayName") or gpu_id
        if not gpu_id or not display_name:
            raise ValueError("gpu type identity missing")

        prices = raw.get("lowestPrice") or {}
        if not isinstance(prices, dict):
            raise ValueError("lowestPrice is not an object")
        on_demand = as_float(prices.get("uninterruptablePrice"))
        spot = as_float(prices.get("minimumBidPrice"))
        price_value = on_demand if on_demand is not None and on_demand > 0 else spot
        if price_value is None or price_value <= 0:
            raise ValueError("no usable price")
        price = money(price_value)
        price_kind = "on_demand" if price_value is on_demand else "spot"

        vram = as_float(raw.get("memoryInGb"))
        offers: list[NormalizedObservation] = []
        for tier, enabled in (
            ("secure_cloud", bool(raw.get("secureCloud"))),
            ("community_cloud", bool(raw.get("communityCloud"))),
        ):
            if not enabled:
                continue
            offers.append(
                NormalizedObservation(
                    provider=self.key,
                    provider_offer_id=f"runpod:{gpu_id}:{tier}",
                    gpu_model=str(gpu_id),
                    gpu_model_normalized=normalize_gpu_model(str(display_name)),
                    gpu_count=1,
                    vram_gb=vram,
                    cpu_cores=None,
                    ram_gb=None,
                    disk_gb=None,
                    region=tier.replace("_", " ").title(),
                    country=None,
                    price_per_hour=price,
                    currency="USD",
                    billing_scope="per_gpu_hour",
                    availability_scope="advertised",
                    executable=False,
                    reliability=None,
                    source=self.source,
                    source_url="https://www.runpod.io/pricing",
                    source_record_id=str(gpu_id),
                    trust_tier=self.trust_tier,
                    observed_at=observed_at,
                    raw_payload=trim_payload(raw),
                    metadata={
                        "gpu_type_id": gpu_id,
                        "display_name": display_name,
                        "cloud_tier": tier,
                        "price_kind": price_kind,
                        "on_demand_price_usd": on_demand,
                        "spot_price_usd": spot,
                        "collection_channel": "public_provider_api",
                    },
                )
            )
        if not offers:
            raise ValueError("no enabled cloud tier")
        return offers


def _graphql_error(error: Any) -> str:
    if isinstance(error, dict):
        return str(error.get("message", "unknown GraphQL error"))[:240]
    return str(error)[:240]
