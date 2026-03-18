# GW2 PvP Helper — Production Readiness Report v3

**Date**: 2026-03-18 | **Target**: Railway deployment | **Budget**: ~€20/month
**Audience**: Project owner (PM) + Claude (developer) | **Code**: 100% vibe-coded
**Evergreen**: This document is the living source of truth for deployment strategy.

---

## 1. What This Project Is

A web app for Guild Wars 2 PvP match scouting. During the ~60 second pre-match timer, you paste a screenshot of the PvP scoreboard. A computer vision pipeline detects elite specs (97.5% accuracy) and OCRs player names. You review/correct the roster, then Claude Sonnet streams tactical advice in real-time.

**Core value**: Turns a chaotic 60-second scramble into an informed game plan. No other GW2 tool does this.

**Launch plan**: Closed beta (10 invited users with varied hardware) → polish → public launch on GW2 forum (expected 500+ initial spike, settling to tens-hundreds).

---

## 2. Architecture: Before & After

### Current (Server-Side Everything)
```
Browser ──5 MB PNG──→ Server (Sharp + Tesseract + HOG) ──→ Result
                      ↑ heavy: 512 MB RAM, 3-4s CPU, $10/month compute
```

### Target (Client-Side Scan)
```
Browser (Canvas + tesseract-wasm + HOG) ──1 KB JSON──→ Server (thin API)
                                          ↑ only if low confidence:
                                          └──600 KB JPEG──→ Training storage
```

**Why this matters**: Moving the CV pipeline to the browser eliminates 99% of server compute. The server becomes a thin API layer: auth, match storage, Anthropic proxy, and training data receiver. This is how you serve 500 users on a $5 server.

### Client-Side Tech Stack
| Component | Current (Server) | Target (Browser) | Notes |
|-----------|-----------------|------------------|-------|
| Image preprocessing | Sharp (Node.js native) | Canvas API + OffscreenCanvas | Zero deps, universal browser support, `getImageData()` gives raw pixel arrays |
| Icon classification | HOG k-NN (pure TS) | Same code, no changes | Pure math, runs anywhere JS runs, ~40ms for 10 icons |
| OCR | Tesseract.js (Node WASM, 4 workers) | tesseract-wasm (browser, 2.1 MB) | Robert Knight's optimized build, cached in IndexedDB after first load |
| Anchor detection | NCC template matching (pure TS) | Same code, no changes | Pure math, Canvas provides the pixel buffer |

**Key constraint**: The HOG classifier, NCC anchor detection, and layout logic are pure TypeScript math — they run identically in Node.js and the browser. Only the I/O layer (Sharp → Canvas) needs to change.

### What the Server Still Does
1. **Auth** — invite codes, user sessions, admin impersonation
2. **Match storage** — Postgres: profiles, matches, players, training data metadata
3. **Anthropic API proxy** — advice streaming, profile generation. Routes to either owner's key (free tier) or user's own BYOK key. API key never reaches client.
4. **BYOK key management** — stores user's Anthropic API key (encrypted), validates it, uses it for their requests
5. **Model selection** — BYOK users choose their model (Sonnet, Opus, etc.) per request
6. **Training data receiver** — accepts JPEG screenshots + scan metadata when confidence is low
7. **Raw response storage** — stores unformatted model output alongside parsed advice for debugging
8. **Admin dashboard** — view all users, their devices, scan accuracy, impersonate, debug raw responses
9. **Learned minimap data** — persists new minimap references in DB

---

## 3. Financial Analysis (Revised for Client-Side Scan)

### 3.1 Railway Compute (Thin Server)

| Service | vCPU (avg) | RAM | Storage | Monthly cost |
|---------|-----------|-----|---------|--------------|
| SvelteKit (thin API, no Tesseract/Sharp) | 0.05 | 256 MB | — | $1.00 + $2.56 = $3.56 |
| PostgreSQL | 0.05 | 128 MB | 2 GB | $1.00 + $1.28 + $0.32 = $2.60 |
| Railway Volume (screenshots) | — | — | 10 GB | $1.60 |
| **Total resource usage** | | | | **$7.76** |

**Monthly Railway bill**: $5 subscription + ($7.76 - $5 credit) = **~$7.76/month**

That's $3/month cheaper than server-side scan, and it stays flat regardless of user count (server does no image processing).

### 3.2 Anthropic API Costs

Unchanged per-call pricing:
- **Advice (Sonnet 4.6)**: $0.025/call standard, **$0.016/call with prompt caching**
- **Profile gen (Opus 4.6)**: $0.045/call

| Scenario | Users | Scans/month | API cost/month | Total (Railway + API) |
|----------|-------|------------|----------------|----------------------|
| **Closed beta** | 10 | 600 | $9.60 + $1.35 = **$10.95** | **$18.71** |
| **Early launch** | 50 | 3,000 | $48 + $3.38 = **$51.38** | **$59.14** |
| **Settled** | 100 | 6,000 | $96 + $6.75 = **$102.75** | **$110.51** |

**The elephant in the room**: At 50+ users, Anthropic API costs dwarf everything else. Closed beta at 10 users fits the budget (~€19/month). Public launch does NOT fit €20/month.

### 3.3 Usage Model: Lifetime Limits + BYOK

The advice IS the product. Scanning is just preparation. So the business model is simple:

**Free tier (owner's API key):**
- **15 advice calls lifetime** per user (Sonnet 4.6)
- **3 profile generations lifetime** per user (Opus 4.6)
- Enough to try the app seriously and decide if it's valuable
- After exhausting free calls: prompted to add their own API key

**BYOK tier (user's own key):**
- **Unlimited** advice and profile generation
- User chooses model per request: Sonnet (fast/cheap) or Opus (thorough/expensive)
- User's key stored encrypted in DB, used only for their requests
- Owner's API costs: $0 for BYOK users

**Why lifetime, not per-day:**
- Per-day limits feel arbitrary (some days 0 PvP, some days 10 matches)
- Lifetime budget lets users spend it how they want
- Naturally pushes serious users toward BYOK — they get hooked on 15 free calls, then bring their own key
- Owner's total API exposure is bounded and predictable

**Cost modeling (owner's API key only):**

| Scenario | Users | Free advice calls | Free profile gens | **Total API cost (ONE-TIME, not monthly)** |
|----------|-------|------------------|--------------------|-------------------------------------------|
| Closed beta | 10 | 150 | 30 | $2.40 + $1.35 = **$3.75** |
| Public launch | 100 | 1,500 | 300 | $24.00 + $13.50 = **$37.50** |
| Spike | 500 | 7,500 | 1,500 | $120.00 + $67.50 = **$187.50** |

These are **one-time costs**, not recurring. Once a user burns their 15 free calls, they either BYOK or stop. No monthly API bleed.

**Monthly cost after initial spike settles:**
- Railway: $7.76/month (fixed)
- API: ~$0-5/month (only new signups using free calls)
- Total: **~$8-13/month**

This is dramatically better than per-day limits, where 100 active users would cost $96/month forever.

### 3.3.1 Think About Later: Pre-Computed Advice Templates

Not for now, but worth exploring: for very common team compositions (e.g., "5 Firebrands"), pre-compute a generic advice template and serve it instantly without an LLM call. Could reduce free-tier API usage by ~30-50% for repeat matchups. Needs research into how many unique compositions exist in practice.

### 3.3.2 Rejected Strategies

| Strategy | Why rejected |
|----------|-------------|
| Switch to cheaper/free model | The advice IS the value. Poor advice = no reason to use the app. Non-negotiable. |
| Freemium (scan-only free tier) | Scanning alone has no value. Nobody will use a tool that shows them what they can already see on screen. |
| Paid subscription | Premature. Validate with BYOK first. If users bring their own keys enthusiastically, there may never be a need to charge for the service itself. |

### 3.4 Screenshot Storage Costs

| Phase | Screenshots/month | Size | Storage cost |
|-------|------------------|------|-------------|
| Closed beta (store ALL) | 600 | 360 MB | $0.06 |
| Public launch (20% low-confidence) | 1,200 | 720 MB | $0.12 |
| Spike (500 users, 20%) | 3,000 | 1.8 GB | $0.29 |
| After 6 months accumulation | — | ~10 GB | $1.60 |

Negligible cost. A 10 GB Railway volume at $1.60/month handles 6+ months of training data.

### 3.5 Observability Costs

| Service | Tier | Cost | Limits |
|---------|------|------|--------|
| **Honeycomb** | Free | $0 | 20M events/month, 60-day retention |
| **Sentry** | Developer (free) | $0 | 5K errors/month, 7-day retention, 1 user |
| **Total** | | **$0** | More than sufficient for beta + early launch |

---

## 4. Current Issues & Fixes

### 4.1 `data/` Path Resolution (Deployment Blocker)

**Problem**: 5 files use `resolve(__dirname, '../../../../data/...')` — breaks in adapter-node builds.
**Files**: `classifier.ts:31`, `anchor.ts:26`, `minimap.ts:26-27`, `scan-llm.ts:10`
**Fix**: Change to `resolve(process.cwd(), 'data', ...)` — consistent with how `advice/+server.ts` already works.
**Note**: After client-side migration, these server-side scan files become less critical (only used as fallback or for admin re-scan). But they still need fixing for the server to function during the transition period.

### 4.2 adapter-auto → adapter-node

**Fix**: `npm uninstall @sveltejs/adapter-auto && npm install -D @sveltejs/adapter-node`, update `svelte.config.js`.

### 4.3 No Authentication

**Fix**: Implement invite-code system with user accounts (see Section 5.1).

### 4.4 No Rate Limiting

**Fix**: Postgres-backed rate limiting (survives restarts) on `/api/advice` and training data upload (see Section 5.2).

### 4.5 No Multi-tenancy

**Fix**: Add `users` table, `user_id` FK on all existing tables, session management (see Section 5.1).

### 4.6 NUM_WORKERS = 4 in ocr.ts

**Fix**: Change to 2 for server-side fallback. After client-side migration, remove server-side Tesseract entirely.

### 4.7 Screenshot Storage on Ephemeral Filesystem

**Fix**: Railway volume mounted at `/app/screenshots/`, served via API endpoint (not static directory).

---

## 5. Architecture: What to Build

### 5.1 Auth & Multi-Tenancy

**Not OAuth. Not "simple invite code." Proper lightweight user accounts.**

```
New table: users
├── id (serial PK)
├── username (text, unique) — chosen by user on first visit
├── invite_code_used (text) — which invite code they redeemed
├── role ('user' | 'admin')
├── device_info (jsonb) — screen resolution, browser, OS
├── created_at (timestamp)
└── last_seen_at (timestamp)

Modified tables: add user_id FK to
├── user_profiles
├── matches
└── match_players (inherits via match)
```

**Flow**:
1. First visit → "Enter invite code" screen
2. Valid code → "Choose a username" screen
3. Username stored in `users` table, session cookie (httpOnly, 30-day expiry)
4. All API routes check session → reject with 401 if invalid
5. All queries filter by `user_id` (except shared player scouting data)

**Invite codes**: Stored as env var list: `INVITE_CODES=alpha-tester-01,alpha-tester-02,...,alpha-tester-10`. Each code is single-use (tracked in DB). You generate 10 for beta, more for public launch.

**Admin impersonation**: Admin user (role='admin') can add `?as=<user_id>` to any page. Server checks admin role, then renders the page as if logged in as that user. Session stays admin, but data scope switches. This lets you see exactly what each beta tester sees.

**GDPR awareness**: Store a `consent_given_at` timestamp. Show a simple notice: "We store your screenshots and device info to improve the scanning accuracy. You can delete your data at any time." Add a "Delete my data" button that cascades.

### 5.2 Usage Limits & BYOK (Postgres-Backed)

Lifetime usage tracking, not daily quotas. Survives container restarts.

```
Modified table: users (add columns)
├── advice_calls_remaining (integer, default 15)
├── profile_gens_remaining (integer, default 3)
├── byok_api_key_encrypted (text, nullable) — AES-256-GCM encrypted
├── byok_model_preference (text, default 'claude-sonnet-4-6')
```

**Free tier limits** (configurable via env vars):
- `FREE_ADVICE_LIMIT=15` — lifetime advice calls on owner's Anthropic key
- `FREE_PROFILE_LIMIT=3` — lifetime profile generations on owner's key (Opus = expensive)
- Scan/training uploads: unlimited (no LLM cost)

**How it works:**
1. On each `/api/advice` call: check `advice_calls_remaining > 0` OR `byok_api_key_encrypted IS NOT NULL`
2. If free tier: decrement `advice_calls_remaining`, use owner's API key
3. If BYOK: use user's encrypted key, no decrement (unlimited)
4. Profile gen: same logic with `profile_gens_remaining`
5. UI shows: "You have X free advice calls remaining" or "Using your API key (unlimited)"
6. When free calls hit 0: prompt "Add your Anthropic API key in Settings for unlimited access"

**BYOK implementation:**
- Settings page: "Anthropic API Key" input field + "Test Key" button
- Key encrypted with AES-256-GCM before DB storage (encryption key from env var `BYOK_ENCRYPTION_KEY`)
- On advice request: decrypt key in memory, pass to Anthropic SDK, never log or expose
- Key validation: make a cheap `/v1/messages` call with `max_tokens: 1` on save to verify key works
- If user's key fails (revoked, rate-limited): fall back to error message, don't use owner's key

**Model selector (BYOK only):**
- Dropdown in advice request UI: "Sonnet 4.6 (fast)" | "Opus 4.6 (thorough)"
- Stored per-user in `byok_model_preference`
- Only available when BYOK key is set — free tier always uses Sonnet
- Streaming works the same regardless of model (SSE)
- Owner/admin can also use this to test Opus vs Sonnet advice quality

**Cost**: ~1ms per request (simple column check). Negligible overhead.

### 5.3 Client-Side CV Pipeline

This is the biggest engineering effort. Here's the migration plan:

**Phase 1: Extract scan pipeline into a standalone module**
- Create `src/lib/scan-client/` — browser-compatible version of `src/lib/server/scan/`
- Replace Sharp calls with Canvas API:
  - `loadImageGrayscale()` → `createImageBitmap()` + canvas `getImageData()` + manual grayscale
  - `extractROI()` → canvas `drawImage(src, sx, sy, sw, sh, 0, 0, dw, dh)`
  - `resizeGrayscale()` → canvas resize with `drawImage()`
- HOG classifier: copy as-is (pure math, no Node.js deps)
- NCC anchor detection: copy as-is
- Layout logic: copy as-is

**Phase 2: Replace Tesseract.js with tesseract-wasm**
- Install `tesseract-wasm` (2.1 MB vs 15 MB)
- Implement OCR wrapper matching current API: `recognizeNames(crops) → string[]`
- Cache WASM + English data in Service Worker for instant subsequent loads
- First-load experience: show "Downloading OCR engine (2 MB, one-time)..." progress bar

**Phase 3: Wire into the UI**
- On paste: run scan pipeline in-browser
- Show results + confidence scores
- If ALL specs have confidence > 0.85 AND ALL names have confidence > 0.5:
  - Send only JSON roster (1 KB) to server → proceed to advice
- If ANY item below threshold:
  - Upload screenshot as JPEG Q85 (600 KB) to server for training
  - Flag low-confidence items in the UI for user correction
  - After correction, send corrected roster + original scan result to server

**Phase 4: Server-side scan as fallback**
- Keep `src/lib/server/scan/` for:
  - Admin re-scanning of uploaded training screenshots
  - API endpoint for programmatic access (future)
  - Batch processing of training data

**Effort estimate**: ~2 weeks for Phase 1-3 (Claude coding, user testing).

### 5.4 Training Data Pipeline

This is a FIRST-CLASS feature, not an afterthought.

```
New table: training_samples
├── id (serial PK)
├── user_id (FK → users)
├── screenshot_hash (text, unique) — SHA256 first 16 chars
├── screenshot_path (text) — path on Railway volume
├── resolution (text) — e.g., "3440x1440", "2560x1440", "1920x1080"
├── ui_size (text) — detected UI size or null
├── device_info (jsonb) — browser, OS, screen DPI
├── scan_result (jsonb) — what the CV pipeline detected
├── user_corrections (jsonb) — what the user corrected (null if perfect)
├── confidence_scores (jsonb) — per-slot confidence for icons + names
├── anchor_position (jsonb) — {x, y, ui_size} for layout calibration
├── created_at (timestamp)
└── reviewed_by_admin (boolean, default false)
```

**What gets stored**:
- During beta: ALL screenshots + scan results + corrections + device info
- During public launch: only LOW-CONFIDENCE screenshots (threshold configurable)
- User corrections are the gold: they're labeled training data for free

**Admin training dashboard** (new route: `/admin/training`):
- Table of all training samples, sortable by confidence, resolution, date
- Click to view: screenshot + detected roster vs corrected roster side-by-side
- Filter by resolution (crucial for multi-resolution support)
- Bulk export as labeled dataset (JSON + images)
- Stats: accuracy per resolution, most common misclassifications

**How this feeds model improvement**:
1. Beta users scan on their hardware → corrections stored
2. You review in admin dashboard → confirm/reject corrections
3. Export labeled data → retrain classifier (add new resolution layouts, tune thresholds)
4. Currently the classifier uses cosine distance against reference icons — adding more reference data from real-world crops improves accuracy
5. OCR corrections feed into a fuzzy name dictionary for better matching

**JPEG Q85 for training screenshots**: Analysis confirms this preserves full training value for both HOG features (8×8 cell gradients unaffected) and OCR (binarization threshold has 100+ gray levels of headroom). Saves 88% vs PNG (600 KB vs 5 MB).

### 5.5 Multi-Resolution Support

**The #1 technical risk for public launch.**

Currently hardcoded for 3440×1440 with 4 UI sizes. Other resolutions (2560×1440, 1920×1080, 2560×1080, etc.) will have different anchor positions and layout offsets.

**Hypothesis**: GW2's UI scales proportionally with resolution. If the scoreboard is at the same *proportional* position on screen, the offsets from the anchor point (X button) should scale linearly with resolution.

**Validation plan (closed beta)**:
1. Beta testers report their resolution on signup (stored in `device_info`)
2. ALL screenshots stored during beta (regardless of confidence)
3. Anchor detection runs — if it finds the X button, the relative offsets should be computable
4. If anchor detection fails entirely → new template needed for that resolution
5. Admin dashboard shows: "Resolution X: anchor found Y/Z times, classification accuracy W%"

**Scaling strategy**:
- The anchor X button looks the same at all resolutions (just different pixel sizes)
- If we normalize all coordinates to proportional (0-1) range, one layout preset might work for all resolutions
- Beta data will prove or disprove this hypothesis

**Fallback if hypothesis is wrong**: Generate layout presets per resolution from beta data. With 10 beta testers covering 3-4 common resolutions, we'd have enough data to calibrate.

### 5.6 Learned Minimap Data (Production-Grade)

Move learned minimap references from filesystem to database:

```
New table: minimap_references
├── id (serial PK)
├── map_id (text) — e.g., 'djinns_dominion'
├── mode (text) — 'conquest' | 'push'
├── thumbnail (bytea) — 16×16 RGB raw bytes (768 bytes per entry)
├── source (text) — 'built_in' | 'learned'
├── resolution (text) — source screenshot resolution
├── created_at (timestamp)
```

On startup, load all references into memory (they're tiny: 768 bytes × ~50 entries = 38 KB). When a new map is detected with high confidence, insert a learned reference. This survives deploys, is queryable, and is per-resolution.

### 5.7 Observability (Go Overboard)

#### Sentry (Error Tracking)
- `@sentry/sveltekit` — drops into existing SvelteKit app
- Captures: unhandled exceptions, failed API calls, client-side errors
- Session replay (50/month free) — see exactly what happened before a crash
- Free tier: 5K errors/month, 7-day retention — sufficient for beta
- Configure: source maps for readable stack traces, environment tags

#### Honeycomb (Tracing & Observability)
- `@honeycombio/opentelemetry-node` — auto-instruments HTTP, DB, fetch
- Custom spans for: scan pipeline, advice generation, training data upload
- Trace a full request: auth check → DB query → Anthropic API → SSE stream
- Free tier: 20M events/month, 60-day retention — wildly sufficient
- Key metrics to track:
  - `scan.duration_ms`, `scan.confidence_avg`, `scan.resolution`
  - `advice.tokens_in`, `advice.tokens_out`, `advice.cost_usd`
  - `user.id`, `user.resolution`, `user.browser`
  - `training.upload_count`, `training.correction_rate`

#### Structured Logging
- Use `pino` (fastest Node.js logger, JSON output, works with Honeycomb)
- Every log line: `{ ts, level, event, userId, requestId, ...data }`
- Railway captures stdout → searchable in Railway's log viewer
- Honeycomb also ingests structured logs as events

### 5.8 Raw Response Debug Viewer

**Problem**: The advice gets parsed and formatted before display. When something looks wrong, you can't tell if it's a prompt issue, a parsing bug, or a model hallucination.

**Solution**: Store and expose the raw model response.

```
Modified table: matches (add column)
├── advice_raw (text) — full unformatted model output, exactly as streamed
```

The `advice_raw` column stores the complete concatenated SSE text deltas — no formatting, no parsing, no truncation. This is the ground truth of what the model actually said.

**Debug button** (admin/owner only):
- On the match page, after advice is displayed: small "Debug" icon (bug emoji or `</>` button)
- Clicking it opens a modal/panel showing:
  - The raw `advice_raw` text in a monospace `<pre>` block
  - The system prompt that was sent (reconstructed from profile + game knowledge layers)
  - The user message (roster + map)
  - Token counts (input/output) and model used
  - Cost of this specific call
- Visible only to users with `role='admin'` (hidden for regular users)
- Also accessible in admin dashboard per match

**Why this matters**:
- Debug prompt engineering: see exactly what the model produces before parsing
- Catch parsing bugs: if the raw output is good but the UI mangles it, you know where the bug is
- Compare models: when testing Opus vs Sonnet via BYOK, compare raw outputs side-by-side
- Improve prompts: iterate on the system prompt layers with evidence

#### What You'll Be Able to See
- "User X on 1920×1080 Chrome has 60% scan accuracy — all icons misclassified" → need new layout preset for that resolution
- "Advice requests spike at 18:00-22:00 UTC (EU evening)" → capacity planning
- "OCR confidence below 0.3 on 15% of beta scans" → OCR needs tuning
- "User Y corrected 8 of 10 specs on every scan" → their resolution isn't supported

---

## 6. Deployment Configuration

### 6.1 Dockerfile (Revised — No Tesseract/Sharp in Production)

After client-side migration, the server no longer needs Sharp or Tesseract:

```dockerfile
FROM node:20-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# --- Production stage ---
FROM node:20-alpine

WORKDIR /app

COPY --from=builder /app/build ./build
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Data files for server-side scan fallback + prompt templates
COPY --from=builder /app/data ./data

# Railway volume mount point for training screenshots
RUN mkdir -p /app/screenshots

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s \
  CMD wget -q --spider http://localhost:3000/api/health || exit 1

CMD ["node", "build/index.js"]
```

**Key change**: Start period drops from 60s to 30s (no Tesseract warmup needed). Container is much lighter (~256 MB RAM vs 512 MB).

**Note**: During the transition period (before client-side scan is ready), use the original Dockerfile from v1 report with Tesseract warmup.

### 6.2 Railway Configuration

| Setting | Value |
|---------|-------|
| **Plan** | Hobby ($5/month) |
| **Spending limit** | $25 (Railway + Postgres, gives headroom) |
| **Region** | EU (most GW2 PvP players are EU) |
| **Volume** | 10 GB mounted at `/app/screenshots` |

**Environment variables**:
```
ANTHROPIC_API_KEY=sk-ant-...              # Owner's key (used for free tier calls)
DATABASE_URL=postgresql://...              # Auto-set by Railway Postgres
INVITE_CODES=alpha-01,alpha-02,...,alpha-10 # Comma-separated, single-use
SENTRY_DSN=https://...@sentry.io/...
HONEYCOMB_API_KEY=...
BYOK_ENCRYPTION_KEY=...                    # AES-256 key for encrypting user API keys
NODE_ENV=production
FREE_ADVICE_LIMIT=15                       # Lifetime free advice calls per user
FREE_PROFILE_LIMIT=3                       # Lifetime free profile gens per user
```

### 6.3 Database Backups

Weekly automated backup via Railway cron or external service:
```bash
pg_dump $DATABASE_URL --format=custom | gzip > /app/screenshots/backups/backup_$(date +%Y%m%d).dump.gz
```

Store backups on the same Railway volume (they're small: ~1-5 MB for the DB, and the volume is already paid for). Keep last 4 weekly backups.

---

## 7. Launch Plan & Effort Estimates

All effort assumes Claude does 100% of coding. User reviews, tests, and provides direction.

**Philosophy**: Everything technically possible ships BEFORE closed beta. The only thing that needs beta user data is multi-resolution calibration.

### Before Closed Beta: Build Everything

#### Infrastructure & Deployment

| Task | Effort |
|------|--------|
| Fix `__dirname` → `process.cwd()` (4 files) | 30 min |
| Switch adapter-auto → adapter-node | 15 min |
| Create Dockerfile | 30 min |
| Set up Railway project + Postgres + volume | 1 hour |
| Configure env vars + spending limit | 15 min |
| Add `/api/health` endpoint with readiness check | 30 min |
| Add graceful SIGTERM handling | 15 min |
| Reduce Tesseract workers to 2 | 10 min |
| Screenshot storage → Railway volume (JPEG Q85) | 2 hours |
| Database backup automation (weekly pg_dump to volume) | 1 hour |

#### Auth, Users & Usage Limits

| Task | Effort |
|------|--------|
| Add `users` table + session auth + invite codes | 4 hours |
| Add `user_id` FK to existing tables + migration | 2 hours |
| Lifetime usage limits (15 advice, 3 profile gen) | 2 hours |
| BYOK: API key input, encryption, storage, validation | 4 hours |
| BYOK: model selector (Sonnet/Opus dropdown) | 1 hour |
| "X calls remaining" UI indicator + BYOK upsell prompt | 1 hour |
| GDPR consent notice + "Delete my data" endpoint | 2 hours |

#### Client-Side Scan Migration

| Task | Effort |
|------|--------|
| Create `src/lib/scan-client/` — Canvas API preprocessing | 4 hours |
| Port HOG classifier to browser (remove Node.js deps) | 2 hours |
| Port NCC anchor detection to browser | 2 hours |
| Integrate tesseract-wasm for browser OCR | 3 hours |
| Service Worker for caching WASM + language data | 2 hours |
| Wire client-side scan into paste handler UI | 3 hours |
| Confidence-based upload logic (low → upload screenshot) | 2 hours |
| Server endpoint: receive training data (screenshot + metadata) | 2 hours |
| Device info collection (resolution, browser, OS) | 1 hour |
| Test across Chrome/Firefox/Safari | 2 hours |

#### Training Data Pipeline

| Task | Effort |
|------|--------|
| Create `training_samples` table + upload endpoint | 2 hours |
| Move learned minimap refs to database | 2 hours |

#### Observability

| Task | Effort |
|------|--------|
| Enable Anthropic prompt caching | 1 hour |
| Set up Sentry (`@sentry/sveltekit`) | 1 hour |
| Set up Honeycomb (OpenTelemetry auto-instrumentation) | 2 hours |
| Add structured logging (pino) | 1 hour |

#### Admin Dashboard

| Task | Effort |
|------|--------|
| Admin dashboard: user list with device info | 3 hours |
| Admin dashboard: training data viewer (screenshot + results) | 4 hours |
| Admin impersonation (`?as=user_id`) | 2 hours |
| Admin stats: accuracy per resolution, misclassification report | 3 hours |
| Bulk export training data (JSON + images) | 2 hours |

#### Advice Debug & Quality

| Task | Effort |
|------|--------|
| Store raw model response in `advice_raw` column | 1 hour |
| Debug viewer: raw response panel (admin only) | 2 hours |
| Debug viewer: show system prompt + user message + tokens + cost | 2 hours |

#### Final Pre-Launch

| Task | Effort |
|------|--------|
| Deploy + smoke test | 1 hour |
| Generate + distribute 10 invite codes | 15 min |

**Total before closed beta: ~72 hours**

### After Beta Data: Multi-Resolution Calibration

These tasks REQUIRE data from beta testers on different hardware:

| Task | Effort |
|------|--------|
| Analyze beta screenshots across resolutions | 2-4 hours |
| Build multi-resolution layout presets from data | 4-8 hours |
| Validate proportional scaling hypothesis | 2 hours |
| Generate bulk invite codes for public launch | 1 hour |
| Landing page with "How it works" + invite request | 4 hours |
| Load testing (simulate 50 concurrent users) | 2 hours |
| **Total post-beta** | **~15-21 hours** |

### Grand Total: ~87-93 hours of Claude coding time

That's roughly **3 weeks of focused sessions** (assuming 4-6 hours/session, 5 sessions/week).

---

## 8. Risk Matrix

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Multi-resolution layouts don't scale linearly | Medium | Critical | Beta data + manual calibration per resolution |
| tesseract-wasm accuracy differs from server Tesseract.js | Low | Medium | Test on same fixtures, tune confidence thresholds |
| 500-user spike overloads Postgres | Low | High | Client-side scan means server handles only JSON. Postgres can handle 500 concurrent reads easily |
| JPEG Q85 artifacts affect future CNN training | Very Low | Low | Q85 preserves all HOG/OCR value; if CNN needed later, re-collect at higher quality |
| Railway volume fills up | Low | Medium | 30-day retention policy on training screenshots, 10 GB volume = 6+ months at 1.6 GB/month |
| Sentry free tier limit (5K errors/month) exceeded during spike | Medium | Low | Errors are rare in normal operation; spike = first few hours, then stabilizes |
| Invite code leak on public launch | High | Medium | Single-use codes, rate limiting, spending cap on Railway + Anthropic |

---

## 9. JPEG Compression: Training Data Analysis

**Question**: Does JPEG Q85 degrade training value?

**Answer**: No, for the current and foreseeable pipeline.

| Stage | Why JPEG Q85 is fine |
|-------|---------------------|
| **HOG icon classification** | HOG uses 8×8 cell gradients. JPEG artifacts at Q85 shift gradient magnitudes by <5%, well within cosine distance tolerance. The icons are high-contrast silhouettes — JPEG doesn't blur the dominant edges |
| **OCR binarization** | OCR thresholds at 128 on white text (~240) vs dark background (~30). JPEG ringing at Q85 is ~5-10 gray levels. 100+ levels of margin — threshold unaffected |
| **Future CNN training** | Q85+ preserves virtually all spatial information. Below Q60, block artifacts become features a CNN might learn. Stay at Q85 for safety |
| **Anchor detection (NCC)** | Template matching on the X button is robust to minor compression — NCC normalizes for contrast changes |

**Recommendation**: Store all training screenshots at JPEG Q85. Size: ~600 KB per 3440×1440 screenshot (vs 5-6 MB PNG). 88% savings, zero training value loss.

---

## 10. Decisions Log

| Decision | Rationale |
|----------|-----------|
| Client-side scan (Canvas + tesseract-wasm) | Eliminates server compute bottleneck. 500 users with no server scaling. |
| JPEG Q85 for training data | Preserves all training value (HOG, OCR, future CNN). 88% storage savings. |
| Postgres-backed usage tracking (not in-memory) | Survives container restarts. Red Team identified restart-based bypass attack. |
| **Lifetime limits, not per-day** | Simpler, fairer (some days 0 PvP, some days 10). Natural BYOK funnel. Owner's costs bounded. |
| **15 advice / 3 profile gen per user** | Advice is cheap (Sonnet $0.016). Profile gen is expensive (Opus $0.045) → strictest limit. |
| **BYOK before closed beta** | Everything technically possible ships before beta. BYOK is the scale strategy — build it first. |
| **Model selector with BYOK** | Owner wants to test Opus advice quality. BYOK users should choose their quality/cost tradeoff. |
| **Raw response storage + debug viewer** | Can't improve prompts without seeing raw output. Essential for advice quality iteration. |
| **Never switch to cheaper models** | The advice IS the product. Poor advice = no value = no users. Non-negotiable. |
| User accounts from day one (not "add later") | Multi-tenancy, admin impersonation, training data attribution all require user IDs. |
| Single-use invite codes (not shared) | Prevents uncontrolled spread. Each code traceable to a user. |
| Learned minimap in DB (not filesystem) | Survives deploys, queryable, per-resolution. |
| Sentry + Honeycomb (not "just console.log") | User explicitly wants to understand what's going on. Free tiers cover beta + early launch. |
| Railway volume for screenshots (not R2/S3) | Simplest option, $1.60/month for 10 GB, no external dependencies. |
| Store ALL screenshots during beta | User needs to see every beta tester's experience. Storage cost is negligible at 10 users. |
| **Everything ships before beta** | Claude does all coding — there's no cost to building early. Phased launches create debt. |

---

## 11. Summary

| Question | Answer |
|----------|--------|
| Total cost for closed beta (10 users)? | **~€12/month recurring** (Railway $8) + **$3.75 one-time** (API for 10 users × free calls) |
| Total cost for public launch (100 users)? | **~€8/month recurring** (Railway) + **$37.50 one-time** (API for 100 users × free calls) |
| What happens after users spend their free calls? | **They BYOK or stop.** Your monthly API cost drops to ~$0 for existing users |
| How long to reach closed beta? | **~72 hours** (everything built before beta) |
| How long to reach public launch? | **~87-93 hours** (+ post-beta multi-resolution work) |
| Biggest technical risk? | **Multi-resolution support** — unknown if layouts scale linearly |
| Biggest product risk? | **Advice quality** — it IS the product. Must be excellent or there's no app |
| What's the #1 hidden code bug? | **`__dirname` paths break in production** — 30 min fix |
| Can 500 users crash the server? | **No** — client-side scan means server handles only JSON + Anthropic proxy |
| Is training data collection viable? | **Yes** — JPEG Q85, Railway volume, admin dashboard, corrections as labels |
| Can users use Opus for advice? | **Yes, with BYOK.** Model selector lets them choose Sonnet or Opus |
| Can I debug the model's raw output? | **Yes.** Debug viewer shows raw response, system prompt, tokens, cost per match |
