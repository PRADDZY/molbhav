from __future__ import annotations

import threading
from datetime import datetime, timedelta, timezone
from functools import lru_cache

import redis
from redis.exceptions import RedisError

from molbhav_app.config import get_settings


class Guardrails:
    def __init__(self) -> None:
        self._settings = get_settings()
        self._redis: redis.Redis | None = None
        self._lock = threading.Lock()
        self._ip_window: dict[str, tuple[int, datetime]] = {}
        self._cooldowns: dict[str, datetime] = {}
        self._session_locks: dict[str, datetime] = {}

        try:
            self._redis = redis.Redis.from_url(self._settings.redis_url, decode_responses=True)
            self._redis.ping()
        except RedisError:
            self._redis = None

    @property
    def using_redis(self) -> bool:
        return self._redis is not None

    def allow_start(self, ip: str, max_per_minute: int) -> bool:
        if not ip:
            return True
        if self._redis is not None:
            try:
                key = f"molbhav:rl:{ip}"
                count = self._redis.incr(key)
                if count == 1:
                    self._redis.expire(key, 60)
                return count <= max_per_minute
            except RedisError:
                pass
        return self._allow_start_memory(ip, max_per_minute)

    def check_cooldown(self, session_id: str) -> bool:
        if self._redis is not None:
            try:
                key = f"molbhav:cooldown:{session_id}"
                return bool(self._redis.exists(key))
            except RedisError:
                pass

        with self._lock:
            ts = self._cooldowns.get(session_id)
            if ts is None:
                return False
            return ts > datetime.now(timezone.utc)

    def set_cooldown(self, session_id: str, min_delay_ms: int) -> None:
        ttl_seconds = max(min_delay_ms // 1000, 1)
        if self._redis is not None:
            try:
                key = f"molbhav:cooldown:{session_id}"
                self._redis.setex(key, ttl_seconds, "1")
                return
            except RedisError:
                pass

        with self._lock:
            self._cooldowns[session_id] = datetime.now(timezone.utc) + timedelta(milliseconds=min_delay_ms)

    def acquire_session_lock(self, session_id: str) -> bool:
        if self._redis is not None:
            try:
                key = f"molbhav:lock:{session_id}"
                return bool(self._redis.set(key, "1", ex=5, nx=True))
            except RedisError:
                pass

        with self._lock:
            now = datetime.now(timezone.utc)
            until = self._session_locks.get(session_id)
            if until and until > now:
                return False
            self._session_locks[session_id] = now + timedelta(seconds=5)
            return True

    def release_session_lock(self, session_id: str) -> None:
        if self._redis is not None:
            try:
                key = f"molbhav:lock:{session_id}"
                self._redis.delete(key)
                return
            except RedisError:
                pass

        with self._lock:
            self._session_locks.pop(session_id, None)

    def _allow_start_memory(self, ip: str, max_per_minute: int) -> bool:
        with self._lock:
            now = datetime.now(timezone.utc)
            count, expires_at = self._ip_window.get(ip, (0, now + timedelta(seconds=60)))
            if expires_at <= now:
                count = 0
                expires_at = now + timedelta(seconds=60)
            count += 1
            self._ip_window[ip] = (count, expires_at)
            return count <= max_per_minute


@lru_cache(maxsize=1)
def get_guardrails() -> Guardrails:
    return Guardrails()
