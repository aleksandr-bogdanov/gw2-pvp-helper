# GW2 PvP Helper

GW2 PvP match scouting app. Paste a scoreboard screenshot → CV pipeline detects elite specs + OCR names → user corrects → Claude streams tactical advice. The advice IS the product.

**This project is 100% vibe-coded.** The owner is a data engineer (Python), not a JS/TS developer. Claude writes all code.

## Key Docs

- `docs/PRODUCTION-READINESS.md` — deployment status, architecture, costs, and remaining work
- `docs/ux.md` — UX & architecture spec (source of truth for UI behavior)

## Tech Stack

- **Framework**: SvelteKit 2 (Svelte 5 runes), Tailwind CSS 4
- **Package manager**: Bun (for installs + scripts). Runtime is Node.js (no adapter-bun exists).
- **Database**: PostgreSQL + Drizzle ORM
- **CV Pipeline**: Client-side (Canvas + tesseract-wasm + HOG k-NN) with server-side fallback (Sharp + Tesseract.js)
- **AI**: Anthropic SDK — Sonnet 4.6 (advice streaming), Opus 4.6 (profile generation)
- **Testing**: Vitest
- **Deployment target**: Railway (Hobby plan), adapter-node

## Architecture

- **Browser**: Canvas + tesseract-wasm + HOG classifier → sends 1 KB JSON to server
- **Server**: thin API — auth, Postgres, Anthropic proxy, training data storage
- Low-confidence scans upload JPEG Q85 screenshots for training
- **Task runner**: `just` (justfile). Not `bun run` / npm scripts.

## Rules

- **Svelte 5 runes only** (`$state`, `$derived`, `$effect`, `$props`). No Svelte 4 syntax.
- **SvelteKit server routes** for all API endpoints. No Express/Fastify.
- **Drizzle query builder** for all DB access. No raw SQL strings.
- **TypeScript strict mode**. No `any` except Anthropic SDK interfaces.
- **SSE for streaming**, not WebSockets.
- **`Ctrl+V` paste** must work globally (not just focused inputs).
- **API keys never reach the client.** All Anthropic calls go through server routes.
- Game data (specs, weapons, maps) loaded from `data/*.json`, never hardcoded.
- **No Python in production.** Experiments live in `../gw2-research/`.
- `data/` files accessed at runtime via `resolve(process.cwd(), 'data', ...)` — NOT `__dirname` relative paths (breaks in adapter-node builds).

## Design

Dark theme, gaming HUD aesthetic. Glanceable on a second monitor in a dim room. High contrast text, muted backgrounds, colored status badges. Monospace/condensed for roster, sans-serif for briefing. "Get Advice" is the most prominent UI element.

## Non-Obvious GW2 Mappings

- Paragon → **warrior** (NOT revenant)
- Luminary → revenant
- Amalgam → engineer
- Ritualist → necromancer
- Conduit → revenant
- Evoker → elementalist

## Key Directories

- `src/lib/scan-client/` — client-side CV pipeline (browser, Canvas + tesseract-wasm)
- `src/lib/server/scan/` — server-side CV pipeline fallback (Sharp + Tesseract.js)
- `src/lib/server/db/schema.ts` — Drizzle schema (all tables)
- `src/routes/api/` — all API endpoints (scan, advice, match, profiles, generate-profile)
- `data/` — game data JSON, prompt templates, reference icons, minimap thumbs, X-button templates
- `tests/fixtures/` — 23 test screenshots (3440×1440) + ground truth
