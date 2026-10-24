"""Normalization and validation helpers shared by every provider adapter."""

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any

_PRICE_QUANTUM = Decimal("0.000001")
_GB_PATTERN = re.compile(r"(\d+(?:\.\d+)?)\s*(?:GB|GiB|G)\b", re.IGNORECASE)
_COUNTRY_SUFFIX = re.compile(r"(?:^|[,\s])([A-Z]{2})$")
_UNKNOWN_GPU_PREFIX = re.compile(
    r"\b(?:nvidia|geforce|amd|instinct|tesla|graphics)\b", re.IGNORECASE
)
_UNKNOWN_GPU_NOISE = re.compile(
    r"\b(?:pcie|sxm\d*|sxm|hbm\d*|oam|nvl|hbm|server|edition)\b", re.IGNORECASE
)

# Ordered: more specific variants first. Normalized model names are the stable
# grouping key for historical analytics; raw provider model names are preserved.
_GPU_RULES: tuple[tuple[re.Pattern[str], str], ...] = tuple(
    (re.compile(pattern, re.IGNORECASE), canonical)
    for pattern, canonical in (
        (r"\bB300\b", "B300"),
        (r"\bB200\b", "B200"),
        (r"\bGB200\b", "GB200"),
        (r"\bH200\b", "H200"),
        (r"\bH100\b", "H100"),
        (r"\bA100\b", "A100"),
        (r"\bA10G\b", "A10G"),
        (r"\bA10\b", "A10"),
        (r"\bA40\b", "A40"),
        (r"\bL40S\b", "L40S"),
        (r"\bL40\b", "L40"),
        (r"\bL4\b", "L4"),
        (r"\bRTX\s*(?:PRO\s*)?6000\s*ADA\b", "RTX 6000 Ada"),
        (r"\bRTX\s*A6000\b", "RTX A6000"),
        (r"\bRTX\s*A5000\b", "RTX A5000"),
        (r"\bRTX\s*A4000\b", "RTX A4000"),
        (r"\bRTX\s*4090\b", "RTX 4090"),
        (r"\bRTX\s*4080\b", "RTX 4080"),
        (r"\bRTX\s*4070\s*TI\b", "RTX 4070 Ti"),
        (r"\bRTX\s*4070\b", "RTX 4070"),
        (r"\bRTX\s*4060\s*TI\b", "RTX 4060 Ti"),
        (r"\bRTX\s*4060\b", "RTX 4060"),
        (r"\bRTX\s*3090\s*TI\b", "RTX 3090 Ti"),
        (r"\bRTX\s*3090\b", "RTX 3090"),
        (r"\bRTX\s*3080\s*TI\b", "RTX 3080 Ti"),
        (r"\bRTX\s*3080\b", "RTX 3080"),
        (r"\bRTX\s*3070\s*TI\b", "RTX 3070 Ti"),
        (r"\bRTX\s*3070\b", "RTX 3070"),
        (r"\bRTX\s*3060\s*TI\b", "RTX 3060 Ti"),
        (r"\bRTX\s*3060\b", "RTX 3060"),
        (r"\bGTX\s*1650\b", "GTX 1650"),
        (r"\bGTX\s*1080\s*TI\b", "GTX 1080 Ti"),
        (r"\bGTX\s*1080\b", "GTX 1080"),
        (r"\bMI325X\b", "MI325X"),
        (r"\bMI300X\b", "MI300X"),
        (r"\bMI250X\b", "MI250X"),
        (r"\bV100\b", "V100"),
        (r"\bT4\b", "T4"),
        (r"\bP100\b", "P100"),
        (r"\bP40\b", "P40"),
    )
)

_COUNTRY_NAMES = {
    "united states": "US",
    "united states of america": "US",
    "usa": "US",
    "u.s.": "US",
    "u.s.a.": "US",
    "canada": "CA",
    "germany": "DE",
    "france": "FR",
    "netherlands": "NL",
    "united kingdom": "GB",
    "uk": "GB",
    "great britain": "GB",
    "poland": "PL",
    "sweden": "SE",
    "finland": "FI",
    "japan": "JP",
    "singapore": "SG",
    "australia": "AU",
    "india": "IN",
    "brazil": "BR",
    "spain": "ES",
    "italy": "IT",
    "switzerland": "CH",
    "norway": "NO",
    "denmark": "DK",
    "czechia": "CZ",
    "czech republic": "CZ",
    "romania": "RO",
    "south korea": "KR",
    "korea": "KR",
    "china": "CN",
    "hong kong": "HK",
    "israel": "IL",
    "united arab emirates": "AE",
    "uae": "AE",
    "south africa": "ZA",
    "mexico": "MX",
    "chile": "CL",
    "argentina": "AR",
    "turkey": "TR",
    "turkiye": "TR",
    "ukraine": "UA",
    "austria": "AT",
    "belgium": "BE",
    "ireland": "IE",
    "portugal": "PT",
    "new zealand": "NZ",
    "taiwan": "TW",
    "lithuania": "LT",
    "estonia": "EE",
    "latvia": "LV",
    "bulgaria": "BG",
    "hungary": "HU",
    "greece": "GR",
}


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def ensure_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def normalize_gpu_model(raw: str) -> str:
    """Map provider-specific GPU names to a stable analytics grouping key.

    Examples: ``NVIDIA GeForce RTX 4090 PCIe 24GB`` -> ``RTX 4090``.
    Unknown models keep a cleaned version of the provider label rather than
    being forced into a wrong family.
    """
    if not raw or not raw.strip():
        return "UNKNOWN"
    text = raw.strip()
    for pattern, canonical in _GPU_RULES:
        if pattern.search(text):
            return canonical
    cleaned = _UNKNOWN_GPU_PREFIX.sub(" ", text)
    cleaned = _GB_PATTERN.sub(" ", cleaned)
    cleaned = _UNKNOWN_GPU_NOISE.sub(" ", cleaned)
    cleaned = re.sub(r"[_/|]+", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" -,")
    if not cleaned:
        cleaned = text
    return cleaned.upper()


def parse_vram_gb(value: Any) -> float | None:
    """Extract VRAM in GB from a number, a model string, or a slug."""
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        number = float(value)
        return round(number, 2) if number >= 0 else None
    text = str(value)
    match = _GB_PATTERN.search(text)
    if match:
        return round(float(match.group(1)), 2)
    return None


def _vram_from_slug(slug: str) -> float | None:
    # TensorDock slugs look like ``h100-sxm5-80gb``.
    match = re.search(r"-(\d+)gb\b", slug, re.IGNORECASE)
    if match:
        return float(match.group(1))
    return parse_vram_gb(slug)


def parse_country(value: Any, *, region: str | None = None) -> str | None:
    """Return an ISO-3166 alpha-2 country code when it can be determined."""
    candidates: list[str] = []
    if isinstance(value, str) and value.strip():
        candidates.append(value.strip())
    if region:
        candidates.append(region.strip())

    for candidate in candidates:
        lowered = candidate.lower().strip()
        if lowered in _COUNTRY_NAMES:
            return _COUNTRY_NAMES[lowered]
        suffix = _COUNTRY_SUFFIX.search(candidate)
        if suffix:
            return suffix.group(1).upper()
        if re.fullmatch(r"[A-Za-z]{2}", candidate):
            return candidate.upper()
        for name, code in _COUNTRY_NAMES.items():
            if re.search(rf"(?:^|[,\s]){re.escape(name)}(?:$|[,\s])", lowered):
                return code
    return None


def as_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number or number in (float("inf"), float("-inf")):
        return None
    return number


def as_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def money(value: Any) -> Decimal:
    """Convert a provider price into a validated 6-decimal USD amount."""
    if isinstance(value, bool):
        raise ValueError("boolean is not a price")
    try:
        amount = Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError(f"invalid price: {value!r}") from exc
    if not amount.is_finite() or amount < 0:
        raise ValueError(f"invalid price: {value!r}")
    return amount.quantize(_PRICE_QUANTUM, rounding=ROUND_HALF_UP)


def to_micros(amount: Decimal | str | float) -> int:
    value = amount if isinstance(amount, Decimal) else Decimal(str(amount))
    return int((value * 1_000_000).to_integral_value(rounding=ROUND_HALF_UP))


def to_minor(amount: Decimal | str | float) -> int:
    value = amount if isinstance(amount, Decimal) else Decimal(str(amount))
    return int((value * 100).to_integral_value(rounding=ROUND_HALF_UP))


def content_hash(payload: dict[str, Any]) -> str:
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def observation_bucket(observed_at: datetime, bucket_seconds: int = 300) -> datetime:
    observed_at = ensure_utc(observed_at)
    epoch = int(observed_at.timestamp())
    return datetime.fromtimestamp(epoch - (epoch % bucket_seconds), tz=timezone.utc)


def trim_payload(payload: dict[str, Any], max_bytes: int = 16_384) -> dict[str, Any]:
    """Keep provider provenance without allowing one record to bloat the DB."""
    encoded = json.dumps(payload, default=str)
    if len(encoded.encode("utf-8")) <= max_bytes:
        return payload
    keys = sorted(payload.keys())
    return {"_truncated": True, "_keys": keys}


def gpu_vram_from_slug(slug: str) -> float | None:
    return _vram_from_slug(slug)
