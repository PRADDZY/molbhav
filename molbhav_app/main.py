from __future__ import annotations

from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from molbhav_app.api.negotiate import router as negotiate_router
from molbhav_app.api.products import router as products_router
from molbhav_app.config import get_settings
from molbhav_app.store.mongo import get_store
from molbhav_app.store.redis_guardrails import get_guardrails

settings = get_settings()
app = FastAPI(title=settings.app_name, version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.parsed_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID", uuid4().hex)
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response


@app.exception_handler(Exception)
async def unhandled_exception_handler(_: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={"detail": "Unexpected server error", "error": str(exc)},
    )


@app.get("/health")
def health() -> dict:
    store = get_store()
    guardrails = get_guardrails()
    return {
        "status": "ok",
        "engine": "molbhav-cleanroom",
        "version": "0.1.0",
        "mongo_connected": store.using_mongo,
        "redis_connected": guardrails.using_redis,
    }


app.include_router(products_router)
app.include_router(negotiate_router)

