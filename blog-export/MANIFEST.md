# Blog Export Manifest

All files collected for the GW2 PvP Helper technical blog post.

## code/ — Complete scan pipeline source (8 files)

| File | Original Path | Description |
|------|--------------|-------------|
| `anchor.ts` | `src/lib/server/scan/anchor.ts` | NCC template matching for scoreboard close button (X) — full pixel scan, 4 templates, team color disambiguation |
| `classifier.ts` | `src/lib/server/scan/classifier.ts` | Custom HOG k-NN icon classifier — gradient computation, orientation binning, L2-Hys block normalization, cosine distance matching against 45 references |
| `minimap.ts` | `src/lib/server/scan/minimap.ts` | Minimap-based map + mode detection — 16x16 RGB thumbnail cosine similarity against reference thumbnails |
| `ocr.ts` | `src/lib/server/scan/ocr.ts` | Tesseract.js OCR with 4-worker pool — scale 3x → negate → threshold → trim black borders → re-pad white preprocessing pipeline |
| `index.ts` | `src/lib/server/scan/index.ts` | Main scan pipeline orchestrator — chains anchor → minimap → layout → classification → OCR |
| `layouts.ts` | `src/lib/server/scan/layouts.ts` | 8 layout presets (4 UI sizes × 2 game modes) with calibrated pixel offsets from anchor point |
| `preprocess.ts` | `src/lib/server/scan/preprocess.ts` | Image preprocessing utilities — Sharp-based grayscale loading, ROI extraction, resize with channel fix |
| `types.ts` | `src/lib/server/scan/types.ts` | Shared TypeScript types — RawImage, AnchorResult, LayoutPreset, UISize, GameMode, etc. |

## visuals/reference-icons/ — 45 elite spec reference icons

| Source | Description |
|--------|-------------|
| `data/profession-icons/wiki-big/*.png` | 64x64 RGBA white silhouettes on transparent background from GW2 Wiki. 45 files: 9 base professions + 36 elite specs. Used as HOG reference features for classification. |

### Full list of icons:
guardian, warrior, revenant, engineer, ranger, thief, elementalist, mesmer, necromancer, willbender, firebrand, dragonhunter, luminary, berserker, spellbreaker, bladesworn, paragon, herald, renegade, vindicator, conduit, scrapper, holosmith, mechanist, amalgam, soulbeast, druid, untamed, galeshot, daredevil, deadeye, specter, antiquary, tempest, weaver, catalyst, evoker, chronomancer, mirage, virtuoso, troubadour, reaper, scourge, harbinger, ritualist

## visuals/minimap-references/ — 16x16 map detection thumbnails (17 files)

| File | Original Path | Description |
|------|--------------|-------------|
| `manifest.json` | `data/minimap-references/thumbs/manifest.json` | Maps mapId → reference thumbnail filenames |
| `skyhammer_*.png` (4) | `data/minimap-references/thumbs/` | Skyhammer references (4 UI sizes) |
| `djinns_dominion_*.png` (3) | `data/minimap-references/thumbs/` | Djinn's Dominion references (large, larger, small) |
| `sunjiang_backstreets_*.png` (2) | `data/minimap-references/thumbs/` | Sunjiang Backstreets references (large, larger push) |
| `eternal_coliseum_*.png` (2) | `data/minimap-references/thumbs/` | Eternal Coliseum references |
| `forest_of_niflhel_*.png` (2) | `data/minimap-references/thumbs/` | Forest of Niflhel references |
| `legacy_of_the_foefire_*.png` (2) | `data/minimap-references/thumbs/` | Legacy of the Foefire references |
| `temple_of_the_silent_storm_*.png` (1) | `data/minimap-references/thumbs/` | Temple of the Silent Storm reference |

## visuals/x-templates/ — Close button (X) templates (4 files)

| File | Original Path | Description |
|------|--------------|-------------|
| `x_template_small.png` | `data/x-templates/` | Small UI size X button (21x21px) |
| `x_template_normal_ui.png` | `data/x-templates/` | Normal UI size X button (23x23px) |
| `x_template_normal.png` | `data/x-templates/` | Large UI size X button (24x24px) — historical naming from before all 4 sizes were discovered |
| `x_template_zoomed.png` | `data/x-templates/` | Larger UI size X button (28x28px) |

## visuals/test-fixtures/ — Scoreboard screenshots (4 files)

| File | Original Path | Description |
|------|--------------|-------------|
| `skyhammer.png` | `tests/fixtures/skyhammer.png` | 3440x1440 Conquest, Large UI — Skyhammer map, user is Allenheim (thief) |
| `sunjiang.png` | `tests/fixtures/sunjiang.png` | 3440x1440 Push, Large UI — Sunjiang Backstreets, user is Allenheim (thief) |
| `djinns-dominion.png` | `tests/fixtures/djinns-dominion.png` | 3440x1440 Conquest, Large UI — Djinn's Dominion, user is Kors Pahomius (warrior/paragon) |
| `skyhammer2.png` | `tests/fixtures/skyhammer2.png` | 3440x1440 Conquest, Large UI — actually Legacy of the Foefire (mislabeled), user is Kors Pahomius |

## visuals/icon-crops/ — Extracted icon crops (261 files)

| Source | Description |
|--------|-------------|
| `../gw2-research/experiments/icon-classifier/crops/` | ~35-45px icon crops extracted from test screenshots. Naming: `{screenshot}_{team}_{row}_{label}.png`. Includes 8x upscaled versions (`_8x.png`) for visual inspection. 22 unique specs represented across 40 base crops + upscaled variants. |

## data/ — Configuration and ground truth (4 files)

| File | Original Path | Description |
|------|--------------|-------------|
| `specs.json` | `src/lib/specs.json` | All 9 professions, 45 elite specs — IDs, names, roles, default_role, profession mapping |
| `maps.json` | `src/lib/maps.json` | 11 PvP maps — ID, display name, game mode (conquest/push/stronghold), mechanics |
| `expected.json` | `tests/fixtures/expected.json` | Ground truth roster for 4 labeled test fixtures — spec_id per player, team assignments |
| `align-crops.json` | `tests/fixtures/align-crops.json` | Calibrated anchor positions + crop coordinates for all 23 test screenshots |

## generated-visuals/ — Blog post visual assets (3 files)

| File | Description |
|------|-------------|
| `confusion-pairs.png` | **IMG-2: Confusion Pair Grid** — 6-row composite showing LLM misclassification cases. Each row: ground truth reference icon → actual screenshot crop → LLM's wrong guess icon, with labels. Covers 6 specs the LLM got wrong 3/3 runs (core warrior→firebrand, daredevil→vindicator, daredevil→willbender, virtuoso→firebrand, chronomancer→harbinger, core engineer→harbinger). Dark background, green/red color coding. |
| `minimap-grid.png` | **IMG-3: Minimap Thumbnail Grid** — 7 maps shown with 300×300 minimap crops from test screenshots (4 maps) and 16×16 reference thumbnails upscaled 8× with nearest-neighbor interpolation (all 7 maps). Visual punchline: "these blobs achieve 100% accuracy." |
| `reference-chart.png` | **IMG-COMPOSITE: LLM Reference Chart** — 9×5 grid of all 45 elite spec icons (9 professions × 5 specs each). Dark background (#1a1a2e), white icon silhouettes with labels. Recreates the visual dictionary image that was sent to the LLM as Image 1 during the v1 scan approach. |

| `hero.png` | **Hero/splash image** — 1200×630 og:image social card. Left: 40px warrior icon crop blown up to 280px (blocky pixels, red tint) with "24%" below. Right: clean 64px gold reference icon at 280px with "97.5%" below. Arrow between. Dark navy background (#1a1b2e). |

### Generation

- `blog-export/generate-visuals.mjs` — confusion-pairs, minimap-grid, reference-chart. Run: `node blog-export/generate-visuals.mjs`
- `blog-export/generate-hero.mjs` — hero og:image. Run: `node blog-export/generate-hero.mjs`
