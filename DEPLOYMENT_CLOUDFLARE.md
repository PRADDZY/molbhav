# Cloudflare Deployment Guide

This repository now supports Cloudflare-first deployment:
- Frontend: Cloudflare Pages (`frontend/`)
- API: Cloudflare Worker (`cloudflare/worker/`)
- Data: D1 + KV + Durable Objects

## 1) Prerequisites

1. Cloudflare account with:
   - Workers enabled
   - D1 enabled
   - KV enabled
   - Durable Objects enabled
2. GitHub repository secrets configured:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
   - `CF_PAGES_PROJECT_NAME`
3. LLM provider secrets for Worker runtime:
   - `GROQ_API_KEY` (primary)
   - `OPENROUTER_API_KEY` (secondary fallback)
4. Admin mutation secret for product updates:
   - `API_ADMIN_KEY`

## 2) Cloudflare Resource Setup

### Worker + bindings

From `cloudflare/worker/wrangler.toml`, replace all `REPLACE_WITH_*` IDs:
- Preview D1 DB id
- Production D1 DB id
- Preview/production KV namespace IDs
- Preview/production Pages domains in `CORS_ALLOWED_ORIGINS`

Create secrets in both environments:

```bash
cd cloudflare/worker
npx wrangler secret put OPENROUTER_API_KEY --env preview
npx wrangler secret put OPENROUTER_API_KEY --env production
npx wrangler secret put GROQ_API_KEY --env preview
npx wrangler secret put GROQ_API_KEY --env production
npx wrangler secret put API_ADMIN_KEY --env preview
npx wrangler secret put API_ADMIN_KEY --env production
```

### D1 schema + seed

```bash
cd cloudflare/worker
npx wrangler d1 migrations apply MOLBHAV_DB --env preview --remote
npx wrangler d1 execute MOLBHAV_DB --env preview --remote --file ./seeds/seed_products.sql

npx wrangler d1 migrations apply MOLBHAV_DB --env production --remote
npx wrangler d1 execute MOLBHAV_DB --env production --remote --file ./seeds/seed_products.sql
```

## 3) Frontend Pages Setup

1. Create a Pages project and point it to this repository.
2. Build settings:
   - Build command: `npm run build`
   - Build output: `dist`
   - Root directory: `frontend`
3. Configure environment variable:
   - `VITE_API_BASE_URL` to the Worker URL for each environment:
     - preview: `https://<worker-preview-subdomain>.workers.dev`
     - production: `https://<worker-production-subdomain>.workers.dev`

## 4) GitHub Auto Deploy

Workflows:
- `.github/workflows/deploy-worker.yml`
- `.github/workflows/deploy-pages.yml`

Behavior:
- Pull requests deploy preview Worker + preview Pages branch.
- Push to `main` deploys production Worker + production Pages.

## 5) Contract + Security Notes

- API contract is preserved:
  - `POST /api/v1/negotiate/start`
  - `POST /api/v1/negotiate/{session_id}/offer`
  - `GET /api/v1/negotiate/{session_id}/status`
  - `GET /api/v1/products`
  - `POST /api/v1/products` (requires `X-API-Key`)
  - `GET /health`
- Session calls require `X-Session-Token`.
- CORS is explicit via `CORS_ALLOWED_ORIGINS`.
- LLM chain is Groq -> OpenRouter -> deterministic fallback.
- Response metadata includes `provider` for traceability (`groq`, `openrouter`, `rule-fallback`).

## 6) Smoke Test Checklist

After each deployment:

1. `GET /health` returns `status=ok`.
2. `GET /api/v1/products` returns seeded products.
3. `POST /api/v1/negotiate/start` returns `session_id` + `session_token`.
4. `POST /api/v1/negotiate/{session_id}/offer` accepts valid token.
5. `metadata.provider` is `groq` or `openrouter` in normal flow, and `rule-fallback` only on dual-provider failure.
6. UI flow on Pages can start and complete a negotiation.

## 7) Rollback

- Worker rollback: deploy previous git commit with `npx wrangler deploy --env production`.
- Pages rollback: redeploy a previous successful commit from Pages dashboard.
- D1 schema rollback: apply a rollback migration (do not mutate schema manually in production).
