"""Pydantic schemas for normalized observations and the public market API."""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, PlainSerializer, field_validator, model_validator

PROVIDERS = ("vastai", "runpod", "lambda", "tensordock")
TrustTier = Literal["provider_api", "apify_actor", "manual"]
AvailabilityScope = Literal["live_inventory", "advertised"]
BillingScope = Literal["per_instance_hour", "per_gpu_hour", "per_hour"]
Freshness = Literal["fresh", "stale", "expired"]
RunStatus = Literal["running", "succeeded", "partial", "failed", "skipped"]


def _serialize_utc(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


UtcDateTime = Annotated[
    datetime,
    PlainSerializer(_serialize_utc, return_type=str, when_used="json"),
]


def _ensure_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


class NormalizedObservation(BaseModel):
    """One validated, normalized market observation ready for persistence.

    This model is not exposed as an API response. It is the boundary between
    provider-specific parsing and the shared ingestion pipeline.
    """

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    provider: str = Field(min_length=1, max_length=40)
    provider_offer_id: str = Field(min_length=1, max_length=240)
    gpu_model: str = Field(min_length=1, max_length=160)
    gpu_model_normalized: str | None = Field(default=None, max_length=80)
    gpu_count: int = Field(ge=1, le=64)
    vram_gb: float | None = Field(default=None, ge=0, le=4096)
    cpu_cores: float | None = Field(default=None, ge=0)
    ram_gb: float | None = Field(default=None, ge=0)
    disk_gb: float | None = Field(default=None, ge=0)
    region: str | None = Field(default=None, max_length=160)
    country: str | None = Field(default=None, max_length=2)
    price_per_hour: Decimal = Field(ge=0, le=Decimal("100000"), decimal_places=6)
    currency: str = Field(default="USD", min_length=3, max_length=3)
    billing_scope: BillingScope
    availability_scope: AvailabilityScope
    executable: bool = False
    reliability: float | None = Field(default=None, ge=0, le=1)
    source: str = Field(min_length=1, max_length=80)
    source_url: str | None = Field(default=None, max_length=500)
    source_record_id: str | None = Field(default=None, max_length=240)
    trust_tier: TrustTier
    observed_at: datetime
    raw_payload: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator("provider")
    @classmethod
    def _known_provider(cls, value: str) -> str:
        if value not in PROVIDERS:
            raise ValueError(f"unknown provider: {value}")
        return value

    @field_validator("currency")
    @classmethod
    def _upper_currency(cls, value: str) -> str:
        return value.upper()

    @field_validator("observed_at")
    @classmethod
    def _utc_observed_at(cls, value: datetime) -> datetime:
        return _ensure_utc(value)

    @model_validator(mode="after")
    def _fill_normalized_model(self) -> "NormalizedObservation":
        if not self.gpu_model_normalized:
            from market_intelligence.core.normalization import normalize_gpu_model

            self.gpu_model_normalized = normalize_gpu_model(self.gpu_model)
        return self

    @property
    def price_per_gpu_hour(self) -> Decimal:
        return (self.price_per_hour / self.gpu_count).quantize(Decimal("0.000001"))


class MarketOffer(BaseModel):
    id: str
    provider: str
    provider_offer_id: str
    gpu_model: str
    gpu_model_normalized: str
    gpu_count: int
    vram_gb: float | None
    cpu_cores: float | None
    ram_gb: float | None
    disk_gb: float | None
    region: str | None
    country: str | None
    price_per_hour_minor: int
    price_per_hour_micros: int
    price_per_gpu_hour_minor: int
    price_per_gpu_hour_micros: int
    currency: str
    billing_scope: str
    availability_scope: str
    executable: bool
    source: str
    source_url: str | None
    source_record_id: str | None
    trust_tier: str
    freshness: Freshness
    observed_at: UtcDateTime
    expires_at: UtcDateTime
    ingested_at: UtcDateTime
    reliability: float | None
    raw_hash: str
    metadata: dict[str, Any] = Field(default_factory=dict)


class MarketOfferPage(BaseModel):
    items: list[MarketOffer]
    next_cursor: str | None
    generated_at: UtcDateTime
    filters: dict[str, Any] = Field(default_factory=dict)


class PricePoint(BaseModel):
    bucket_start: UtcDateTime
    sample_count: int
    min_price_per_hour_micros: int
    p25_price_per_hour_micros: int
    median_price_per_hour_micros: int
    p75_price_per_hour_micros: int
    max_price_per_hour_micros: int
    avg_price_per_hour_micros: int


class PriceTrend(BaseModel):
    direction: Literal["up", "down", "flat"]
    change_micros: int
    change_percent: float | None
    first_median_micros: int | None
    last_median_micros: int | None


class PriceHistory(BaseModel):
    gpu_model: str
    gpu_model_normalized: str
    provider: str | None
    currency: str
    bucket: str
    from_: UtcDateTime = Field(serialization_alias="from")
    to: UtcDateTime
    points: list[PricePoint]
    trend: PriceTrend


class OfferCounts(BaseModel):
    total: int
    fresh: int
    providers: int
    executable: int


class GpuSummary(BaseModel):
    gpu_model_normalized: str
    provider_count: int
    fresh_offer_count: int
    median_price_per_gpu_hour_micros: int | None
    min_price_per_gpu_hour_micros: int | None
    change_percent: float | None


class MarketSummary(BaseModel):
    generated_at: UtcDateTime
    window: str
    currency: str
    offers: OfferCounts
    gpus: list[GpuSummary]


class ProviderRecord(BaseModel):
    provider: str
    display_name: str
    enabled: bool
    collection_mode: str
    trust_tier: str
    freshness_ttl_seconds: int
    last_attempt_at: UtcDateTime | None
    last_success_at: UtcDateTime | None
    last_error_at: UtcDateTime | None
    consecutive_failures: int
    last_run_id: str | None


class ProviderFreshness(BaseModel):
    provider: str
    display_name: str
    enabled: bool
    last_attempt_at: UtcDateTime | None
    last_success_at: UtcDateTime | None
    last_error_at: UtcDateTime | None
    consecutive_failures: int
    fresh_offer_count: int
    stale_offer_count: int
    oldest_fresh_observed_at: UtcDateTime | None
    last_run_id: str | None
    state: Literal["healthy", "degraded", "failed", "disabled", "never_ingested"]


class FreshnessReport(BaseModel):
    providers: list[ProviderFreshness]
    generated_at: UtcDateTime


class IngestionRunSummary(BaseModel):
    run_id: str
    provider: str
    status: RunStatus
    started_at: UtcDateTime
    finished_at: UtcDateTime | None
    fetched: int
    inserted: int
    duplicate: int
    rejected: int
    errors: int


class IngestionRunDetail(IngestionRunSummary):
    adapter: str
    trigger: str
    idempotency_key: str | None
    request_id: str | None
    diagnostics: dict[str, Any]


class IngestionBatchResponse(BaseModel):
    runs: list[IngestionRunSummary]
    idempotency_key: str | None = None


class IngestionRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider: str = Field(default="all", description="canonical provider key or 'all'")
    mode: Literal["direct", "apify", "items"] = "direct"
    limit_per_provider: int = Field(default=200, ge=1, le=1000)
    idempotency_key: str | None = Field(default=None, max_length=200)
    items: list[dict[str, Any]] | None = None
    apify_actor_id: str | None = None
    apify_input: dict[str, Any] | None = None

    @field_validator("provider")
    @classmethod
    def _provider_value(cls, value: str) -> str:
        if value != "all" and value not in PROVIDERS:
            raise ValueError("provider must be one of vastai, runpod, lambda, tensordock, all")
        return value


class ActorItemsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider: str
    actor_run_id: str | None = None
    items: list[dict[str, Any]] = Field(min_length=1, max_length=5000)
    idempotency_key: str | None = None


class ErrorBody(BaseModel):
    code: str
    message: str
    details: dict[str, Any] = Field(default_factory=dict)
    request_id: str | None = None


class ErrorEnvelope(BaseModel):
    error: ErrorBody
