"""FastAPI dependencies shared by the route modules."""

from __future__ import annotations

from typing import Annotated

import httpx
from fastapi import Depends, Header, Request

from market_intelligence.config import Settings
from market_intelligence.database import Database
from market_intelligence.errors import ApiError


def get_settings_dep(request: Request) -> Settings:
    return request.app.state.settings


def get_database(request: Request) -> Database:
    return request.app.state.db


def get_http_client(request: Request) -> httpx.AsyncClient:
    return request.app.state.http_client


async def require_admin(
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
) -> None:
    settings: Settings = request.app.state.settings
    if not authorization or not authorization.startswith("Bearer "):
        raise ApiError("unauthorized", "admin bearer token required", status_code=401)
    token = authorization.removeprefix("Bearer ").strip()
    if not token or token != settings.market_admin_token:
        raise ApiError("forbidden", "invalid admin token", status_code=403)


SettingsDep = Annotated[Settings, Depends(get_settings_dep)]
DatabaseDep = Annotated[Database, Depends(get_database)]
HttpClientDep = Annotated[httpx.AsyncClient, Depends(get_http_client)]
AdminDep = Annotated[None, Depends(require_admin)]
