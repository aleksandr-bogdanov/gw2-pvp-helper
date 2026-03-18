# Implementation Prompts

Copy-paste each prompt into a fresh Claude Code session. Each is self-contained — the session will read CLAUDE.md + PRODUCTION-READINESS.md automatically and figure out the implementation details itself.

Run them **in order**. Each builds on the previous.

**All prompts use `bun` as the package manager** (installed in Prompt 0). Use `bun install`, `bun add`, `bun run`, etc. — never npm.

---

## Prompt 0: Modernize Tooling (npm → bun, add Vitest)

```
Modernize the project tooling. This project uses Node.js as the RUNTIME but we're switching to Bun as the PACKAGE MANAGER (like switching from pip to uv in Python — same ecosystem, dramatically faster).

1. Migrate from npm to bun as package manager:
   - Delete package-lock.json
   - Run: bun install (this creates bun.lock)
   - Verify all dependencies resolve correctly
   - Update all scripts in package.json to use bun:
     - "dev": "bunx --bun vite dev"
     - "build": "bunx --bun vite build"
     - "preview": "bunx --bun vite preview"
     - "check": "bunx svelte-kit sync && bunx svelte-check --tsconfig ./tsconfig.json"
     - "fetch-api": "bun scripts/fetch-gw2-api.ts" (replaces tsx — bun runs .ts natively)
   - Remove tsx from devDependencies (no longer needed — bun runs TypeScript natively)
   - Run "bun run dev" to verify the dev server starts
   - Run "bun run check" to verify TypeScript checking works

2. Add Vitest for testing:
   - bun add -d vitest @testing-library/svelte jsdom
   - Create vitest.config.ts at project root:
     - Use @sveltejs/vite-plugin-svelte
     - Configure jsdom environment
     - Set up path aliases to match SvelteKit's ($lib, etc.)
   - Add test script to package.json: "test": "vitest run", "test:watch": "vitest"
   - Create a simple smoke test (e.g., tests/smoke.test.ts) that imports game-data.ts and verifies specs.json loads correctly
   - Run "bun run test" to verify it passes

3. Update .gitignore:
   - Add bun.lock if not already tracked (actually bun.lock SHOULD be committed, like package-lock.json — verify it's NOT in .gitignore)
   - Remove any npm-specific entries that aren't relevant

4. Verify nothing broke:
   - "bun run dev" starts the dev server
   - "bun run build" produces build output
   - "bun run check" passes TypeScript checks
   - "bun run test" passes

Do NOT change the runtime — the Dockerfile and production server still use "node build/index.js". Bun is the package manager only.
```

---

## Prompt 1: Infrastructure & Deployment Foundation

```
Read PRODUCTION-READINESS.md (the whole thing — it's the source of truth).

Do these infrastructure tasks, in this order:

1. Fix the __dirname path resolution bug in the scan pipeline. All files in src/lib/server/scan/ that use resolve(__dirname, '../../../../data/...') must switch to resolve(process.cwd(), 'data', ...). Also fix scan-llm.ts if it exists. Verify by searching for all __dirname references in src/.

2. Switch from adapter-auto to adapter-node:
   - bun remove @sveltejs/adapter-auto
   - bun add -d @sveltejs/adapter-node
   - Update svelte.config.js

3. Create a Dockerfile at project root (see PRODUCTION-READINESS.md §6.1 for the spec). Multi-stage build, Alpine, copies data/ explicitly, 30s start period health check.

4. Add a health check endpoint at /api/health that returns {status: 'ok', uptime: process uptime}.

5. Add graceful SIGTERM handling in hooks.server.ts.

6. Reduce NUM_WORKERS from 4 to 2 in src/lib/server/scan/ocr.ts.

7. Enable Anthropic prompt caching on the advice endpoint. The system prompt (~3500 tokens of universal-game-knowledge.md + output-format) is identical across calls — add cache_control: {type: 'ephemeral'} to make it cacheable. Read the Anthropic SDK docs for the exact syntax.

After each change, verify it works (read the files, check for errors). Don't just make changes blindly.

8. Write tests (bun run test must pass):
   - tests/data-paths.test.ts:
     - No __dirname references remain in src/lib/server/scan/ (grep the files)
     - All data path resolvers use process.cwd() base
     - resolve(process.cwd(), 'data', 'profession-icons/wiki-big') points to existing directory
     - resolve(process.cwd(), 'data', 'x-templates') points to existing directory
     - resolve(process.cwd(), 'data', 'minimap-references/thumbs') points to existing directory
   - tests/health.test.ts:
     - GET /api/health returns 200
     - Response body contains {status: 'ok'} and a numeric uptime
   - tests/scan-config.test.ts:
     - NUM_WORKERS constant equals 2 (import from ocr.ts and assert)
   - Verify build works: run "bun run build" and confirm it succeeds without errors
```

---

## Prompt 2: Users, Auth & Session Management

```
Read PRODUCTION-READINESS.md §5.1 (Auth & Multi-Tenancy) and §5.2 (Usage Limits & BYOK).

Implement the user system:

1. Create a new Drizzle migration that adds a `users` table:
   - id (serial PK)
   - username (text, unique, not null)
   - invite_code_used (text, not null)
   - role (text, default 'user') — values: 'user' | 'admin'
   - device_info (jsonb, nullable)
   - advice_calls_remaining (integer, default 15)
   - profile_gens_remaining (integer, default 3)
   - byok_api_key_encrypted (text, nullable)
   - byok_model_preference (text, default 'claude-sonnet-4-6')
   - consent_given_at (timestamp, nullable)
   - created_at (timestamp, default now)
   - last_seen_at (timestamp, default now)

2. Add `user_id` (integer, FK → users.id) to: user_profiles, matches. Create the migration.

3. Implement invite code validation:
   - Read INVITE_CODES from env (comma-separated list)
   - Track used codes in a `used_invite_codes` table (code TEXT PK, user_id FK, used_at TIMESTAMP)
   - Single-use: reject codes already in the table

4. Implement session management:
   - On first visit: show invite code screen
   - Valid code → choose username screen
   - Create user record, set httpOnly session cookie (30 days)
   - All API routes: check session cookie, reject 401 if invalid
   - Store session token in a `sessions` table (token TEXT PK, user_id FK, expires_at TIMESTAMP)

5. Add admin impersonation: if user.role === 'admin' and URL has ?as=<userId>, scope all queries to that user instead. Keep the actual session as admin.

6. Add GDPR consent: on first login, show consent notice. Store consent_given_at. Add DELETE /api/users/me endpoint that cascades deletes.

Make sure existing functionality still works — the profiles, matches, and scan endpoints should all work for authenticated users.

7. Write tests (bun run test must pass):
   - tests/auth.test.ts:
     - Invite code validation: valid code accepted, used code rejected, invalid code rejected
     - Session creation: user created with correct defaults, session cookie set
     - Session verification: valid session returns user, expired session returns 401, missing cookie returns 401
     - Admin impersonation: admin can impersonate, non-admin cannot
   - tests/users.test.ts:
     - User creation with unique username enforcement
     - GDPR delete cascades (user → profiles, matches, sessions)
     - device_info stored correctly as JSONB
   - Use Vitest. Mock the database where needed (or use a test database if docker-compose is running). Test the logic, not the framework.
```

---

## Prompt 3: Usage Limits & BYOK

```
Read PRODUCTION-READINESS.md §5.2 (Usage Limits & BYOK).

The users table already has advice_calls_remaining, profile_gens_remaining, byok_api_key_encrypted, and byok_model_preference columns (from Prompt 2).

Implement:

1. Usage limit enforcement:
   - In /api/advice: check advice_calls_remaining > 0 OR byok key exists. If free tier: decrement counter, use owner's ANTHROPIC_API_KEY. If BYOK: use their key, don't decrement.
   - In /api/generate-profile: same logic with profile_gens_remaining.
   - Return 429 with {error: 'Free calls exhausted', remaining: 0, byok_available: true} when limit hit.
   - Read FREE_ADVICE_LIMIT and FREE_PROFILE_LIMIT from env vars (default 15 and 3).

2. BYOK key management:
   - New endpoint: POST /api/settings/api-key — accepts {apiKey: string}
   - Validate key by making a test call: anthropic.messages.create with max_tokens: 1
   - Encrypt with AES-256-GCM using BYOK_ENCRYPTION_KEY env var before storing
   - New endpoint: DELETE /api/settings/api-key — removes stored key
   - New endpoint: GET /api/settings/api-key — returns {hasKey: boolean} (never return the actual key)

3. Model selection (BYOK only):
   - In /api/advice: if user has BYOK key, use their byok_model_preference instead of hardcoded claude-sonnet-4-6
   - New endpoint: PATCH /api/settings/model — accepts {model: 'claude-sonnet-4-6' | 'claude-opus-4-6'}
   - Only allow model change if byok key exists

4. UI indicators:
   - On the main page or match page, show: "X free advice calls remaining" or "Using your API key (unlimited)"
   - When free calls hit 0: show a prompt/banner: "Add your Anthropic API key in Settings for unlimited access"

5. Settings page (new route: /settings):
   - API key input + test button + save/delete
   - Model selector dropdown (disabled if no BYOK key)
   - Current usage stats (calls remaining)
   - Delete my data button (GDPR)

6. Write tests (bun run test must pass):
   - tests/usage-limits.test.ts:
     - Free tier: advice call decrements counter, returns remaining count
     - Free tier exhausted: returns 429 with correct error shape
     - BYOK: advice call does NOT decrement counter
     - BYOK: uses user's model preference
     - Free tier: always uses Sonnet regardless of preference
   - tests/byok.test.ts:
     - API key encryption roundtrip: encrypt → store → decrypt → matches original
     - Key validation: invalid key rejected with clear error
     - Key deletion: removes encrypted key, reverts to free tier
     - Model selection: only allowed with BYOK key, rejected without
   - tests/settings-api.test.ts:
     - GET /api/settings/api-key returns {hasKey: true/false}, never the actual key
     - PATCH /api/settings/model rejects invalid model names
     - PATCH /api/settings/model rejects when no BYOK key
```

---

## Prompt 4: Observability (Sentry + Honeycomb + Pino)

```
Read PRODUCTION-READINESS.md §5.7 (Observability).

Set up production-grade observability:

1. Sentry:
   - bun add @sentry/sveltekit
   - Initialize in hooks.client.ts (client errors) and hooks.server.ts (server errors)
   - Read SENTRY_DSN from env var
   - Configure source maps upload in vite.config.ts
   - Tag errors with userId, resolution, route

2. Honeycomb:
   - bun add @honeycombio/opentelemetry-node @opentelemetry/auto-instrumentations-node
   - Initialize OpenTelemetry in hooks.server.ts (or a separate instrumentation file loaded before app starts)
   - Read HONEYCOMB_API_KEY from env var
   - Auto-instruments: HTTP requests, Postgres queries, fetch calls
   - Add custom spans for:
     - scan pipeline duration + confidence scores
     - advice generation (tokens in/out, model used, cost estimate)
     - training data upload (resolution, file size)

3. Structured logging with Pino:
   - bun add pino
   - Create src/lib/server/logger.ts — configured pino instance with JSON output
   - Replace all console.log/warn/error across server files with logger.info/warn/error
   - Every log line includes: timestamp, level, event name, userId (from session), requestId
   - Key events to log: scan_complete, advice_requested, advice_complete, profile_generated, training_uploaded, auth_failed, rate_limited

Don't break existing functionality. Observability should be additive.

4. Write tests (bun run test must pass):
   - tests/logger.test.ts:
     - Logger produces valid JSON output
     - Log entries contain required fields: ts, level, event
     - Logger respects log levels (info, warn, error)
   - tests/observability.test.ts:
     - Sentry initializes without throwing when SENTRY_DSN is set
     - Sentry skips gracefully when SENTRY_DSN is missing (dev mode)
     - Honeycomb skips gracefully when HONEYCOMB_API_KEY is missing (dev mode)
     - Custom span creation doesn't throw
```

---

## Prompt 5: Screenshot Storage & Training Data Pipeline

```
Read PRODUCTION-READINESS.md §5.4 (Training Data Pipeline) and §7.1 (Screenshot Retention).

Implement the training data system:

1. Create training_samples table (Drizzle migration):
   - id (serial PK)
   - user_id (FK → users)
   - screenshot_hash (text, unique)
   - screenshot_path (text) — relative path on disk
   - resolution (text) — e.g., "3440x1440"
   - ui_size (text, nullable)
   - device_info (jsonb)
   - scan_result (jsonb) — what the CV pipeline detected
   - user_corrections (jsonb, nullable) — what the user changed
   - confidence_scores (jsonb) — per-slot confidence
   - anchor_position (jsonb, nullable)
   - created_at (timestamp)
   - reviewed_by_admin (boolean, default false)

2. Refactor screenshot storage:
   - Screenshots go to /app/screenshots/ directory (Railway volume mount point)
   - Convert incoming PNG screenshots to JPEG quality 85 using Sharp before saving
   - Serve screenshots via API endpoint (GET /api/screenshots/:hash) not static directory
   - The endpoint checks auth and streams the file

3. Update /api/scan endpoint:
   - After scan, store training sample record with full metadata
   - Include confidence scores per icon slot and per name slot
   - Include device info from the user's record
   - Include the screenshot resolution

4. Update the match page:
   - When user corrects a spec or name, save corrections via PATCH to /api/training/:id
   - The corrections field stores: {slot_index, original_spec, corrected_spec, original_name, corrected_name}

5. Add advice_raw column to matches table:
   - New migration: add advice_raw TEXT column
   - In /api/advice: concatenate all streamed text deltas into advice_raw, save via PATCH after stream completes
   - This stores the unformatted model output for debugging

6. Create minimap_references table and migrate existing filesystem data:
   - Schema per PRODUCTION-READINESS.md §5.6
   - On startup: if table is empty, seed from data/minimap-references/thumbs/manifest.json
   - Update minimap.ts to read from DB (cached in memory) instead of filesystem

7. Write tests (bun run test must pass):
   - tests/training-data.test.ts:
     - Training sample created with all required fields
     - Screenshot hash uniqueness enforced (duplicate rejected)
     - User corrections stored and retrievable
     - Screenshot path points to valid location format
   - tests/screenshot-storage.test.ts:
     - PNG → JPEG Q85 conversion produces smaller file
     - JPEG Q85 output is valid JPEG (check magic bytes)
     - Screenshot served via API requires auth
     - Non-existent hash returns 404
   - tests/advice-raw.test.ts:
     - advice_raw column stores full unformatted response
     - advice_raw preserved even when adviceText is also saved
   - tests/minimap-db.test.ts:
     - Seeding from manifest.json populates correct number of entries
     - Learned reference inserted and retrievable
     - Memory cache loads all references on init
```

---

## Prompt 6: Admin Dashboard

```
Read PRODUCTION-READINESS.md §5.1 (Admin Impersonation), §5.4 (Admin Training Dashboard), §5.8 (Raw Response Debug Viewer).

Build the admin dashboard:

1. Admin guard: create a layout or middleware for /admin/* routes that checks user.role === 'admin'. Redirect non-admins to /.

2. /admin page (dashboard home):
   - Total users, total matches, total training samples
   - API usage stats: total advice calls made (across all users), total profile gens
   - Quick links to sub-pages

3. /admin/users page:
   - Table of all users: username, role, device_info (resolution, browser), advice_calls_remaining, profile_gens_remaining, has BYOK key, last_seen_at, created_at
   - "Impersonate" button per user → navigates to / with ?as=userId
   - Search/filter by resolution

4. /admin/training page:
   - Table of all training_samples: user, resolution, confidence (avg), has corrections, reviewed status, date
   - Sortable by confidence (lowest first = most interesting for training)
   - Filter by resolution, by reviewed status
   - Click a row → detail view: screenshot image + detected roster vs corrected roster side-by-side
   - Mark as reviewed button
   - Stats panel: accuracy per resolution, top misclassified specs

5. /admin/training/export endpoint:
   - GET /api/admin/training/export — returns JSON array of all training samples with metadata
   - Include screenshot URLs for downloading

6. Debug viewer on match page:
   - Add a small debug icon/button (visible only to admin users) next to the advice text
   - Clicking opens a modal showing:
     - advice_raw (monospace, pre-formatted)
     - The system prompt that was assembled
     - The user message (roster + map)
     - Model used, tokens in/out (if available from Anthropic response)
   - This helps debug prompt quality and model behavior

7. Write tests (bun run test must pass):
   - tests/admin-guard.test.ts:
     - Admin routes reject non-admin users with redirect
     - Admin routes accept admin users
     - Admin routes reject unauthenticated requests
   - tests/admin-api.test.ts:
     - GET /api/admin/training/export returns correct JSON shape
     - Export includes screenshot URLs
     - Non-admin cannot access admin API endpoints (403)
   - tests/debug-viewer.test.ts:
     - Debug data includes advice_raw, system prompt, user message
     - Debug endpoint returns 403 for non-admin users
     - Debug data returns token counts when available
```

---

## Prompt 7: Client-Side Scan Migration

```
Read PRODUCTION-READINESS.md §2 (Architecture Before & After) and §5.3 (Client-Side CV Pipeline).

This is the biggest task. Migrate the CV scan pipeline from server-side (Sharp + Tesseract.js) to client-side (Canvas API + tesseract-wasm).

IMPORTANT: The server-side scan in src/lib/server/scan/ must be PRESERVED as a fallback. Do not delete it. Create the browser version as a NEW module.

1. Create src/lib/scan-client/ directory with browser-compatible versions:

   a. preprocess.ts — Canvas API replacements for Sharp:
      - loadImageFromBlob(blob) → creates ImageBitmap
      - extractROI(imageBitmap, x, y, w, h) → canvas drawImage to crop
      - resizeGrayscale(imageBitmap, targetW, targetH) → canvas resize + manual grayscale from getImageData
      - getRawPixels(canvas, x, y, w, h) → Uint8Array from getImageData
      Use OffscreenCanvas with {willReadFrequently: true} for performance.

   b. classifier.ts — Copy from server version. It's pure TypeScript math (HOG features + cosine distance). Remove any 'fs' or 'path' imports. Reference icons need to be loaded differently — fetch them as images and extract pixels via Canvas instead of Sharp.

   c. anchor.ts — Copy from server version. NCC template matching is pure math. X-button templates loaded via fetch + Canvas instead of fs.readFileSync + Sharp.

   d. minimap.ts — Copy from server version. Cosine similarity is pure math. Thumbnails loaded via fetch + Canvas.

   e. layouts.ts — Copy as-is (pure data, no I/O).

   f. ocr.ts — Use tesseract-wasm instead of Tesseract.js:
      - bun add tesseract-wasm
      - Create OCR wrapper: initOCR() loads WASM + eng data (cached in IndexedDB)
      - recognizeNames(crops: ImageData[]) → Promise<{text: string, confidence: number}[]>
      - Show progress on first load: "Downloading OCR engine (2 MB, one-time)..."

   g. index.ts — scanScreenshotClient(imageBlob) → ScanResult
      - Orchestrates the pipeline using browser APIs
      - Returns confidence scores per slot

2. Wire into the UI:
   - In +layout.svelte or +page.svelte paste handler: instead of sending the image to /api/scan, run scanScreenshotClient() in-browser
   - Show scanning progress steps (same UI as current)
   - When done: populate the roster with results

3. Confidence-based upload:
   - After client-side scan, check confidence scores
   - If any spec confidence < 0.85 or any name confidence < 0.5: upload screenshot as JPEG Q85 to /api/training/upload
   - During beta (configurable flag): upload ALL screenshots regardless of confidence

4. Reference data loading:
   - The 45 reference icons, 4 X-button templates, and minimap thumbnails need to be accessible to the browser
   - Option A: put them in static/ and fetch via HTTP
   - Option B: bundle as base64 in a JS module (small enough: ~1 MB total)
   - Choose whichever is simpler. The icons are 64×64 PNGs (~20 KB each × 45 = 900 KB total).

5. Test that existing server-side scan still works (it's the fallback for admin re-scanning).

6. Write tests (bun run test must pass):
   - tests/scan-client/preprocess.test.ts:
     - loadImageFromBlob creates valid ImageBitmap from test PNG
     - extractROI returns correct dimensions
     - resizeGrayscale produces single-channel output at target size
     - getRawPixels returns Uint8Array of correct length (w × h)
   - tests/scan-client/classifier.test.ts:
     - HOG feature vector has correct length (288 for 32×32 image)
     - Classification of a known icon returns correct spec_id
     - Confidence score is between 0 and 1
     - Top-N candidates are sorted by confidence descending
   - tests/scan-client/anchor.test.ts:
     - NCC template matching finds anchor in a known test crop
     - Returns null/low confidence when no X button present
   - tests/scan-client/pipeline.test.ts:
     - Full scanScreenshotClient() produces valid ScanResult shape
     - ScanResult has 5 red_team + 5 blue_team entries
     - Each entry has character_name, profession_id, spec_id, confidence
     - Confidence scores populated for all slots
   - Note: browser-API tests (Canvas, ImageBitmap) may need jsdom or a canvas polyfill. If jsdom doesn't support Canvas well enough, create the tests but mark them with test.skip and add a comment explaining why. The real validation is manual testing with actual screenshots.
```

---

## Prompt 8: Database Backups & Final Hardening

```
Read PRODUCTION-READINESS.md §6.3 (Database Backups) and do final hardening.

1. Database backup script:
   - Create scripts/backup-db.sh that runs pg_dump, gzips it, saves to /app/screenshots/backups/
   - Keep last 4 weekly backups, delete older ones
   - Can be triggered via a Railway cron job or external cron

2. Database connection pooling:
   - In src/lib/server/db/index.ts, configure postgres client with max: 10 connections

3. Request body size limit:
   - In hooks.server.ts: reject POST requests to /api/scan and /api/training/upload with Content-Length > 10 MB

4. Review all API endpoints for auth enforcement:
   - Every endpoint in src/routes/api/ should check for valid session
   - /api/health is the only exception (public)
   - /api/admin/* endpoints should additionally check role === 'admin'

5. Verify the Dockerfile builds correctly:
   - Run: docker build -t gw2-pvp-helper .
   - If it fails, fix the issues
   - Verify the built image starts and responds to /api/health

6. Create a .dockerignore file:
   - Exclude: node_modules, .svelte-kit, tests/fixtures/, static/screenshots/, .env, .git

7. Review and update .env.example with all required env vars (no real values, just placeholders).

8. Write tests (bun run test must pass):
   - tests/hardening.test.ts:
     - Request body > 10 MB rejected with 413 on /api/scan
     - Request body > 10 MB rejected with 413 on /api/training/upload
     - Normal-sized request passes through
   - tests/auth-enforcement.test.ts:
     - Every API endpoint (except /api/health) returns 401 without session
     - /api/health returns 200 without session
     - /api/admin/* returns 403 for non-admin authenticated user
   - tests/db-connection.test.ts:
     - Connection pool respects max: 10 setting
   - Run the FULL test suite: bun run test — every test from prompts 2-8 must pass. Fix any that broke from integration between prompts.
```

---

## Notes

- Each prompt is designed for a **fresh Claude Code session** (clean context)
- Sessions auto-load CLAUDE.md and PRODUCTION-READINESS.md from the project
- Order matters: Prompt 0 first, then 1-8 in sequence
- All prompts use **bun** as package manager (`bun add`, `bun run`, etc.) — set up in Prompt 0
- Prompt 7 (client-side scan) is the longest — expect 2-3 hours of session time
- After all 9 prompts: deploy to Railway, generate invite codes, start closed beta
