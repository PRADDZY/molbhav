from molbhav_app.engine.validator import validate_price


def test_validator_clamps_below_floor():
    checked = validate_price(100, 700, 1000)
    assert checked.price == 700
    assert checked.was_overridden


def test_validator_clamps_above_anchor():
    checked = validate_price(1500, 700, 1000)
    assert checked.price == 1000
    assert checked.was_overridden


def test_validator_allows_in_range():
    checked = validate_price(875.555, 700, 1000)
    assert checked.price == 875.55
    assert not checked.was_overridden

