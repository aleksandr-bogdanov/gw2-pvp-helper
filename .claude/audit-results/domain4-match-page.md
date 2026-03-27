# Domain 4 Audit: Match Detail & Home Page

## Round 1 — Code Investigation + Fixes

### Files Audited
- `src/routes/match/[id]/+page.svelte` (1,829 lines)
- `src/routes/+page.svelte` (181 lines)
- `src/routes/+layout.svelte` (308 lines)
- `src/hooks.client.ts` (15 lines — Sentry only, no paste handler)
- `src/lib/components/LoginGate.svelte` (297 lines)

### Svelte 4 Patterns: NONE FOUND
All files use Svelte 5 runes (`$state`, `$derived`, `$effect`, `$props`). No `$:`, `on:click`, or `slot` patterns.

### Findings & Fixes Applied

#### FIXED: Memory leak — timers not cleared on navigation
- `adviceTimer` (setInterval for elapsed counter) and `adviceSaveTimer` (setTimeout for debounced save) were only cleared in `getAdvice()` finally block
- If user navigated away mid-stream, both timers would continue firing after component unmount
- **Fix:** Added `onDestroy` cleanup for both timers + abort controller

#### FIXED: No way to cancel SSE advice streaming
- `getAdvice()` used `fetch()` with no AbortController — user had no way to cancel a running request
- Navigating away left the fetch hanging
- **Fix:** Added `AbortController`, wired `signal` into fetch, added Cancel button below Get Advice during loading, handle `AbortError` gracefully (not shown as error)

#### FIXED: Home page `handleDrop` used legacy server-side scan API
- `+page.svelte` had its own drag/drop handlers calling `/api/scan` (server-side Sharp pipeline)
- `+layout.svelte` already handles drag/drop globally via `<svelte:window>` using `runScan()` (client-side scan pipeline)
- The home page handler would fire FIRST (div event before window event), using the wrong pipeline
- **Fix:** Removed duplicate drag/drop handlers from home page; layout's global handler covers all pages

### Findings — Not Fixed (Noted for Future Rounds)

#### `recoverMatchFromDB` fetches 50 matches to find one by ID
- Line 322: `fetch('/api/match?limit=50')` then `.find()` client-side
- API endpoint doesn't support `?matchId=` filter
- Should add `matchId` query param support to GET `/api/match` endpoint
- Low priority: only fires on page refresh of existing match

#### Home page profile fetch has no error handling for network failures
- Line 21: `fetch('/api/profiles')` — if this fails (network error), no catch, no user feedback
- The `if (res.ok)` guard handles HTTP errors but not thrown exceptions
- Low priority: app still works, just shows no profiles

#### `hooks.client.ts` is Sentry-only — no Ctrl+V handler
- The paste handler lives in `+layout.svelte` line 183 via `<svelte:window onpaste={handlePaste}>`
- This is correct — paste works globally on all pages
- Paste does NOT conflict with text inputs because `handlePaste` only acts on image clipboard items

### UX Audit Findings

#### Get Advice button: GOOD
- Has proper disabled state during loading
- Shows spinner + elapsed time during streaming
- Shows error message below on failure
- NOW has Cancel button during loading (added in this round)

#### Error messages: ACCEPTABLE
- Advice errors show the server error message (e.g., "Rate limit exceeded") — this is appropriate
- Scan errors in layout show the error message with dismissible X button

#### Streaming advice: GOOD
- Renders progressively — individual advice cards appear as sections are parsed from the stream
- Focus Order, Babysit, Map Opening, Gameplan, Positioning cards appear during streaming

#### Empty state: GOOD
- `/match/new` with no sessionStorage data redirects to `/` (line 301-303)
- Invalid match ID falls back to most recent match, or redirects to `/` (line 307-311)

### Build Verification
- `bun run check`: 0 errors, 9 pre-existing warnings
- `bun run build`: success

---

## Convergence Tracker
- Round 1: 3 fixes applied (memory leaks, cancel button, legacy drag/drop removal)
- Round 2: pending
- Round 3: pending
