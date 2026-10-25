"""Runtime configuration for the Market Intelligence service."""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Environment-backed settings.

    Credentials are read from the process environment (or a local ``.env``)
    and are never returned by an API, logged, or committed.
    """

    model_config = SettingsConfigDict(
        env_file=(".env", ".env.local"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    app_name: str = "Relay Market Intelligence"
    environment: str = "development"
    log_level: str = "INFO"

    database_url: str = ""
    database_pool_min: int = 1
    database_pool_max: int = 8
    database_schema: str = "public"

    market_admin_token: str = "change-me-in-env"

    # Apify actor mode
    apify_token: str = ""
    apify_actor_id: str = ""
    apify_timeout_seconds: int = 120
    apify_webhook_max_items: int = 5000

    # Provider policy. Lambda and TensorDock adapters are preserved but disabled:
    # their accounts require payment details or vendor contact and they are not
    # part of scheduled collection or public demos.
    market_enabled_providers: str = "vastai,runpod,akash"

    # Provider credentials (all optional at boot; adapters report missing creds)
    vastai_api_key: str = ""
    vastai_base_url: str = "https://console.vast.ai/api/v0"
    runpod_api_key: str = ""
    runpod_graphql_url: str = "https://api.runpod.io/graphql"
    lambda_api_key: str = ""
    lambda_base_url: str = "https://cloud.lambdalabs.com/api/v1"
    tensordock_api_key: str = ""
    tensordock_base_url: str = "https://dashboard.tensordock.com/api/v2"
    akash_base_url: str = "https://console-api.akash.network/v1"

    # Data policy
    market_fresh_ttl_seconds: int = 900
    market_advertised_ttl_seconds: int = 21600
    market_http_timeout_seconds: float = 20.0
    market_max_ingest_items: int = 1000
    market_ingestion_timeout_seconds: float = 120.0
    market_observation_bucket_seconds: int = 300
    market_reobserve_seconds: int = 300
    market_event_max_batch: int = 5000

    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    @field_validator("database_url")
    @classmethod
    def _strip_database_url(cls, value: str) -> str:
        return value.strip()

    @field_validator("market_admin_token")
    @classmethod
    def _reject_empty_admin_token(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("MARKET_ADMIN_TOKEN must not be empty")
        return value.strip()

    @property
    def allowed_origins(self) -> list[str]:
        origins = [item.strip() for item in self.cors_origins.split(",")]
        return [origin for origin in origins if origin]

    @property
    def enabled_providers(self) -> list[str]:
        configured = [item.strip().lower() for item in self.market_enabled_providers.split(",")]
        return [item for item in configured if item]

    def provider_enabled(self, provider: str) -> bool:
        return provider in self.enabled_providers

    def provider_ttl(self, availability_scope: str) -> int:
        if availability_scope == "advertised":
            return self.market_advertised_ttl_seconds
        return self.market_fresh_ttl_seconds


@lru_cache
def get_settings() -> Settings:
    return Settings()
