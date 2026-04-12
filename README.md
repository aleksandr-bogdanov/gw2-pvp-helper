# GW2 PvP Helper

Match scouting tool for Guild Wars 2 PvP. Paste a scoreboard screenshot during the ~60 second pre-match timer, and get AI-generated tactical advice before the gates open.

## How It Works

1. **Paste** a PvP scoreboard screenshot (`Ctrl+V`)
2. **CV pipeline** detects elite specs (HOG k-NN, 97.5% accuracy) and OCRs player names
3. **Review** the detected roster — correct any misidentifications
4. **Get Advice** — Claude streams a tactical briefing based on team compositions, player history, and map

## Tech Stack

- **Frontend**: SvelteKit 2, Svelte 5, Tailwind CSS 4
- **Backend**: SvelteKit server routes, PostgreSQL, Drizzle ORM
- **CV Pipeline**: Client-side (Canvas + tesseract-wasm + HOG k-NN), server fallback (Sharp + Tesseract.js)
- **AI**: Anthropic Claude — Sonnet (advice), Opus (profile generation)
- **Task runner**: [just](https://github.com/casey/just)
- **Package manager**: Bun
- **Deployment**: Railway (adapter-node)

## Local Development

```bash
bun install
cp .env.example .env   # fill in DATABASE_URL, ANTHROPIC_API_KEY
just up                 # starts Postgres + pushes schema + runs dev server
```

### Commands

| Command | Description |
|---|---|
| `just up` | Start everything (Postgres + schema + dev server) |
| `just test` | Run tests (Vitest) |
| `just check` | TypeScript check |
| `just build` | Production build |
| `just db-push` | Push schema to database |
| `just db-studio` | Open Drizzle Studio (DB GUI) |
| `just db-reset` | Destroy and recreate database |
| `just fetch-api` | Refresh GW2 API data (weapon skills) |

## Deployment

The app runs on **Railway** (Hobby plan, EU region). Pushes to `main` auto-deploy.

### Architecture

```
GitHub push → Railway builds Dockerfile → pre-deploy: drizzle-kit push → healthcheck → live
```

- **Project**: `gw2-pvp-helper` on Railway
- **Services**: SvelteKit app + PostgreSQL 18
- **Volume**: 10 GB at `/app/screenshots` (training data)
- **Domain**: `https://gw2-pvp-helper-production.up.railway.app`
- **Region**: `europe-west4`

### How it works

1. Push to `main` triggers Railway build (Dockerfile, multi-stage: Node 22 Alpine)
2. **Pre-deploy**: `drizzle-kit push` runs against production Postgres to sync schema
3. **Healthcheck**: `GET /api/health` must return 200 within 120s
4. **Restart policy**: `ON_FAILURE`, max 5 retries
5. Config lives in `railway.toml` (overrides dashboard settings)

### Environment Variables

Set in Railway dashboard (not in code):

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Railway reference: `${{Postgres.DATABASE_URL}}` |
| `ANTHROPIC_API_KEY` | Yes | Owner's API key (used for free tier calls) |
| `BYOK_ENCRYPTION_KEY` | Yes | 32-byte hex string for AES-256-GCM (`openssl rand -hex 32`) |
| `ADMIN_ACCOUNTS` | No | Comma-separated GW2 account names for admin role (default: `Korsvian.6794`) |
| `FREE_ADVICE_LIMIT` | No | Lifetime free advice calls per user (default: 15) |
| `FREE_PROFILE_LIMIT` | No | Lifetime free profile gens per user (default: 3) |
| `SCREENSHOTS_DIR` | No | Screenshot storage path (default: `/app/screenshots`) |
| `SENTRY_DSN` | No | Sentry error tracking (skips if unset) |
| `HONEYCOMB_API_KEY` | No | OpenTelemetry traces (skips if unset) |
| `LOG_LEVEL` | No | Pino log level (default: `info`) |

### Key files

| File | Purpose |
|---|---|
| `Dockerfile` | Multi-stage build: bun install → vite build → Node 22 Alpine prod image |
| `railway.toml` | Build config (Dockerfile), deploy config (pre-deploy, healthcheck, restart) |
| `.github/workflows/ci.yml` | CI: typecheck + tests + build (does NOT deploy — Railway handles that) |
| `drizzle.config.ts` | Drizzle ORM config, used by pre-deploy schema push |

### Database

- Railway Postgres 18, auto-provisioned
- Schema managed by Drizzle ORM (`src/lib/server/db/schema.ts`)
- Migrations run automatically via `drizzle-kit push` pre-deploy
- Public URL available for local access: check `DATABASE_PUBLIC_URL` on the Postgres service in Railway dashboard

### Sharp (native addon)

Sharp is in `dependencies` (not `devDependencies`) so that adapter-node marks it as external for Rollup. If it were in `devDependencies`, Rollup would try to bundle the native `.node` addon and fail at runtime. The server-side scan pipeline imports Sharp dynamically in `hooks.server.ts` — if the native addon fails to load, the server still starts (client-side scan is the primary pipeline).

## Docs

- [`docs/PRODUCTION-READINESS.md`](docs/PRODUCTION-READINESS.md) — deployment status, architecture, costs
- [`docs/ux.md`](docs/ux.md) — UX spec and data model
- [`docs/minimap-detection-improvements.md`](docs/minimap-detection-improvements.md) — learned minimap references
