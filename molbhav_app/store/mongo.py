from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from functools import lru_cache
from typing import Any

from pymongo import MongoClient
from pymongo.errors import PyMongoError

from molbhav_app.config import get_settings
from molbhav_app.models.product import Product
from molbhav_app.models.session import NegotiationSession


@dataclass
class MemoryStore:
    products: dict[str, dict] = field(default_factory=dict)
    sessions: dict[str, dict] = field(default_factory=dict)
    logs: list[dict] = field(default_factory=list)


class DataStore:
    def __init__(self) -> None:
        settings = get_settings()
        self._memory = MemoryStore()
        self._client: MongoClient | None = None
        self._db = None
        try:
            self._client = MongoClient(settings.mongodb_url, serverSelectionTimeoutMS=800)
            self._client.admin.command("ping")
            self._db = self._client[settings.mongodb_db_name]
            self._db.products.create_index("_id", unique=True)
            self._db.sessions.create_index("expires_at")
            self._db.negotiation_logs.create_index("session_id")
        except PyMongoError:
            self._client = None
            self._db = None

    @property
    def using_mongo(self) -> bool:
        return self._db is not None

    def upsert_product(self, product: Product) -> None:
        doc = product.model_dump()
        doc["_id"] = doc.pop("id")
        if self._db is not None:
            self._db.products.replace_one({"_id": doc["_id"]}, doc, upsert=True)
            return
        self._memory.products[doc["_id"]] = doc

    def get_product(self, product_id: str) -> Product | None:
        doc: dict[str, Any] | None
        if self._db is not None:
            doc = self._db.products.find_one({"_id": product_id})
        else:
            doc = self._memory.products.get(product_id)

        if not doc:
            return None
        payload = dict(doc)
        payload["id"] = payload.pop("_id")
        return Product(**payload)

    def list_products(self, limit: int = 50, skip: int = 0) -> list[Product]:
        results: list[Product] = []
        if self._db is not None:
            cursor = self._db.products.find().skip(skip).limit(limit)
            for doc in cursor:
                payload = dict(doc)
                payload["id"] = payload.pop("_id")
                results.append(Product(**payload))
            return results

        values = list(self._memory.products.values())[skip : skip + limit]
        for doc in values:
            payload = dict(doc)
            payload["id"] = payload.pop("_id")
            results.append(Product(**payload))
        return results

    def save_session(self, session: NegotiationSession) -> None:
        doc = session.to_document()
        if self._db is not None:
            self._db.sessions.replace_one({"_id": session.session_id}, doc, upsert=True)
            return
        self._memory.sessions[session.session_id] = doc

    def load_session(self, session_id: str) -> NegotiationSession | None:
        if self._db is not None:
            doc = self._db.sessions.find_one({"_id": session_id})
        else:
            doc = self._memory.sessions.get(session_id)

        if not doc:
            return None

        payload = dict(doc)
        session = NegotiationSession.from_document(payload)
        if session.expires_at < datetime.now(timezone.utc):
            return None
        return session

    def add_log(self, event: dict) -> None:
        doc = dict(event)
        if self._db is not None:
            self._db.negotiation_logs.insert_one(doc)
            return
        self._memory.logs.append(doc)


@lru_cache(maxsize=1)
def get_store() -> DataStore:
    return DataStore()

