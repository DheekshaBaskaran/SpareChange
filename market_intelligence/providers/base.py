"""Shared provider adapter contract and bounded HTTP retry logic."""

from __future__ import annotations

import asyncio
import logging
import random
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

import httpx

from market_intelligence.config import Settings
from market_intelligence.errors import ProviderError
from market_intelligence.models import NormalizedObservation, TrustTier

logger = logging.getLogger(__name__)

USER_AGENT = "RelayMarketIntelligence/1.0 (+https://relay.market)"


@dataclass
class FetchOutcome:
    """Result of a single provider collection attempt."""

    items: list[NormalizedObservation] = field(default_factory=list)
    fetched: int = 0
    rejected: int = 0
    # False when the adapter had to truncate the source. Change detection must
    # not infer that an unseen offer disappeared from an incomplete collection.
    complete: bool = True
    diagnostics: dict[str, Any] = field(default_factory=dict)


@dataclass
class RejectedRecord:
    index: int
    reason: str


class ProviderAdapter(ABC):
    key: str
    display_name: str
    source: str
    trust_tier: TrustTier
    pricing_model: str = "fixed"
    requires_env: str | None = None

    def __init__(self, settings: Settings, client: httpx.AsyncClient) -> None:
        self.settings = settings
        self.client = client

    @abstractmethod
    async def fetch(self, limit: int) -> FetchOutcome:
        """Collect and normalize listings.

        Adapters raise ``ProviderCredentialsMissing`` when a required key is
        absent and ``ProviderError`` for upstream failures. Individual invalid
        records are counted as rejected instead of failing the whole run.
        """

    async def _request(
        self,
        method: str,
        url: str,
        *,
        attempts: int = 3,
        **kwargs: Any,
    ) -> httpx.Response:
        kwargs.setdefault("timeout", self.settings.market_http_timeout_seconds)
        kwargs.setdefault("follow_redirects", True)
        headers = dict(kwargs.pop("headers", {}) or {})
        headers.setdefault("User-Agent", USER_AGENT)
        headers.setdefault("Accept", "application/json")

        last_error: Exception | None = None
        for attempt in range(1, attempts + 1):
            try:
                response = await self.client.request(method, url, headers=headers, **kwargs)
            except httpx.HTTPError as exc:
                last_error = exc
                if attempt == attempts:
                    raise ProviderError(
                        self.key,
                        f"network error contacting {self.display_name}",
                        retryable=True,
                        details={"error": type(exc).__name__},
                    ) from exc
            else:
                if response.status_code in (429, 500, 502, 503, 504) and attempt < attempts:
                    retry_after = _retry_after_seconds(response)
                    await asyncio.sleep(retry_after or _backoff(attempt))
                    continue
                if response.status_code >= 400:
                    raise ProviderError(
                        self.key,
                        f"{self.display_name} returned HTTP {response.status_code}",
                        retryable=response.status_code in (429, 500, 502, 503, 504),
                        upstream_status=response.status_code,
                        details={"body_excerpt": _safe_excerpt(response)},
                    )
                return response

        raise ProviderError(
            self.key,
            f"{self.display_name} did not respond after {attempts} attempts",
            retryable=True,
            details={"error": type(last_error).__name__ if last_error else "unknown"},
        )

    async def _get_json(
        self, url: str, *, attempts: int = 3, **kwargs: Any
    ) -> Any:
        response = await self._request("GET", url, attempts=attempts, **kwargs)
        try:
            return response.json()
        except ValueError as exc:
            raise ProviderError(
                self.key,
                f"{self.display_name} returned a non-JSON response",
                retryable=False,
                upstream_status=response.status_code,
            ) from exc

    async def _post_json(
        self, url: str, *, payload: dict[str, Any], attempts: int = 3, **kwargs: Any
    ) -> Any:
        response = await self._request("POST", url, attempts=attempts, json=payload, **kwargs)
        try:
            return response.json()
        except ValueError as exc:
            raise ProviderError(
                self.key,
                f"{self.display_name} returned a non-JSON response",
                retryable=False,
                upstream_status=response.status_code,
            ) from exc


def _backoff(attempt: int) -> float:
    return min(8.0, 0.5 * (2 ** (attempt - 1))) + random.uniform(0, 0.25)


def _retry_after_seconds(response: httpx.Response) -> float | None:
    raw = response.headers.get("retry-after")
    if not raw:
        return None
    try:
        return min(10.0, max(0.0, float(raw)))
    except ValueError:
        return None


def _safe_excerpt(response: httpx.Response, limit: int = 240) -> str:
    text = response.text or ""
    # Provider errors can echo request details; never include headers or keys.
    return text[:limit].replace("\n", " ")
