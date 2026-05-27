from molbhav_app.engine.state_machine import NegotiationEngine
from molbhav_app.models.session import NegotiationSession, NegotiationState


def _session(**kwargs) -> NegotiationSession:
    baseline = {
        "product_id": "demo",
        "product_name": "Demo Phone",
        "anchor_price": 1000,
        "reservation_price": 700,
        "beta": 5.0,
        "alpha": 0.6,
        "max_rounds": 10,
    }
    baseline.update(kwargs)
    return NegotiationSession(**baseline)


def test_start_sets_proposing_state():
    session = _session()
    engine = NegotiationEngine(session)
    response = engine.start()
    assert response.state == NegotiationState.PROPOSING
    assert response.counter_price == 1000
    assert session.current_round == 0


def test_offer_above_baseline_accepts():
    session = _session(beta=1.0)
    engine = NegotiationEngine(session)
    engine.start()
    response = engine.process_buyer_offer(980)
    assert response.state == NegotiationState.AGREED
    assert response.accepted


def test_walk_away_rescue_or_break():
    session = _session(anchor_price=750, reservation_price=700)
    engine = NegotiationEngine(session)
    engine.start()
    session.current_seller_price = 730
    response = engine.handle_walk_away()
    assert response.state in {NegotiationState.RESPONDING, NegotiationState.BROKEN}

