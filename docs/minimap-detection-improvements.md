# Minimap Detection Improvements

## Problem

The original minimap detector used spatial cosine similarity of 16x16 RGB thumbnails against 16 static reference images. This had two issues:

1. **Low accuracy on real matches** — 9/17 (53%) on user-corrected match data, despite 23/23 (100%) on the original test fixtures. The test fixtures were the same images used to create the references.
2. **Rotating minimaps** — some players use the GW2 setting that rotates the minimap to face their character direction. This completely breaks spatial pixel matching since the same map looks different every time.

## Solution: Two-Part Improvement

### 1. Learned References from Match History

When a match is saved or its map is corrected by the user, the system extracts a 16x16 minimap thumbnail from the screenshot and saves it as a new reference in `data/minimap-references/learned/`.

**How it works:**
- `learnMinimapReference(screenshotPath, mapId, screenshotHash)` in `minimap.ts`
- Called automatically from `/api/match` POST (new match) and PATCH (map correction)
- Saved to `data/minimap-references/learned/` with its own `manifest.json`
- Cache invalidated after each learn so next scan uses new refs
- Bootstrap script: `npx tsx scripts/bootstrap-minimap-refs.ts` (processes all existing matches)

**Result:** 9/17 (53%) -> 14/17 (82%) with leave-one-out evaluation.

Maps with only 1 match in history still fail leave-one-out (since the only reference gets excluded) but work in production where it's available.

### 2. Rotation-Invariant (RI) Feature Fallback

Added a second feature vector computed from each thumbnail that is completely invariant to rotation:

**Joint RGB color histogram** (8x8x8 = 512 bins)
- Each map has a distinctive color palette (snow vs desert vs urban vs jungle)
- Binning pixel colors into a histogram discards all spatial/rotational information
- L2-normalized for cosine similarity matching

**Radial color profile** (6 rings x 3 channels = 18 values)
- Average color at concentric distances from the thumbnail center
- Captures center-vs-edge color gradients without any rotational dependency

Both are concatenated (histogram weighted 1.0, radial weighted 0.5) and L2-normalized into a single 530-element feature vector.

**Detection logic:**
```
if spatial_gap >= 0.03:
    use spatial result (confident, minimap is not rotated)
elif ri_gap > spatial_gap:
    use RI result (spatial confused, likely rotated minimap)
else:
    use spatial result (both weak, spatial is still best guess)
```

**Result:** 14/17 (82%) -> 15/17 (88%) — the RI fallback rescued one eternal_coliseum screenshot where spatial was confused with temple_of_the_silent_storm.

## Accuracy Summary (Leave-One-Out)

| Strategy | Correct | Accuracy |
|---|---|---|
| Static refs, spatial only | 9/17 | 53% |
| Static refs, RI only | 10/17 | 59% |
| +Learned refs, spatial only | 14/17 | 82% |
| **+Learned refs, combined** | **15/17** | **88%** |

The 2 remaining misses are maps with only 1 match in history (battle_of_champions_dusk, forest_of_niflhel). In leave-one-out evaluation the only reference is excluded. In production these work since the reference is present.

## File Changes

- `src/lib/server/scan/minimap.ts` — RI feature computation, learned ref loading, `learnMinimapReference()`, `invalidateMinimapCache()`
- `src/routes/api/match/+server.ts` — calls `learnMinimapReference()` on POST and PATCH
- `data/minimap-references/learned/` — auto-populated learned references + manifest
- `scripts/bootstrap-minimap-refs.ts` — one-time bootstrapper for existing matches
- `scripts/test-minimap-detection.ts` — accuracy test across all strategies

## Future Work

- Accuracy will improve automatically as more matches are played (more learned refs per map)
- Rotated minimap handling is implemented but untested with real rotated screenshots (no test data available)
- Could add HSV histogram alongside RGB for even more discriminative color features if needed
