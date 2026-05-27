from __future__ import annotations

import math

from pydantic import BaseModel


class ValidatedPrice(BaseModel):
    price: float
    was_overridden: bool = False
    override_reason: str = ""


def validate_price(proposed_price: float, reservation_price: float, anchor_price: float) -> ValidatedPrice:
    if not isinstance(proposed_price, (int, float)) or math.isnan(proposed_price) or math.isinf(proposed_price):
        return ValidatedPrice(
            price=reservation_price,
            was_overridden=True,
            override_reason="Invalid numeric value; using reservation price.",
        )

    if proposed_price < reservation_price:
        return ValidatedPrice(
            price=reservation_price,
            was_overridden=True,
            override_reason="Proposed price below reservation; clamped to floor.",
        )

    if proposed_price > anchor_price:
        return ValidatedPrice(
            price=anchor_price,
            was_overridden=True,
            override_reason="Proposed price above anchor; clamped to anchor.",
        )

    return ValidatedPrice(price=round(float(proposed_price), 2))

