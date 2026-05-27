from __future__ import annotations

import re

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field

from molbhav_app.api.deps import get_negotiation_service
from molbhav_app.config import get_settings
from molbhav_app.security import verify_session_token
from molbhav_app.services.negotiation_service import NegotiationService

router = APIRouter(prefix="/api/v1/negotiate", tags=["negotiate"])
SESSION_ID_RE = re.compile(r"^[a-f0-9]{32}$")


class StartRequest(BaseModel):
    product_id: str
    buyer_name: str = ""
    language: str = "en"


class OfferRequest(BaseModel):
    message: str = ""
    price: float = Field(gt=0)
    language: str = "en"


@router.post("/start")
def start_negotiation(
    body: StartRequest,
    request: Request,
    service: NegotiationService = Depends(get_negotiation_service),
):
    settings = get_settings()
    buyer_ip = request.client.host if request.client else ""
    allowed = service.guardrails.allow_start(buyer_ip, settings.max_requests_per_minute_per_ip)
    if not allowed:
        raise HTTPException(status_code=429, detail="Rate limit exceeded. Try again later.")

    try:
        response = service.start(
            product_id=body.product_id,
            buyer_name=body.buyer_name,
            buyer_ip=buyer_ip,
            language=body.language,
        )
        return response.model_dump()
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/{session_id}/offer")
def make_offer(
    session_id: str,
    body: OfferRequest,
    x_session_token: str = Header(default=""),
    service: NegotiationService = Depends(get_negotiation_service),
):
    if not SESSION_ID_RE.match(session_id):
        raise HTTPException(status_code=400, detail="Invalid session ID format")

    session = service.store.load_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found or expired")
    verify_session_token(x_session_token, session.session_token)

    if service.guardrails.check_cooldown(session_id):
        raise HTTPException(status_code=429, detail="Please wait before making another offer.")

    try:
        response = service.negotiate(
            session_id=session_id,
            buyer_message=body.message,
            buyer_price=body.price,
            language=body.language,
        )
        service.guardrails.set_cooldown(session_id, get_settings().min_response_delay_ms)
        return response.model_dump()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/{session_id}/status")
def get_status(
    session_id: str,
    x_session_token: str = Header(default=""),
    service: NegotiationService = Depends(get_negotiation_service),
):
    if not SESSION_ID_RE.match(session_id):
        raise HTTPException(status_code=400, detail="Invalid session ID format")

    session = service.store.load_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found or expired")
    verify_session_token(x_session_token, session.session_token)

    try:
        return service.get_status(session_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

