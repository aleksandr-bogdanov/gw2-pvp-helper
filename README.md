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

## Setup

```bash
bun install
cp .env.example .env   # fill in DATABASE_URL, ANTHROPIC_API_KEY
just up                 # starts Postgres + pushes schema + runs dev server
```

## Commands

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

## Docs

- [`docs/PRODUCTION-READINESS.md`](docs/PRODUCTION-READINESS.md) — deployment status, architecture, costs
- [`docs/ux.md`](docs/ux.md) — UX spec and data model
- [`docs/minimap-detection-improvements.md`](docs/minimap-detection-improvements.md) — learned minimap references
