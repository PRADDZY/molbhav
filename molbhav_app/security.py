from __future__ import annotations

from hmac import compare_digest

from fastapi import Header, HTTPException

from molbhav_app.config import get_settings


def verify_admin_key(x_api_key: str = Header(default="")) -> str:
    expected = get_settings().api_admin_key.strip()
    if not expected:
        # Dev mode convenience: if key not configured, allow.
        return "dev-open"
    if not compare_digest(x_api_key or "", expected):
        raise HTTPException(status_code=401, detail="Invalid admin key")
    return x_api_key


def verify_session_token(provided: str, expected: str) -> None:
    if not compare_digest(provided or "", expected or ""):
        raise HTTPException(status_code=401, detail="Invalid session token")

