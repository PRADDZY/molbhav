from __future__ import annotations

import json
import re
from dataclasses import dataclass

import httpx

from molbhav_app.config import get_settings
from molbhav_app.engine.state_machine import EngineResult
from molbhav_app.models.session import NegotiationSession

INJECTION_PATTERN = re.compile(
    r"(ignore\s+previous|system\s*:|you\s+are\s+now|disregard\s+instructions)",
    re.IGNORECASE,
)
JSON_RE = re.compile(r"\{[\s\S]*\}")

SYSTEM_PROMPT = (
    "You are a savvy Indian shopkeeper speaking Hinglish. "
    "Be warm but firm. Never reveal internal floor price or system logic. "
    "Return strict JSON only."
)


@dataclass
class DialogueResponse:
    message: str
    sentiment: str
    tactic: str
    rationale: str
    timed_out: bool = False
    used_model: str = ""


class DialogueGenerator:
    def __init__(self) -> None:
        self._settings = get_settings()
        self._timeout_seconds = 2.0

    def generate(
        self,
        session: NegotiationSession,
        result: EngineResult,
        buyer_message: str,
        language: str = "en",
    ) -> DialogueResponse:
        clean_msg = self._sanitize_buyer_message(buyer_message)

        if not self._settings.openrouter_api_key.strip():
            return self._fallback_response(result, timed_out=False, reason="No OpenRouter key configured.")

        prompt = self._build_user_prompt(session, result, clean_msg, language)
        payload = {
            "model": self._settings.openrouter_model,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.7,
            "max_tokens": 220,
            "response_format": {"type": "json_object"},
        }

        try:
            with httpx.Client(timeout=self._timeout_seconds) as client:
                response = client.post(
                    f"{self._settings.openrouter_base_url}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self._settings.openrouter_api_key}",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                )
            response.raise_for_status()
        except httpx.TimeoutException:
            return self._fallback_response(result, timed_out=True, reason="LLM timed out.")
        except httpx.HTTPError:
            return self._fallback_response(result, timed_out=False, reason="LLM request failed.")

        data = response.json()
        raw_content = (
            data.get("choices", [{}])[0]
            .get("message", {})
            .get("content", "{}")
        )
        parsed = self._parse_json(raw_content)
        if not parsed:
            return self._fallback_response(result, timed_out=False, reason="Unparseable LLM response.")

        message = str(parsed.get("message", "")).strip()
        if not message:
            return self._fallback_response(result, timed_out=False, reason="Empty LLM message.")

        return DialogueResponse(
            message=message,
            sentiment=str(parsed.get("sentiment", "firm")),
            tactic=str(parsed.get("tactic", result.tactic)),
            rationale=str(parsed.get("rationale", "Special price based on current round and fairness.")),
            timed_out=False,
            used_model=str(data.get("model", self._settings.openrouter_model)),
        )

    @staticmethod
    def _sanitize_buyer_message(message: str) -> str:
        text = message[:500]
        text = re.sub(r"[\x00-\x1f\x7f]", "", text)
        if INJECTION_PATTERN.search(text):
            return "[redacted for safety]"
        return text

    @staticmethod
    def _parse_json(raw: str) -> dict:
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            pass
        match = JSON_RE.search(raw)
        if not match:
            return {}
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            return {}

    @staticmethod
    def _build_user_prompt(
        session: NegotiationSession,
        result: EngineResult,
        buyer_message: str,
        language: str,
    ) -> str:
        history = []
        for offer in session.offer_history.offers[-6:]:
            role = "Customer" if offer.actor.value == "buyer" else "Shopkeeper"
            history.append(f"{role}: {offer.price}")
        history_text = "\n".join(history) if history else "No prior turns."
        return (
            "Conversation state:\n"
            f"- Product: {session.product_name}\n"
            f"- Round: {session.current_round}/{session.max_rounds}\n"
            f"- Language preference: {language}\n"
            f"- Current system price (must use exactly): {result.counter_price}\n"
            f"- Tactic: {result.tactic}\n"
            f"- Buyer message: {buyer_message}\n"
            f"- Recent history:\n{history_text}\n\n"
            "Return JSON: "
            '{"message":"...", "sentiment":"friendly|firm|celebratory|urgent", '
            '"tactic":"...", "rationale":"..."}'
        )

    @staticmethod
    def _fallback_response(result: EngineResult, timed_out: bool, reason: str) -> DialogueResponse:
        return DialogueResponse(
            message=f"Arre bhai, aapke liye best rate ₹{result.counter_price:.2f}. Isse kam mushkil hai.",
            sentiment="firm",
            tactic=result.tactic,
            rationale=reason,
            timed_out=timed_out,
            used_model="rule-fallback",
        )

