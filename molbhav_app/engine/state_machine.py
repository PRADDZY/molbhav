from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone

from molbhav_app.engine.concession import compute_offer
from molbhav_app.engine.reciprocity import ReciprocityTracker
from molbhav_app.engine.validator import ValidatedPrice, validate_price
from molbhav_app.models.offer import Actor, Offer
from molbhav_app.models.session import NegotiationSession, NegotiationState


@dataclass
class EngineResult:
    counter_price: float
    state: NegotiationState
    tactic: str
    accepted: bool = False
    validation: ValidatedPrice | None = None
    metadata: dict = field(default_factory=dict)


class NegotiationEngine:
    def __init__(self, session: NegotiationSession):
        self.session = session
        self.tracker = ReciprocityTracker(
            alpha=session.alpha,
            max_concession=max(abs(session.anchor_price - session.reservation_price) * 0.1, 1.0),
        )
        for offer in session.offer_history.buyer_offers:
            self.tracker.record_buyer_offer(offer.price)

    def start(self) -> EngineResult:
        s = self.session
        s.state = NegotiationState.PROPOSING
        s.current_round = 0
        s.current_seller_price = s.anchor_price
        s.updated_at = datetime.now(timezone.utc)

        s.offer_history.add(
            Offer(
                round=0,
                actor=Actor.SELLER,
                price=s.anchor_price,
                message="Opening offer",
            )
        )

        return EngineResult(
            counter_price=s.anchor_price,
            state=s.state,
            tactic="opening",
        )

    def process_buyer_offer(self, buyer_price: float) -> EngineResult:
        if buyer_price <= 0:
            raise ValueError("buyer_price must be positive")

        s = self.session
        s.current_round += 1
        s.state = NegotiationState.RESPONDING
        s.updated_at = datetime.now(timezone.utc)

        buyer_offer = Offer(
            round=s.current_round,
            actor=Actor.BUYER,
            price=buyer_price,
            message="buyer_offer",
        )
        if s.offer_history.buyer_offers:
            buyer_offer.concession_delta = buyer_price - s.offer_history.buyer_offers[-1].price
        s.offer_history.add(buyer_offer)
        self.tracker.record_buyer_offer(buyer_price)

        baseline = compute_offer(
            anchor=s.anchor_price,
            reservation=s.reservation_price,
            current_round=s.current_round,
            max_rounds=s.max_rounds,
            beta=s.beta,
        )

        if buyer_price >= baseline:
            s.state = NegotiationState.AGREED
            s.agreed_price = round(buyer_price, 2)
            s.updated_at = datetime.now(timezone.utc)
            return EngineResult(
                counter_price=s.agreed_price,
                state=s.state,
                tactic="accept",
                accepted=True,
            )

        if s.current_round >= s.max_rounds:
            s.state = NegotiationState.TIMED_OUT
            s.updated_at = datetime.now(timezone.utc)
            return EngineResult(
                counter_price=s.reservation_price,
                state=s.state,
                tactic="timeout_final",
            )

        tft_drop = self.tracker.compute_ai_concession()
        current_price = s.current_seller_price or s.anchor_price
        mirrored_price = current_price - tft_drop
        candidate = min(current_price, max(baseline, mirrored_price))
        validated = validate_price(candidate, s.reservation_price, s.anchor_price)

        s.offer_history.add(
            Offer(
                round=s.current_round,
                actor=Actor.SELLER,
                price=validated.price,
                message="counter",
                concession_delta=current_price - validated.price,
            )
        )
        s.current_seller_price = validated.price

        return EngineResult(
            counter_price=validated.price,
            state=s.state,
            tactic=self._classify_tactic(current_price, validated.price, s),
            validation=validated,
        )

    def handle_walk_away(self) -> EngineResult:
        s = self.session
        current_price = s.current_seller_price or s.anchor_price
        rescue_price = current_price * 0.95
        if rescue_price < s.reservation_price:
            s.state = NegotiationState.BROKEN
            s.updated_at = datetime.now(timezone.utc)
            return EngineResult(
                counter_price=s.reservation_price,
                state=s.state,
                tactic="walk_away_failed",
            )

        validated = validate_price(rescue_price, s.reservation_price, s.anchor_price)
        s.offer_history.add(
            Offer(
                round=s.current_round,
                actor=Actor.SELLER,
                price=validated.price,
                message="walk_away_save",
                concession_delta=current_price - validated.price,
            )
        )
        s.current_seller_price = validated.price
        s.updated_at = datetime.now(timezone.utc)

        return EngineResult(
            counter_price=validated.price,
            state=s.state,
            tactic="walk_away_save",
            validation=validated,
        )

    @staticmethod
    def _classify_tactic(
        current_price: float,
        new_price: float,
        session: NegotiationSession,
    ) -> str:
        total_range = session.anchor_price - session.reservation_price
        if total_range <= 0:
            return "hold_firm"
        drop_ratio = (current_price - new_price) / total_range
        if drop_ratio <= 0.01:
            return "hold_firm"
        if drop_ratio <= 0.05:
            return "minor_concession"
        if drop_ratio <= 0.15:
            return "concession"
        return "major_concession"

