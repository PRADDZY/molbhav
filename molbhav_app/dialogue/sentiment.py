from __future__ import annotations

from dataclasses import dataclass


EXIT_TERMS = [
    "too expensive",
    "too costly",
    "no deal",
    "bye",
    "forget it",
    "bohot mehenga",
    "bahut mehenga",
    "chhodo",
    "nahi chahiye",
    "jaane do",
]

ANGRY_TERMS = [
    "scam",
    "waste of time",
    "loot",
    "rip off",
]


@dataclass
class ExitIntent:
    is_leaving: bool
    confidence: float
    is_angry: bool = False
    trigger: str = ""


def detect_exit_intent(message: str) -> ExitIntent:
    text = message.lower().strip()
    for word in ANGRY_TERMS:
        if word in text:
            return ExitIntent(is_leaving=True, confidence=0.9, is_angry=True, trigger=word)
    matches = [term for term in EXIT_TERMS if term in text]
    if not matches:
        return ExitIntent(is_leaving=False, confidence=0.0)
    confidence = min(1.0, 0.55 + (len(matches) * 0.1))
    return ExitIntent(is_leaving=True, confidence=confidence, trigger=matches[0])

