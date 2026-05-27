# Hackathon Build Notes

## Idea Compliance Anchor
- Implementation follows the `context.txt` Mol-Bhav negotiation PRD theme:
  - bilateral price negotiation
  - game-theory inspired concession strategy
  - Hinglish persona output
  - ONDC/Beckn-ready API framing (kept lightweight in MVP)

## Clean-Room Boundary
- Old `mol-bhav` repo was used only for behavior-level reference.
- No files or code were copied verbatim into this repository.
- Data models, engine methods, API handlers, and UI were rewritten from scratch.

## Meaningful Codex Usage Evidence
- Scoped the first shippable slice to maximize judging criteria fit:
  - technical execution + usefulness first
  - originality maintained by clean-room rewrite
  - local runnable MVP prioritized over deployment work
- Converted PRD constraints into deterministic guardrails:
  - reservation price clamping
  - session cooldown + rate limit
  - timeout fallback to rule-based behavior
- Built both backend and frontend in one consistent contract loop:
  - typed response schema
  - store-driven UI state
  - single end-to-end negotiation flow

## Local Demo Script
1. Run backend, seed products, run frontend.
2. Open a product and click `Negotiate`.
3. Show round progression and fairness meter movement.
4. Trigger walk-away prompt by closing drawer mid-session.
5. Complete a deal and show final saved amount.

