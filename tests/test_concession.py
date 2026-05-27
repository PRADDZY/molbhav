from molbhav_app.engine.concession import compute_offer


def test_round_zero_returns_anchor():
    assert compute_offer(1000, 700, 0, 10, beta=5.0) == 1000


def test_final_round_returns_reservation():
    assert compute_offer(1000, 700, 10, 10, beta=5.0) == 700


def test_linear_midpoint():
    value = compute_offer(1000, 700, 5, 10, beta=1.0)
    assert 845 <= value <= 855


def test_boulware_concedes_late():
    value = compute_offer(1000, 700, 5, 10, beta=5.0)
    assert value > 900

