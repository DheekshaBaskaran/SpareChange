"""Provider adapter registry and operational status metadata."""

from __future__ import annotations

from dataclasses import asdict, dataclass

import httpx

from market_intelligence.config import Settings
from market_intelligence.providers.akash import AkashAdapter
from market_intelligence.providers.base import ProviderAdapter
from market_intelligence.providers.lambda_labs import LambdaAdapter
from market_intelligence.providers.runpod import RunpodAdapter
from market_intelligence.providers.tensordock import TensorDockAdapter
from market_intelligence.providers.vastai import VastAiAdapter

ADAPTERS: dict[str, type[ProviderAdapter]] = {
    "vastai": VastAiAdapter,
    "runpod": RunpodAdapter,
    "akash": AkashAdapter,
    "lambda": LambdaAdapter,
    "tensordock": TensorDockAdapter,
}

PROVIDER_KEYS = tuple(ADAPTERS.keys())

# These values are deliberately duplicated in the public contract. They express
# product status, not collection mechanics.
OPERATIONAL_PROVIDERS = ("vastai", "runpod")
EXPERIMENTAL_PROVIDERS = ("akash",)
DEFERRED_PROVIDERS = ("lambda", "tensordock")


@dataclass(frozen=True)
class ProviderMetadata:
    provider: str
    status: str
    pricing_model: str
    requires_credentials: str | None

    def as_dict(self) -> dict[str, str | None]:
        return asdict(self)


PROVIDER_METADATA: dict[str, ProviderMetadata] = {
    "vastai": ProviderMetadata("vastai", "operational", "fixed", None),
    "runpod": ProviderMetadata("runpod", "operational", "fixed", None),
    "akash": ProviderMetadata("akash", "experimental", "bid", None),
    "lambda": ProviderMetadata("lambda", "deferred", "fixed", "LAMBDA_API_KEY"),
    "tensordock": ProviderMetadata("tensordock", "deferred", "fixed", "TENSORDOCK_API_KEY"),
}


def provider_metadata(provider: str) -> ProviderMetadata:
    try:
        return PROVIDER_METADATA[provider]
    except KeyError as exc:
        raise KeyError(f"unknown provider: {provider}") from exc


def enabled_provider_keys(settings: Settings) -> list[str]:
    """Providers used by ``all`` and scheduled collection.

    Deferred adapters are intentionally excluded even if their credentials are
    present. An operator can still run one explicitly with ``allow_deferred``.
    """
    configured = [provider for provider in settings.enabled_providers if provider in ADAPTERS]
    return configured or ["vastai", "runpod"]


def build_adapter(
    provider: str, settings: Settings, client: httpx.AsyncClient
) -> ProviderAdapter:
    try:
        adapter_class = ADAPTERS[provider]
    except KeyError as exc:
        raise KeyError(f"unknown provider: {provider}") from exc
    return adapter_class(settings, client)
