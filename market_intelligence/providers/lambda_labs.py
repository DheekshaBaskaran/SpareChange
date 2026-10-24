"""Lambda Cloud adapter.

Lambda's instance-types API requires an API key. Advertised prices are per
instance-hour; capacity is reported per region. Without a key the adapter is
skipped with a credentials diagnostic rather than fabricating prices.
"""

from __future__ import annotations

import re
from decimal import Decimal
from typing import Any

from market_intelligence.core.normalization import (
    as_float,
    as_int,
    money,
    normalize_gpu_model,
    parse_country,
    parse_vram_gb,
    trim_payload,
    utc_now,
)
from market_intelligence.errors import ProviderCredentialsMissing, ProviderError
from market_intelligence.models import NormalizedObservation
from market_intelligence.providers.base import FetchOutcome, ProviderAdapter

_GPU_COUNT_IN_NAME = re.compile(r"gpu_(\d+)x_", re.IGNORECASE)


class LambdaAdapter(ProviderAdapter):
    key = "lambda"
    display_name = "Lambda"
    source = "lambda_api"
    trust_tier = "provider_api"
    requires_env = "LAMBDA_API_KEY"

    async def fetch(self, limit: int) -> FetchOutcome:
        if not self.settings.lambda_api_key:
            raise ProviderCredentialsMissing(self.key, "LAMBDA_API_KEY")

        payload = await self._get_json(
            f"{self.settings.lambda_base_url.rstrip('/')}/instance-types",
            headers={"Authorization": f"Bearer {self.settings.lambda_api_key}"},
        )
        data = payload.get("data") if isinstance(payload, dict) else None
        if not isinstance(data, dict):
            raise ProviderError(
                self.key,
                "Lambda response did not contain a data object",
                retryable=False,
            )

        now = utc_now()
        items: list[NormalizedObservation] = []
        rejected = 0
        reasons: dict[str, int] = {}

        for wrapper in data.values():
            try:
                items.extend(self._normalize(wrapper, now))
            except (ValueError, TypeError, KeyError) as exc:
                rejected += 1
                reason = str(exc)[:160] or type(exc).__name__
                reasons[reason] = reasons.get(reason, 0) + 1

        items = items[:limit]
        return FetchOutcome(
            items=items,
            fetched=len(data),
            rejected=rejected,
            diagnostics={
                "returned_instance_types": len(data),
                "emitted_offers": len(items),
                "rejected_reasons": reasons,
                "endpoint": f"{self.settings.lambda_base_url.rstrip('/')}/instance-types",
                "authenticated": True,
            },
        )

    def _normalize(self, wrapper: Any, observed_at) -> list[NormalizedObservation]:
        if not isinstance(wrapper, dict):
            raise ValueError("instance type is not an object")
        instance = wrapper.get("instance_type", wrapper)
        if not isinstance(instance, dict):
            raise ValueError("instance_type missing")

        name = instance.get("name")
        if not name:
            raise ValueError("instance type name missing")
        description = instance.get("description") or name
        specs = instance.get("specs") or {}
        if not isinstance(specs, dict):
            specs = {}

        gpu_count = as_int(specs.get("gpus"))
        if not gpu_count:
            match = _GPU_COUNT_IN_NAME.search(str(name))
            gpu_count = int(match.group(1)) if match else 1
        if gpu_count < 1:
            raise ValueError("invalid gpu count")

        cents = instance.get("price_cents_per_hour")
        if cents is None:
            raise ValueError("price_cents_per_hour missing")
        price = money(Decimal(str(cents)) / Decimal(100))

        gpu_model = str(description)
        vram_gb = parse_vram_gb(description) or parse_vram_gb(str(name))
        vcpu = as_float(specs.get("vcpus"))
        ram = as_float(specs.get("memory_gib"))
        disk = as_float(specs.get("storage_gib"))

        regions = instance.get("regions_with_capacity_available") or []
        if not isinstance(regions, list):
            regions = []

        offers: list[NormalizedObservation] = []
        if regions:
            for region in regions:
                if not isinstance(region, dict):
                    continue
                region_name = region.get("name") or "unknown"
                region_description = region.get("description") or region_name
                offers.append(
                    self._offer(
                        name=str(name),
                        description=gpu_model,
                        region=str(region_name),
                        region_description=str(region_description),
                        gpu_count=gpu_count,
                        vram_gb=vram_gb,
                        vcpu=vcpu,
                        ram=ram,
                        disk=disk,
                        price=price,
                        availability="live_inventory",
                        observed_at=observed_at,
                        raw=instance,
                    )
                )
        else:
            offers.append(
                self._offer(
                    name=str(name),
                    description=gpu_model,
                    region=None,
                    region_description=None,
                    gpu_count=gpu_count,
                    vram_gb=vram_gb,
                    vcpu=vcpu,
                    ram=ram,
                    disk=disk,
                    price=price,
                    availability="advertised",
                    observed_at=observed_at,
                    raw=instance,
                )
            )
        return offers

    def _offer(
        self,
        *,
        name: str,
        description: str,
        region: str | None,
        region_description: str | None,
        gpu_count: int,
        vram_gb: float | None,
        vcpu: float | None,
        ram: float | None,
        disk: float | None,
        price,
        availability: str,
        observed_at,
        raw: dict[str, Any],
    ) -> NormalizedObservation:
        region_suffix = region or "advertised"
        return NormalizedObservation(
            provider=self.key,
            provider_offer_id=f"lambda:{name}:{region_suffix}",
            gpu_model=description,
            gpu_model_normalized=normalize_gpu_model(description),
            gpu_count=gpu_count,
            vram_gb=vram_gb,
            cpu_cores=vcpu,
            ram_gb=ram,
            disk_gb=disk,
            region=region,
            country=parse_country(region_description, region=region_description),
            price_per_hour=price,
            currency="USD",
            billing_scope="per_instance_hour",
            availability_scope=availability,
            executable=False,
            reliability=None,
            source=self.source,
            source_url="https://cloud.lambdalabs.com/instances",
            source_record_id=name,
            trust_tier=self.trust_tier,
            observed_at=observed_at,
            raw_payload=trim_payload(raw),
            metadata={
                "instance_type": name,
                "region_description": region_description,
                "collection_channel": "provider_api",
            },
        )
