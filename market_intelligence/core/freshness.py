"""Freshness policy derived from observation age and provider TTL."""

from __future__ import annotations

from datetime import datetime, timedelta

from market_intelligence.core.normalization import ensure_utc, utc_now
from market_intelligence.models import Freshness


def freshness_state(
    observed_at: datetime,
    ttl_seconds: int,
    *,
    now: datetime | None = None,
) -> Freshness:
    now = ensure_utc(now or utc_now())
    age = (now - ensure_utc(observed_at)).total_seconds()
    if age <= ttl_seconds:
        return "fresh"
    if age <= ttl_seconds * 4:
        return "stale"
    return "expired"


def expires_at(observed_at: datetime, ttl_seconds: int) -> datetime:
    return ensure_utc(observed_at) + timedelta(seconds=ttl_seconds)


def is_usable(observed_at: datetime, ttl_seconds: int, *, now: datetime | None = None) -> bool:
    """A price is usable for a comparison only while it is fresh."""
    return freshness_state(observed_at, ttl_seconds, now=now) == "fresh"
