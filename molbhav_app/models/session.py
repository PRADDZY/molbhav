from __future__ import annotations

from datetime import datetime, timedelta, timezone
from enum import Enum
from uuid import uuid4

from pydantic import BaseModel, Field

from molbhav_app.models.offer import OfferHistory


class NegotiationState(str, Enum):
    IDLE = "idle"
    PROPOSING = "proposing"
    RESPONDING = "responding"
    AGREED = "agreed"
    BROKEN = "broken"
    TIMED_OUT = "timed_out"


class NegotiationSession(BaseModel):
    session_id: str = Field(default_factory=lambda: uuid4().hex)
    session_token: str = ""
    product_id: str
    product_name: str = ""

    anchor_price: float
    reservation_price: float
    beta: float = 5.0
    alpha: float = 0.6
    max_rounds: int = 10
    current_round: int = 0
    ttl_seconds: int = 300

    state: NegotiationState = NegotiationState.IDLE
    current_seller_price: float = 0.0
    agreed_price: float | None = None
    offer_history: OfferHistory = Field(default_factory=OfferHistory)

    bot_score: float = Field(default=0.0, ge=0.0, le=1.0)
    buyer_ip: str = ""

    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    expires_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc) + timedelta(minutes=5)
    )

    def is_terminal(self) -> bool:
        return self.state in {
            NegotiationState.AGREED,
            NegotiationState.BROKEN,
            NegotiationState.TIMED_OUT,
        }

    def to_document(self) -> dict:
        data = self.model_dump()
        data["_id"] = data.pop("session_id")
        return data

    @classmethod
    def from_document(cls, doc: dict) -> "NegotiationSession":
        payload = dict(doc)
        payload["session_id"] = payload.pop("_id")
        return cls(**payload)

