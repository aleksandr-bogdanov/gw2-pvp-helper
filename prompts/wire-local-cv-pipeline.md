# Task: Wire Local CV Pipeline Into Website Flow

## Context

We have a fully working local CV scan pipeline at `src/lib/server/scan/` that replaces the old LLM-based scanner (`src/lib/server/scan.ts`). The pipeline is tested and achieves:

- **Anchor detection**: 23/23 (100%) — finds the X close button via NCC template matching
- **Icon classification**: 39/40 (97.5%) — HOG k-NN against 45 reference icons
- **Map detection**: 23/23 (100%) — minimap thumbnail matching, also provides game mode
- **OCR**: ~80% name accuracy — Tesseract.js with trim preprocessing
- **End-to-end**: ~3-4s per screenshot

The pipeline exports `scanScreenshot(imageBase64, mediaType)` from `src/lib/server/scan/index.ts` and returns the same `ScanResult` interface the UI already consumes.

## What Needs to Change

### 1. Switch the `/api/scan` endpoint to use the local pipeline

**File**: `src/routes/api/scan/+server.ts`

Currently imports from `$lib/server/scan.js` (the old LLM scanner). Change to import from `$lib/server/scan/index.js` (the new local CV pipeline). The function signature is identical — `scanScreenshot(image, mediaType) → ScanResult` — so this should be a one-line import change.

**Important**: The old `src/lib/server/scan.ts` (LLM scanner) should be kept but renamed to `src/lib/server/scan-llm.ts` as a fallback. Don't delete it.

### 2. Auto-select detected map in the match page

**File**: `src/routes/match/+page.svelte`

The `ScanResult` now includes `detected_map?: { mapId: string; mode: string; confidence: number }`. When a scan result is loaded:
- If `detected_map` exists and `confidence > 0.2`, auto-set `selectedMap` to `detected_map.mapId`
- Show a small indicator next to the map dropdown (e.g., "(auto-detected)") so the user knows it was auto-filled
- The user can still override by selecting a different map from the dropdown

### 3. Add warmup on server startup

**File**: `src/hooks.server.ts` (create if doesn't exist)

The pipeline has three warmup functions that pre-load templates, reference icons, and Tesseract workers:
```typescript
import { warmupClassifier, warmupOCR, warmupMinimap } from '$lib/server/scan/index.js';

// Pre-warm on server start to avoid cold start on first scan
Promise.all([warmupClassifier(), warmupOCR(), warmupMinimap()]).catch(console.error);
```

### 4. Handle the `ANTHROPIC_API_KEY` requirement

The old scanner required `ANTHROPIC_API_KEY` for every scan. The new pipeline doesn't need it at all for scanning. Update any error handling or env validation that assumes the key is required for scans. The key is still needed for advice generation (`/api/advice`) and profile generation (`/api/generate-profile`).

### 5. Update the idle screen paste handler

**File**: `src/routes/+layout.svelte` or `src/routes/+page.svelte` (wherever Ctrl+V is handled)

Currently the paste handler sends the image to `/api/scan`. This should still work as-is since the endpoint interface doesn't change. But verify:
- The base64 encoding is correct (no `data:image/png;base64,` prefix — just raw base64)
- Error handling shows a user-friendly message if the scoreboard isn't detected (the new pipeline throws "Could not locate the scoreboard...")

### 6. Show scan confidence/metadata (optional enhancement)

After a scan, the UI could show:
- Detected map name and confidence
- UI size detected (small/normal/large/larger)
- Number of names successfully OCR'd vs "Unknown Player"
- A subtle "Local CV" badge to distinguish from the old LLM scanner

This is optional and should not block the integration.

## Files to Read First

1. `src/routes/api/scan/+server.ts` — current endpoint (15 lines)
2. `src/lib/server/scan.ts` — old LLM scanner (to rename)
3. `src/lib/server/scan/index.ts` — new local CV pipeline entry point
4. `src/lib/types.ts` — `ScanResult` and `PlayerInfo` interfaces
5. `src/routes/match/+page.svelte` — match page with map selector
6. `src/routes/+page.svelte` and `src/routes/+layout.svelte` — paste handler

## Testing

After wiring:
1. Run the dev server: `npm run dev`
2. Open `localhost:5173`
3. Paste a test screenshot (any from `tests/fixtures/`)
4. Verify: roster appears with correct specs, map auto-selected, names filled in
5. Verify: map dropdown shows the detected map pre-selected
6. Verify: no ANTHROPIC_API_KEY needed for scan (only for advice)

## Rules

- Svelte 5 runes syntax only (`$state`, `$derived`, `$effect`)
- Don't modify the scan pipeline code (`src/lib/server/scan/*`) — it's tested and working
- Keep the old LLM scanner as a renamed backup, not deleted
- The integration should be minimal — the pipeline was designed as a drop-in replacement
