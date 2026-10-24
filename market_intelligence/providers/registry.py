"""Provider adapter registry."""

from __future__ import annotations

import httpx

from market_intelligence.config import Settings
from market_intelligence.providers.base import ProviderAdapter
from market_intelligence.providers.lambda_labs import LambdaAdapter
from market_intelligence.providers.runpod import RunpodAdapter
from market_intelligence.providers.tensordock import TensorDockAdapter
from market_intelligence.providers.vastai import VastAiAdapter

ADAPTERS: dict[str, type[ProviderAdapter]] = {
    "vastai": VastAiAdapter,
    "runpod": RunpodAdapter,
    "lambda": LambdaAdapter,
    "tensordock": TensorDockAdapter,
}

PROVIDER_KEYS = tuple(ADAPTERS.keys())


def build_adapter(
    provider: str, settings: Settings, client: httpx.AsyncClient
) -> ProviderAdapter:
    try:
        adapter_class = ADAPTERS[provider]
    except KeyError as exc:
        raise KeyError(f"unknown provider: {provider}") from exc
    return adapter_class(settings, client)
