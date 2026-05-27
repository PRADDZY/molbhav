from __future__ import annotations

import secrets
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from pydantic import BaseModel, Field

from molbhav_app.config import get_settings
from molbhav_app.dialogue.generator import DialogueGenerator
from molbhav_app.dialogue.sentiment import detect_exit_intent
from molbhav_app.engine.state_machine import EngineResult, NegotiationEngine
from molbhav_app.engine.validator import validate_price
from molbhav_app.models.offer import Actor
from molbhav_app.models.product import Product
from molbhav_app.models.session import NegotiationSession, NegotiationState
from molbhav_app.store.mongo import DataStore
from molbhav_app.store.redis_guardrails import Guardrails


class NegotiationResponse(BaseModel):
    session_id: str
    session_token: str = ""
    message: str
    current_price: float
    anchor_price: float
    state: str
    tactic: str
    sentiment: str
    rationale: str
    round: int
    max_rounds: int
    quote_ttl_seconds: int
    agreed_price: float | None = None
    metadata: dict = Field(default_factory=dict)


@dataclass
class NegotiationService:
    store: DataStore
    guardrails: Guardrails
    dialogue: DialogueGenerator

    def __post_init__(self) -> None:
        self.settings = get_settings()

    def start(
        self,
        product_id: str,
        buyer_name: str = "",
        buyer_ip: str = "",
        language: str = "en",
    ) -> NegotiationResponse:
        product = self.store.get_product(product_id)
        if not product:
            raise ValueError(f"Product {product_id} not found")

        session = NegotiationSession(
            product_id=product.id,
            product_name=product.name,
            anchor_price=product.anchor_price,
            reservation_price=product.reservation_price,
            beta=self.settings.default_beta,
            alpha=self.settings.default_alpha,
            max_rounds=self.settings.default_max_rounds,
            ttl_seconds=self.settings.default_session_ttl_seconds,
            session_token=secrets.token_urlsafe(24),
            buyer_ip=buyer_ip,
            expires_at=datetime.now(timezone.utc) + timedelta(seconds=self.settings.default_session_ttl_seconds),
        )

        engine = NegotiationEngine(session)
        result = engine.start()
        starter = buyer_name.strip() or "dost"
        dialogue = self.dialogue.generate(session, result, f"Hi, I am {starter}.", language=language)
        self.store.save_session(session)

        self.store.add_log(
            {
                "event": "session_started",
                "session_id": session.session_id,
                "product_id": product.id,
                "price": result.counter_price,
                "timestamp": datetime.now(timezone.utc),
            }
        )
        return self._build_response(session, result, dialogue.message, dialogue.sentiment, dialogue.rationale, dialogue.used_model)

    def negotiate(self, session_id: str, buyer_message: str, buyer_price: float, language: str = "en") -> NegotiationResponse:
        if not self.guardrails.acquire_session_lock(session_id):
            raise ValueError("Session is busy. Please retry.")

        try:
            session = self.store.load_session(session_id)
            if session is None:
                raise ValueError("Session not found or expired")
            if session.is_terminal():
                raise ValueError(f"Session is already {session.state.value}")

            intent = detect_exit_intent(buyer_message)
            engine = NegotiationEngine(session)
            if intent.is_leaving and intent.confidence >= 0.5:
                result = engine.handle_walk_away()
            else:
                result = engine.process_buyer_offer(buyer_price)

            dialogue = self.dialogue.generate(session, result, buyer_message, language=language)

            metadata: dict = {"model": dialogue.used_model}
            if intent.is_leaving:
                metadata["exit_intent"] = intent.trigger

            # Guardrail fallback when LLM is too slow: apply flat 5% discount, clamped by validator.
            if dialogue.timed_out and result.state == NegotiationState.RESPONDING:
                adjusted = validate_price(
                    result.counter_price * 0.95,
                    session.reservation_price,
                    session.anchor_price,
                )
                if adjusted.price != result.counter_price:
                    result.counter_price = adjusted.price
                    session.current_seller_price = adjusted.price
                    for offer in reversed(session.offer_history.offers):
                        if offer.actor == Actor.SELLER:
                            offer.price = adjusted.price
                            break
                metadata["timeout_fallback"] = True

            self.store.save_session(session)
            self.store.add_log(
                {
                    "event": "turn_processed",
                    "session_id": session.session_id,
                    "round": session.current_round,
                    "buyer_price": buyer_price,
                    "counter_price": result.counter_price,
                    "state": result.state.value,
                    "tactic": result.tactic,
                    "timestamp": datetime.now(timezone.utc),
                }
            )
            return self._build_response(
                session=session,
                result=result,
                message=dialogue.message,
                sentiment=dialogue.sentiment,
                rationale=dialogue.rationale,
                model=dialogue.used_model,
                metadata=metadata,
            )
        finally:
            self.guardrails.release_session_lock(session_id)

    def get_status(self, session_id: str) -> dict:
        session = self.store.load_session(session_id)
        if not session:
            raise ValueError("Session not found or expired")
        return {
            "session_id": session.session_id,
            "state": session.state.value,
            "current_round": session.current_round,
            "max_rounds": session.max_rounds,
            "current_seller_price": session.current_seller_price,
            "agreed_price": session.agreed_price,
        }

    @staticmethod
    def _build_response(
        session: NegotiationSession,
        result: EngineResult,
        message: str,
        sentiment: str,
        rationale: str,
        model: str,
        metadata: dict | None = None,
    ) -> NegotiationResponse:
        payload = metadata or {}
        payload["rationale"] = rationale
        payload["model"] = model
        return NegotiationResponse(
            session_id=session.session_id,
            session_token=session.session_token,
            message=message,
            current_price=result.counter_price,
            anchor_price=session.anchor_price,
            state=result.state.value,
            tactic=result.tactic,
            sentiment=sentiment,
            rationale=rationale,
            round=session.current_round,
            max_rounds=session.max_rounds,
            quote_ttl_seconds=session.ttl_seconds,
            agreed_price=session.agreed_price,
            metadata=payload,
        )
