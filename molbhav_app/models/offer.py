from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum

from pydantic import BaseModel, Field


class Actor(str, Enum):
    BUYER = "buyer"
    SELLER = "seller"


class Offer(BaseModel):
    round: int
    actor: Actor
    price: float = Field(gt=0)
    message: str = ""
    concession_delta: float = 0.0
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class OfferHistory(BaseModel):
    offers: list[Offer] = Field(default_factory=list)

    def add(self, offer: Offer) -> None:
        self.offers.append(offer)

    @property
    def buyer_offers(self) -> list[Offer]:
        return [o for o in self.offers if o.actor == Actor.BUYER]

    @property
    def last_buyer_offer(self) -> Offer | None:
        for offer in reversed(self.offers):
            if offer.actor == Actor.BUYER:
                return offer
        return None

