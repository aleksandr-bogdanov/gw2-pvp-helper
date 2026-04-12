# GW2 PvP Helper — Production Readiness

**Last updated**: 2026-04-12 | **Target**: Railway (Hobby plan) | **Budget**: ~$10-15/month

---

## Status

Everything is built. The app has auth, usage limits, BYOK, client-side scan, server-side fallback, training data collection, admin dashboard, observability hooks, and a full match/player/profile system. Three rounds of deep security audit (PRs #40-#51) hardened auth, tenant isolation, and input validation.

**What's left before shipping:**

1. **Deploy to Railway** — Dockerfile exists, never actually deployed
2. **Dogfood it** — use it yourself for real PvP sessions, fix what breaks
3. **Multi-resolution testing** — only tested on 3440x1440, other resolutions unknown

---

## Architecture

```
Browser (Canvas + tesseract-wasm + HOG k-NN)
    │
    ├── 1 KB JSON ──→ Server (SvelteKit + Postgres)
    │                    ├── Auth (invite codes, sessions)
    │                    ├── Match/player/profile storage
    │                    ├── Anthropic API proxy (advice + profiles)
    │                    └── Training data receiver
    │
    └── 600 KB JPEG ──→ (only if low-confidence scan)
```

CV runs in the browser. Server is a thin API layer. This means server costs stay flat regardless of user count.

---

## What's Built

| Feature | Status | Notes |
|---------|--------|-------|
| Client-side CV scan | Done | Canvas + tesseract-wasm + HOG k-NN, wired into paste handler |
| Server-side CV scan | Done | Sharp + Tesseract.js, kept as fallback + admin re-scan |
| Auth | Done | Invite codes (single-use), username/password, sessions, admin impersonation |
| Usage limits | Done | 15 advice (Sonnet) + 3 profile gen (Opus) lifetime, Postgres-backed |
| BYOK | Done | AES-256-GCM encrypted key storage, model selector, unlimited usage |
| Match history | Done | Paginated, filterable, inline editing |
| Player scouting | Done | Win/loss tracking, tags (friend/avoid), searchable |
| Profile generation | Done | Opus-generated from GW2 API weapon data |
| Admin dashboard | Done | User list, training viewer, debug viewer, stats, impersonation |
| Training pipeline | Done | Screenshot + metadata collection, admin review, bulk export |
| Observability | Done | Sentry + Honeycomb + Pino (all optional, skip if env vars unset) |
| Health endpoint | Done | `/api/health` with DB connectivity check |
| Dockerfile | Done | Multi-stage, Node 20 Alpine, bun install |
| Security audit | Done | 3 batches, ~47 bugs fixed (SQL injection, XSS, IDOR, race conditions) |

---

## Costs

### Railway (fixed)

| Service | Estimate |
|---------|----------|
| SvelteKit (thin API) | ~$3-4 |
| PostgreSQL | ~$3 |
| Volume (10 GB, screenshots) | ~$2 |
| **Total** | **~$8/month** |

### Anthropic API (one-time per user)

| Tier | Cost per user | Details |
|------|--------------|---------|
| Free advice (15 calls, Sonnet) | ~$0.24 | One-time, then they BYOK or stop |
| Free profile gen (3 calls, Opus) | ~$0.14 | One-time |
| BYOK users | $0 to you | They pay Anthropic directly |

10 beta users = ~$4 total API cost (one-time). After free calls are spent, monthly API cost drops to near zero.

---

## Deployment Checklist

- [ ] Create Railway project (Hobby plan, EU region)
- [ ] Add PostgreSQL service
- [ ] Add Railway volume (10 GB, mount at `/app/screenshots`)
- [ ] Set environment variables (see `.env.example`)
- [ ] Set spending limit ($25)
- [ ] Deploy from GitHub (main branch)
- [ ] Run `just db-push` equivalent (schema push)
- [ ] Smoke test: register with invite code, paste screenshot, get advice
- [ ] Generate 10 invite codes for beta

### Environment Variables (Production)

```
DATABASE_URL=          # Auto-set by Railway Postgres
ANTHROPIC_API_KEY=     # Owner's key for free tier
INVITE_CODES=          # Comma-separated, single-use
BYOK_ENCRYPTION_KEY=   # 32-byte hex for AES-256-GCM
FREE_ADVICE_LIMIT=15
FREE_PROFILE_LIMIT=3
SENTRY_DSN=            # Optional
HONEYCOMB_API_KEY=     # Optional
OTEL_SERVICE_NAME=gw2-pvp-helper
LOG_LEVEL=info
```

---

## Known Gaps

| Gap | Impact | When to fix |
|-----|--------|-------------|
| Only tested on 3440x1440 | Other resolutions may fail | After dogfooding, before public launch |
| No landing page | Can't explain the app to new users | Before public launch |
| Players page: hardcoded limit=500, no pagination | Scales poorly | When it becomes a problem |
| `matches.userProfileId` missing ON DELETE constraint | Orphaned refs possible | Next migration |
| Some dead code in stores.ts | Clutter | Low priority cleanup |

---

## Decisions

| Decision | Why |
|----------|-----|
| Lifetime limits, not daily | Some days 0 PvP, some days 10. Fairer. Natural BYOK funnel. |
| Advice quality is non-negotiable | The advice IS the product. Never downgrade models. |
| Client-side scan | Eliminates server compute. Flat costs at any user count. |
| JPEG Q85 for training screenshots | 88% smaller than PNG. Zero training value loss for HOG/OCR. |
| Everything before beta | No phased launches. Ship it all, then invite testers. |
