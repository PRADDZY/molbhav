from fastapi.testclient import TestClient

from molbhav_app.api.deps import get_negotiation_service
from molbhav_app.dialogue.generator import DialogueGenerator
from molbhav_app.main import app
from molbhav_app.models.product import Product
from molbhav_app.services.negotiation_service import NegotiationService
from molbhav_app.store.mongo import DataStore
from molbhav_app.store.redis_guardrails import Guardrails


def _service() -> NegotiationService:
    store = DataStore()
    guardrails = Guardrails()
    service = NegotiationService(store=store, guardrails=guardrails, dialogue=DialogueGenerator())
    service.store.upsert_product(
        Product(
            id="demo-phone",
            name="Demo Phone",
            category="electronics",
            anchor_price=1000,
            cost_price=700,
            min_margin=0.05,
            target_margin=0.2,
        )
    )
    return service


def test_health():
    client = TestClient(app)
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["engine"] == "molbhav-cleanroom"


def test_negotiation_happy_path():
    service = _service()
    app.dependency_overrides[get_negotiation_service] = lambda: service
    try:
        client = TestClient(app)
        start = client.post(
            "/api/v1/negotiate/start",
            json={"product_id": "demo-phone", "buyer_name": "Pratik", "language": "en"},
        )
        assert start.status_code == 200
        payload = start.json()
        session_id = payload["session_id"]
        token = payload["session_token"]

        offer = client.post(
            f"/api/v1/negotiate/{session_id}/offer",
            json={"price": 820, "message": "thoda kam karo", "language": "en"},
            headers={"X-Session-Token": token},
        )
        assert offer.status_code == 200
        assert offer.json()["state"] in {"responding", "agreed", "timed_out"}

        status = client.get(
            f"/api/v1/negotiate/{session_id}/status",
            headers={"X-Session-Token": token},
        )
        assert status.status_code == 200
        assert status.json()["session_id"] == session_id
    finally:
        app.dependency_overrides.clear()


def test_offer_rejects_bad_session_id():
    service = _service()
    app.dependency_overrides[get_negotiation_service] = lambda: service
    try:
        client = TestClient(app)
        response = client.post(
            "/api/v1/negotiate/not-a-session/offer",
            json={"price": 700, "message": "deal?"},
            headers={"X-Session-Token": "x"},
        )
        assert response.status_code == 400
    finally:
        app.dependency_overrides.clear()

