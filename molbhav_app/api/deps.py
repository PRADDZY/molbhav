from __future__ import annotations

from functools import lru_cache

from molbhav_app.dialogue.generator import DialogueGenerator
from molbhav_app.services.negotiation_service import NegotiationService
from molbhav_app.store.mongo import get_store
from molbhav_app.store.redis_guardrails import get_guardrails


@lru_cache(maxsize=1)
def get_negotiation_service() -> NegotiationService:
    return NegotiationService(
        store=get_store(),
        guardrails=get_guardrails(),
        dialogue=DialogueGenerator(),
    )

