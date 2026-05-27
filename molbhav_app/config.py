from __future__ import annotations

import json
from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "MolBhav Cleanroom MVP"
    env: str = "development"

    mongodb_url: str = "mongodb://localhost:27017"
    mongodb_db_name: str = "molbhav"
    redis_url: str = "redis://localhost:6379/0"

    openrouter_api_key: str = ""
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    openrouter_model: str = "openrouter/free"

    default_beta: float = 5.0
    default_alpha: float = 0.6
    default_max_rounds: int = 10
    default_session_ttl_seconds: int = 300

    min_response_delay_ms: int = 2000
    max_requests_per_minute_per_ip: int = 30
    api_admin_key: str = ""

    cors_allowed_origins: list[str] | str = Field(default_factory=lambda: ["http://localhost:5173"])

    def parsed_cors_origins(self) -> list[str]:
        if isinstance(self.cors_allowed_origins, list):
            return self.cors_allowed_origins
        raw = self.cors_allowed_origins.strip()
        if not raw:
            return ["http://localhost:5173"]
        if raw.startswith("["):
            try:
                parsed = json.loads(raw)
                if isinstance(parsed, list):
                    return [str(v) for v in parsed]
            except json.JSONDecodeError:
                pass
        return [part.strip() for part in raw.split(",") if part.strip()]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()

