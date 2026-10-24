from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from market_intelligence.core.freshness import expires_at, freshness_state, is_usable
from market_intelligence.core.normalization import (
    content_hash,
    money,
    normalize_gpu_model,
    observation_bucket,
    parse_country,
    parse_vram_gb,
    to_micros,
    to_minor,
)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("NVIDIA GeForce RTX 4090 PCIe 24GB", "RTX 4090"),
        ("RTX 4090", "RTX 4090"),
        ("NVIDIA H100 80GB HBM3", "H100"),
        ("H100 SXM5", "H100"),
        ("A100-SXM4-80GB", "A100"),
        ("NVIDIA RTX A6000", "RTX A6000"),
        ("RTX 6000 Ada Generation", "RTX 6000 Ada"),
        ("NVIDIA L40S", "L40S"),
        ("AMD Instinct MI300X OAM", "MI300X"),
        ("GeForce GTX 1650", "GTX 1650"),
        ("NVIDIA B200", "B200"),
        ("NVIDIA H200 SXM", "H200"),
        ("Some Future GPU 123", "SOME FUTURE GPU 123"),
    ],
)
def test_normalize_gpu_model(raw: str, expected: str) -> None:
    assert normalize_gpu_model(raw) == expected


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("NVIDIA GeForce RTX 4090 PCIe 24GB", 24.0),
        ("h100-sxm5-80gb", 80.0),
        ("A100 40GB", 40.0),
        (48, 48.0),
        (None, None),
        ("no memory here", None),
    ],
)
def test_parse_vram(raw, expected) -> None:
    assert parse_vram_gb(raw) == expected


@pytest.mark.parametrize(
    ("value", "region", "expected"),
    [
        ("Oregon, US", "Oregon, US", "US"),
        ("United States", None, "US"),
        ("California, USA", None, "US"),
        (None, "Austin, Texas, United States", "US"),
        ("Germany", None, "DE"),
        ("NL", None, "NL"),
        (None, None, None),
    ],
)
def test_parse_country(value, region, expected) -> None:
    assert parse_country(value, region=region) == expected


def test_money_is_six_decimal_and_non_negative() -> None:
    assert money(0.0477777777) == Decimal("0.047778")
    assert money("1.19") == Decimal("1.190000")
    assert to_micros(Decimal("0.047778")) == 47778
    assert to_minor(Decimal("0.047778")) == 5
    with pytest.raises(ValueError):
        money(-1)
    with pytest.raises(ValueError):
        money("not-a-price")


def test_freshness_states() -> None:
    now = datetime(2026, 10, 24, 12, 0, tzinfo=timezone.utc)
    assert freshness_state(now - timedelta(minutes=5), 900, now=now) == "fresh"
    assert freshness_state(now - timedelta(minutes=20), 900, now=now) == "stale"
    assert freshness_state(now - timedelta(hours=2), 900, now=now) == "expired"
    assert is_usable(now - timedelta(minutes=5), 900, now=now)
    assert not is_usable(now - timedelta(minutes=20), 900, now=now)
    assert expires_at(now, 900) == now + timedelta(minutes=15)


def test_observation_bucket_is_stable() -> None:
    observed = datetime(2026, 10, 24, 12, 3, 59, tzinfo=timezone.utc)
    assert observation_bucket(observed, 300) == datetime(
        2026, 10, 24, 12, 0, tzinfo=timezone.utc
    )


def test_content_hash_is_order_independent() -> None:
    assert content_hash({"a": 1, "b": 2}) == content_hash({"b": 2, "a": 1})
    assert content_hash({"a": 1}) != content_hash({"a": 2})
