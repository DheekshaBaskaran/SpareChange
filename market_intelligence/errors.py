"""Stable error types shared by the API, adapters, and ingestion pipeline."""

from __future__ import annotations

from typing import Any


class ApiError(Exception):
    """An error that maps to the documented API error envelope."""

    def __init__(
        self,
        code: str,
        message: str,
        *,
        status_code: int = 400,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details or {}


class ProviderError(Exception):
    """A provider-side failure with safe, non-secret diagnostics."""

    code = "source_unavailable"

    def __init__(
        self,
        provider: str,
        message: str,
        *,
        retryable: bool = True,
        upstream_status: int | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.provider = provider
        self.message = message
        self.retryable = retryable
        self.upstream_status = upstream_status
        self.details = details or {}

    def diagnostics(self) -> dict[str, Any]:
        return {
            "provider": self.provider,
            "code": self.code,
            "message": self.message,
            "retryable": self.retryable,
            "upstream_status": self.upstream_status,
            "details": self.details,
        }


class ProviderCredentialsMissing(ProviderError):
    """The adapter is configured but a required credential is absent."""

    code = "source_credentials_missing"

    def __init__(self, provider: str, required_env: str) -> None:
        super().__init__(
            provider,
            f"{required_env} is not configured; {provider} collection skipped",
            retryable=False,
            details={"required_env": required_env},
        )


class ProviderSkipped(ProviderError):
    """The adapter intentionally skipped this run (not a failure)."""

    code = "source_skipped"

    def __init__(self, provider: str, reason: str) -> None:
        super().__init__(provider, reason, retryable=False)
