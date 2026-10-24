"""FastAPI application for Relay Market Intelligence."""

from __future__ import annotations

import logging
import uuid
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from market_intelligence import __version__
from market_intelligence.api import admin, health, market
from market_intelligence.config import Settings, get_settings
from market_intelligence.database import Database
from market_intelligence.errors import ApiError, ProviderError

logger = logging.getLogger(__name__)


def _configure_logging(level: str) -> None:
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )


def _error_response(
    status_code: int,
    code: str,
    message: str,
    *,
    request_id: str | None = None,
    details: dict | None = None,
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={
            "error": {
                "code": code,
                "message": message,
                "details": details or {},
                "request_id": request_id,
            }
        },
        headers={"Cache-Control": "no-store"},
    )


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    _configure_logging(settings.log_level)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        db = Database(settings)
        await db.connect()
        client = httpx.AsyncClient(
            timeout=settings.market_http_timeout_seconds,
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
            follow_redirects=True,
        )
        app.state.settings = settings
        app.state.db = db
        app.state.http_client = client
        logger.info(
            "market intelligence starting environment=%s db_configured=%s",
            settings.environment,
            bool(settings.database_url),
        )
        try:
            yield
        finally:
            await client.aclose()
            await db.close()

    app = FastAPI(
        title="Relay Market Intelligence",
        version=__version__,
        description=(
            "Normalized GPU market offers, provenance, freshness, and historical pricing "
            "for Relay. Public listings are reference prices, not executable capacity. "
            "Canonical storage is Tiger Data; Elastic indexes selected records read-only."
        ),
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Request-ID", "Idempotency-Key"],
        expose_headers=["X-Request-ID"],
    )

    @app.middleware("http")
    async def request_id_middleware(request: Request, call_next):
        request_id = request.headers.get("x-request-id") or f"req_{uuid.uuid4().hex}"
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response

    @app.exception_handler(ApiError)
    async def api_error_handler(request: Request, exc: ApiError) -> JSONResponse:
        return _error_response(
            exc.status_code,
            exc.code,
            exc.message,
            request_id=getattr(request.state, "request_id", None),
            details=exc.details,
        )

    @app.exception_handler(ProviderError)
    async def provider_error_handler(request: Request, exc: ProviderError) -> JSONResponse:
        return _error_response(
            502,
            exc.code,
            exc.message,
            request_id=getattr(request.state, "request_id", None),
            details=exc.details,
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        return _error_response(
            422,
            "invalid_request",
            "request validation failed",
            request_id=getattr(request.state, "request_id", None),
            details={"errors": exc.errors()[:10]},
        )

    @app.exception_handler(Exception)
    async def unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
        request_id = getattr(request.state, "request_id", None)
        logger.exception("unhandled market API error request_id=%s", request_id)
        return _error_response(
            500,
            "internal_error",
            "internal server error",
            request_id=request_id,
        )

    app.include_router(health.router)
    app.include_router(market.router)
    app.include_router(admin.router)
    return app


app = create_app()
