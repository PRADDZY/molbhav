from __future__ import annotations


class ReciprocityTracker:
    def __init__(self, alpha: float = 0.6, max_concession: float = 200.0, window: int = 3):
        self.alpha = alpha
        self.max_concession = max_concession
        self.window = window
        self._buyer_offers: list[float] = []

    def record_buyer_offer(self, price: float) -> None:
        self._buyer_offers.append(price)

    def buyer_deltas(self) -> list[float]:
        if len(self._buyer_offers) < 2:
            return []
        return [
            self._buyer_offers[idx] - self._buyer_offers[idx - 1]
            for idx in range(1, len(self._buyer_offers))
        ]

    def average_buyer_delta(self) -> float:
        deltas = self.buyer_deltas()
        if not deltas:
            return 0.0
        chunk = deltas[-self.window :]
        return sum(chunk) / len(chunk)

    def compute_ai_concession(self) -> float:
        buyer_delta = self.average_buyer_delta()
        if buyer_delta <= 0:
            return 0.0
        return min(self.alpha * buyer_delta, self.max_concession)

