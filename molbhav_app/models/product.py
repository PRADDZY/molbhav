from __future__ import annotations

from pydantic import BaseModel, Field, computed_field, model_validator


class Product(BaseModel):
    id: str
    name: str
    category: str = "general"
    anchor_price: float = Field(gt=0)
    cost_price: float = Field(gt=0)
    min_margin: float = Field(gt=0, le=1)
    target_margin: float = Field(gt=0, le=1)
    metadata: dict = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_logic(self) -> "Product":
        if self.cost_price >= self.anchor_price:
            raise ValueError("cost_price must be less than anchor_price")
        if self.min_margin > self.target_margin:
            raise ValueError("min_margin must not exceed target_margin")
        return self

    @computed_field
    @property
    def reservation_price(self) -> float:
        return round(self.cost_price * (1 + self.min_margin), 2)

    @computed_field
    @property
    def target_price(self) -> float:
        return round(self.cost_price * (1 + self.target_margin), 2)

