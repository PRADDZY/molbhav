from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from molbhav_app.api.deps import get_negotiation_service
from molbhav_app.models.product import Product
from molbhav_app.security import verify_admin_key
from molbhav_app.services.negotiation_service import NegotiationService

router = APIRouter(prefix="/api/v1/products", tags=["products"])

PRODUCT_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{1,100}$")


class CreateProductRequest(BaseModel):
    id: str
    name: str
    category: str = "general"
    anchor_price: float = Field(gt=0)
    cost_price: float = Field(gt=0)
    min_margin: float = Field(gt=0, le=1)
    target_margin: float = Field(gt=0, le=1)
    metadata: dict = Field(default_factory=dict)


@router.post("", status_code=201)
def create_product(
    body: CreateProductRequest,
    _admin: str = Depends(verify_admin_key),
    service: NegotiationService = Depends(get_negotiation_service),
) -> dict:
    if not PRODUCT_ID_RE.match(body.id):
        raise HTTPException(status_code=400, detail="Invalid product ID format")

    product = Product(**body.model_dump())
    service.store.upsert_product(product)
    return {"status": "created", "id": product.id}


@router.get("/{product_id}")
def get_product(
    product_id: str,
    service: NegotiationService = Depends(get_negotiation_service),
) -> dict:
    if not PRODUCT_ID_RE.match(product_id):
        raise HTTPException(status_code=400, detail="Invalid product ID format")
    product = service.store.get_product(product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return product.model_dump()


@router.get("")
def list_products(
    limit: int = Query(default=50, ge=1, le=200),
    skip: int = Query(default=0, ge=0),
    service: NegotiationService = Depends(get_negotiation_service),
) -> list[dict]:
    return [product.model_dump() for product in service.store.list_products(limit=limit, skip=skip)]

