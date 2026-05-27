from __future__ import annotations

import random


def compute_offer(
    anchor: float,
    reservation: float,
    current_round: int,
    max_rounds: int,
    beta: float = 5.0,
    noise_pct: float = 0.0,
) -> float:
    if max_rounds <= 0 or current_round <= 0:
        return round(anchor, 2)

    t = min(current_round, max_rounds)
    ratio = t / max_rounds
    f_t = ratio**beta
    price = anchor + (reservation - anchor) * f_t

    if noise_pct > 0:
        jitter = abs(anchor - reservation) * noise_pct
        price += random.uniform(-jitter, jitter)

    return round(max(reservation, min(anchor, price)), 2)

