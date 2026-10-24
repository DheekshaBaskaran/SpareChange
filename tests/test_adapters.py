from datetime import datetime, timezone

import httpx
import pytest

from market_intelligence.config import Settings
from market_intelligence.providers.apify_actor import actor_item_to_observation
from market_intelligence.providers.lambda_labs import LambdaAdapter
from market_intelligence.providers.runpod import RunpodAdapter
from market_intelligence.providers.tensordock import TensorDockAdapter
from market_intelligence.providers.vastai import VastAiAdapter

NOW = datetime(2026, 10, 24, 12, 0, tzinfo=timezone.utc)


@pytest.fixture
def settings() -> Settings:
    return Settings(_env_file=None)


@pytest.fixture
def client() -> httpx.AsyncClient:
    return httpx.AsyncClient()


def test_vastai_normalizes_live_offer(settings, client) -> None:
    adapter = VastAiAdapter(settings, client)
    raw = {
        "id": 54550274,
        "gpu_name": "GTX 1650",
        "num_gpus": 2,
        "gpu_total_ram": 8192,
        "cpu_cores_effective": 8.0,
        "cpu_ram": 12033,
        "disk_space": 91.65,
        "dph_total": 0.095555,
        "dph_base": 0.093334,
        "storage_total_cost": 0.002221,
        "geolocation": "Oregon, US",
        "reliability2": 0.985066,
        "verification": "verified",
        "host_id": 437022,
    }
    observation = adapter._normalize(raw, NOW)
    assert observation.provider == "vastai"
    assert observation.provider_offer_id == "54550274"
    assert observation.gpu_model_normalized == "GTX 1650"
    assert observation.gpu_count == 2
    assert observation.vram_gb == 8.0
    assert float(observation.price_per_hour) == pytest.approx(0.095555)
    assert float(observation.price_per_gpu_hour) == pytest.approx(0.047778)
    assert observation.country == "US"
    assert observation.availability_scope == "live_inventory"
    assert observation.executable is False
    assert observation.source == "vastai_api"
    assert observation.trust_tier == "provider_api"


def test_runpod_emits_one_offer_per_cloud_tier(settings, client) -> None:
    adapter = RunpodAdapter(settings, client)
    raw = {
        "id": "NVIDIA A100-SXM4-80GB",
        "displayName": "A100 SXM",
        "memoryInGb": 80,
        "secureCloud": True,
        "communityCloud": True,
        "lowestPrice": {"minimumBidPrice": 0.89, "uninterruptablePrice": 1.39},
    }
    offers = adapter._normalize(raw, NOW)
    assert len(offers) == 2
    assert {offer.provider_offer_id for offer in offers} == {
        "runpod:NVIDIA A100-SXM4-80GB:secure_cloud",
        "runpod:NVIDIA A100-SXM4-80GB:community_cloud",
    }
    assert all(offer.gpu_model_normalized == "A100" for offer in offers)
    assert all(float(offer.price_per_hour) == pytest.approx(1.39) for offer in offers)
    assert all(offer.availability_scope == "advertised" for offer in offers)
    assert all(offer.billing_scope == "per_gpu_hour" for offer in offers)


def test_runpod_uses_spot_when_on_demand_missing(settings, client) -> None:
    adapter = RunpodAdapter(settings, client)
    offers = adapter._normalize(
        {
            "id": "NVIDIA L40S",
            "displayName": "L40S",
            "memoryInGb": 48,
            "secureCloud": False,
            "communityCloud": True,
            "lowestPrice": {"minimumBidPrice": 0.62, "uninterruptablePrice": None},
        },
        NOW,
    )
    assert len(offers) == 1
    assert float(offers[0].price_per_hour) == pytest.approx(0.62)
    assert offers[0].metadata["price_kind"] == "spot"


def test_lambda_normalizes_and_splits_regions(settings, client) -> None:
    adapter = LambdaAdapter(settings, client)
    wrapper = {
        "instance_type": {
            "name": "gpu_1x_h100_sxm5",
            "description": "1x NVIDIA H100 SXM5 80GB",
            "price_cents_per_hour": 249,
            "specs": {"gpus": 1, "vcpus": 30, "memory_gib": 200, "storage_gib": 1024},
            "regions_with_capacity_available": [
                {"name": "us-west-1", "description": "California, USA"},
                {"name": "us-east-1", "description": "Virginia, USA"},
            ],
        }
    }
    offers = adapter._normalize(wrapper, NOW)
    assert len(offers) == 2
    assert float(offers[0].price_per_hour) == pytest.approx(2.49)
    assert offers[0].gpu_model_normalized == "H100"
    assert offers[0].vram_gb == 80.0
    assert offers[0].country == "US"
    assert offers[0].provider_offer_id == "lambda:gpu_1x_h100_sxm5:us-west-1"


def test_lambda_without_capacity_becomes_advertised(settings, client) -> None:
    adapter = LambdaAdapter(settings, client)
    offers = adapter._normalize(
        {
            "instance_type": {
                "name": "gpu_8x_h100_sxm5",
                "description": "8x NVIDIA H100 SXM5 80GB",
                "price_cents_per_hour": 1992,
                "specs": {"gpus": 8, "vcpus": 240, "memory_gib": 1600, "storage_gib": 8192},
                "regions_with_capacity_available": [],
            }
        },
        NOW,
    )
    assert len(offers) == 1
    assert offers[0].availability_scope == "advertised"
    assert offers[0].gpu_count == 8
    assert float(offers[0].price_per_hour) == pytest.approx(19.92)


def test_tensordock_normalizes_hostnode_gpus(settings, client) -> None:
    adapter = TensorDockAdapter(settings, client)
    raw = {
        "id": "hostnode-uuid",
        "engine": "Narwhal",
        "uptime_percentage": 99.79,
        "available_resources": {
            "gpus": [
                {"v0Name": "h100-sxm5-80gb", "availableCount": 8, "price_per_hr": 2.2},
                {"v0Name": "geforcertx4090-pcie-24gb", "availableCount": 4, "price_per_hr": 0.5},
            ],
            "vcpu_count": 208,
            "ram_gb": 990,
            "storage_gb": 14780,
        },
        "pricing": {"per_vcpu_hr": 0.0015, "per_gb_ram_hr": 0.0007},
        "location": {
            "uuid": "location-uuid",
            "city": "Austin",
            "stateprovince": "Texas",
            "country": "United States",
            "tier": 3,
        },
    }
    offers = adapter._normalize(raw, NOW)
    assert len(offers) == 2
    by_slug = {offer.metadata["gpu_slug"]: offer for offer in offers}
    h100 = by_slug["h100-sxm5-80gb"]
    assert h100.gpu_model_normalized == "H100"
    assert h100.vram_gb == 80.0
    assert float(h100.price_per_hour) == pytest.approx(2.2)
    assert h100.country == "US"
    assert h100.reliability == pytest.approx(0.9979)
    assert h100.metadata["available_gpu_count"] == 8
    rtx = by_slug["geforcertx4090-pcie-24gb"]
    assert rtx.gpu_model_normalized == "RTX 4090"
    assert rtx.vram_gb == 24.0


def test_actor_item_mapping_forces_apify_trust_tier() -> None:
    item = {
        "provider": "vastai",
        "provider_offer_id": "123",
        "gpu_model": "NVIDIA H100 PCIe",
        "gpu_count": 1,
        "vram_gb": 80,
        "price_per_hour_usd": "2.15",
        "currency": "USD",
        "billing_scope": "per_instance_hour",
        "availability_scope": "live_inventory",
        "region": "Oregon, US",
        "observed_at": "2026-10-24T12:00:00Z",
        "source_url": "https://console.vast.ai/api/v0/bundles/",
        "source_record_id": "123",
        "trust_tier": "provider_api",
        "raw_payload": {"id": 123},
    }
    observation = actor_item_to_observation(item, expected_provider="vastai", actor_run_id="run-1")
    assert observation.trust_tier == "apify_actor"
    assert observation.source == "apify_actor"
    assert observation.executable is False
    assert observation.gpu_model_normalized == "H100"
    assert observation.country == "US"
    assert observation.metadata["actor_run_id"] == "run-1"
