"""TensorDock v2 hostnode adapter.

Requires a TensorDock v2 Bearer token. Each hostnode/GPU pair becomes a live
inventory reference offer at the advertised per-GPU-hour rate. Host-level CPU,
RAM, and storage are recorded as metadata because they are not allocated to a
single GPU offer.
"""

from __future__ import annotations

import re
from typing import Any

from market_intelligence.core.normalization import (
    gpu_vram_from_slug,
    money,
    normalize_gpu_model,
    parse_country,
    trim_payload,
    utc_now,
)
from market_intelligence.errors import ProviderCredentialsMissing, ProviderError
from market_intelligence.models import NormalizedObservation
from market_intelligence.providers.base import FetchOutcome, ProviderAdapter


def humanize_gpu_slug(slug: str) -> str:
    """Turn TensorDock's ``geforcertx4090-pcie-24gb`` into a readable model."""
    text = slug.replace("_", " ").replace("-", " ")
    text = re.sub(r"(?i)geforcertx", "GeForce RTX ", text)
    text = re.sub(r"(?i)geforcegtx", "GeForce GTX ", text)
    text = re.sub(r"(?i)rtxa(\d{4})", r"RTX A\1 ", text)
    text = re.sub(r"(?i)rtx(\d{4})", r"RTX \1 ", text)
    text = re.sub(r"(?i)a(\d{2})g", r"A\1G ", text)
    return re.sub(r"\s+", " ", text).strip()


class TensorDockAdapter(ProviderAdapter):
    key = "tensordock"
    display_name = "TensorDock"
    source = "tensordock_api"
    trust_tier = "provider_api"
    requires_env = "TENSORDOCK_API_KEY"

    async def fetch(self, limit: int) -> FetchOutcome:
        if not self.settings.tensordock_api_key:
            raise ProviderCredentialsMissing(self.key, "TENSORDOCK_API_KEY")

        try:
            payload = await self._get_json(
                f"{self.settings.tensordock_base_url.rstrip('/')}/hostnodes",
                headers={"Authorization": f"Bearer {self.settings.tensordock_api_key}"},
            )
        except ProviderError as exc:
            if exc.upstream_status in (401, 403):
                exc.code = "source_credentials_invalid"
                exc.retryable = False
                exc.message = "TensorDock rejected the configured API token"
            raise

        data = payload.get("data") if isinstance(payload, dict) else None
        hostnodes = data.get("hostnodes") if isinstance(data, dict) else None
        if not isinstance(hostnodes, list):
            raise ProviderError(
                self.key,
                "TensorDock response did not contain hostnodes",
                retryable=False,
            )

        now = utc_now()
        items: list[NormalizedObservation] = []
        rejected = 0
        reasons: dict[str, int] = {}
        seen: set[str] = set()

        for hostnode in hostnodes:
            try:
                for observation in self._normalize(hostnode, now):
                    if observation.provider_offer_id in seen:
                        continue
                    seen.add(observation.provider_offer_id)
                    items.append(observation)
            except (ValueError, TypeError, KeyError) as exc:
                rejected += 1
                reason = str(exc)[:160] or type(exc).__name__
                reasons[reason] = reasons.get(reason, 0) + 1

        items = items[:limit]
        return FetchOutcome(
            items=items,
            fetched=len(hostnodes),
            rejected=rejected,
            diagnostics={
                "returned_hostnodes": len(hostnodes),
                "emitted_offers": len(items),
                "rejected_reasons": reasons,
                "endpoint": f"{self.settings.tensordock_base_url.rstrip('/')}/hostnodes",
                "authenticated": True,
            },
        )

    def _normalize(self, raw: Any, observed_at) -> list[NormalizedObservation]:
        if not isinstance(raw, dict):
            raise ValueError("hostnode is not an object")
        hostnode_id = raw.get("id")
        if not hostnode_id:
            raise ValueError("hostnode id missing")
        resources = raw.get("available_resources") or {}
        gpus = resources.get("gpus") if isinstance(resources, dict) else None
        if not isinstance(gpus, list) or not gpus:
            raise ValueError("hostnode has no available GPUs")
        location = raw.get("location") or {}
        if not isinstance(location, dict):
            location = {}

        city = location.get("city")
        state = location.get("stateprovince")
        country_name = location.get("country")
        region = ", ".join(part for part in (city, state, country_name) if part) or None
        country = parse_country(country_name, region=region)
        uptime = raw.get("uptime_percentage")
        reliability = None
        if isinstance(uptime, (int, float)) and 0 <= uptime <= 100:
            reliability = round(float(uptime) / 100, 4)

        host_meta = {
            "hostnode_id": hostnode_id,
            "engine": raw.get("engine"),
            "location_tier": location.get("tier"),
            "host_vcpu_count": resources.get("vcpu_count"),
            "host_ram_gb": resources.get("ram_gb"),
            "host_storage_gb": resources.get("storage_gb"),
            "public_ip_available": resources.get("has_public_ip_available"),
            "pricing": raw.get("pricing"),
        }

        offers: list[NormalizedObservation] = []
        for gpu in gpus:
            if not isinstance(gpu, dict):
                continue
            slug = gpu.get("v0Name")
            price_value = gpu.get("price_per_hr")
            if not slug or price_value is None:
                continue
            price = money(price_value)
            gpu_model = humanize_gpu_slug(str(slug))
            available_count = gpu.get("availableCount")
            offers.append(
                NormalizedObservation(
                    provider=self.key,
                    provider_offer_id=f"tensordock:{hostnode_id}:{slug}",
                    gpu_model=gpu_model,
                    gpu_model_normalized=normalize_gpu_model(gpu_model),
                    gpu_count=1,
                    vram_gb=gpu_vram_from_slug(str(slug)),
                    cpu_cores=None,
                    ram_gb=None,
                    disk_gb=None,
                    region=region,
                    country=country,
                    price_per_hour=price,
                    currency="USD",
                    billing_scope="per_gpu_hour",
                    availability_scope="live_inventory",
                    executable=False,
                    reliability=reliability,
                    source=self.source,
                    source_url="https://dashboard.tensordock.com/api/v2/hostnodes",
                    source_record_id=f"{hostnode_id}:{slug}",
                    trust_tier=self.trust_tier,
                    observed_at=observed_at,
                    raw_payload=trim_payload({"gpu": gpu, **host_meta}),
                    metadata={
                        "available_gpu_count": available_count,
                        "gpu_slug": slug,
                        **host_meta,
                        "collection_channel": "provider_api",
                    },
                )
            )
        if not offers:
            raise ValueError("hostnode GPUs missing price or slug")
        return offers
