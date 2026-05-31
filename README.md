# MolBhav Cleanroom MVP

Clean-room Outskill hackathon implementation of the MolBhav AI Negotiation Engine.

## What is in v1
- FastAPI backend with deterministic negotiation engine:
  - Time-based concession (`beta`)
  - Tit-for-tat reciprocity (`alpha`)
  - Reservation floor validator
  - Walk-away rescue behavior
- Groq-first Hinglish response layer with OpenRouter failover and deterministic fallback.
- MongoDB-backed products/sessions/logs (with local in-memory fallback if Mongo is offline).
- Redis-backed rate limit, cooldown, and session lock guardrails (with local in-memory fallback).
- Vite + React frontend:
  - Product cards
  - Negotiation bottom-sheet
  - Fairness meter
  - Walk-away prompt and final-price flow

## Quickstart

### 1) Backend
```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -e .[dev]
Copy-Item .env.example .env
python -m scripts.seed
uvicorn molbhav_app.main:app --reload
```
Backend runs at `http://localhost:8000`.

### 2) Frontend
```powershell
cd frontend
npm install
Copy-Item .env.example .env
npm run dev
```
Frontend runs at `http://localhost:5173`.

## Cloudflare Deployment

Cloudflare-native deployment is available with:
- Worker API in `cloudflare/worker`
- Pages frontend from `frontend`
- D1 + KV + Durable Objects for data, cooldowns/rate limit, and per-session locking

See [DEPLOYMENT_CLOUDFLARE.md](DEPLOYMENT_CLOUDFLARE.md) for full setup.

## Tests
```powershell
pytest -q
```

## APIs
- `POST /api/v1/negotiate/start`
- `POST /api/v1/negotiate/{session_id}/offer`
- `GET /api/v1/negotiate/{session_id}/status`
- `GET /api/v1/products`
- `POST /api/v1/products`
- `GET /health`

## Notes
- This repository intentionally avoids copying from prior codebase artifacts.
- If Mongo/Redis are unavailable, the app falls back to in-memory mode so hackathon demos are still runnable locally.
