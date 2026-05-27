from __future__ import annotations

from molbhav_app.models.product import Product
from molbhav_app.store.mongo import get_store

SEED_PRODUCTS = [
    Product(
        id="samsung-m15",
        name="Samsung Galaxy M15",
        category="electronics",
        anchor_price=12999,
        cost_price=8700,
        min_margin=0.05,
        target_margin=0.2,
        metadata={"brand": "Samsung", "storage": "128GB"},
    ),
    Product(
        id="boat-airdopes",
        name="boAt Airdopes 141",
        category="electronics",
        anchor_price=1499,
        cost_price=520,
        min_margin=0.12,
        target_margin=0.35,
        metadata={"brand": "boAt", "type": "TWS"},
    ),
    Product(
        id="levis-501",
        name="Levi's 501 Original",
        category="fashion",
        anchor_price=4999,
        cost_price=2200,
        min_margin=0.1,
        target_margin=0.3,
        metadata={"brand": "Levis", "fit": "Regular"},
    ),
]


def main() -> None:
    store = get_store()
    for product in SEED_PRODUCTS:
        store.upsert_product(product)
    backend = "MongoDB" if store.using_mongo else "in-memory fallback"
    print(f"Seeded {len(SEED_PRODUCTS)} products using {backend}.")


if __name__ == "__main__":
    main()

