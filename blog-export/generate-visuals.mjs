import sharp from 'sharp';
import { readFileSync } from 'fs';
import { join } from 'path';

const BASE = '/Users/abogdanov/IdeaProjects/gw2-pvp-helper/blog-export';
const ICONS = join(BASE, 'visuals/reference-icons');
const CROPS = join(BASE, 'visuals/icon-crops');
const MINIMAP_REFS = join(BASE, 'visuals/minimap-references');
const FIXTURES = join(BASE, 'visuals/test-fixtures');
const OUT = join(BASE, 'generated-visuals');

const BG_COLOR = { r: 26, g: 26, b: 46, alpha: 255 }; // #1a1a2e
const TEXT_COLOR = '#ffffff';
const MUTED_COLOR = '#8888aa';
const RED_COLOR = '#ff4444';
const GREEN_COLOR = '#44dd66';
const ARROW_COLOR = '#555577';
const BORDER_COLOR = '#333355';

// Helper: create text as SVG rendered to buffer
function textSvg(text, fontSize = 14, color = TEXT_COLOR, maxWidth = 200, anchor = 'start', bold = false) {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const weight = bold ? 'font-weight="bold"' : '';
  const x = anchor === 'middle' ? maxWidth / 2 : 0;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${maxWidth}" height="${fontSize + 8}">
    <text x="${x}" y="${fontSize + 1}" font-family="monospace, Courier" font-size="${fontSize}" fill="${color}" text-anchor="${anchor}" ${weight}>${escaped}</text>
  </svg>`;
  return Buffer.from(svg);
}

// Helper: create a wide arrow SVG
function arrowSvg(width = 50, height = 24) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <line x1="6" y1="${height/2}" x2="${width-10}" y2="${height/2}" stroke="${ARROW_COLOR}" stroke-width="2.5" stroke-dasharray="4,3"/>
    <polygon points="${width-10},${height/2-6} ${width-2},${height/2} ${width-10},${height/2+6}" fill="${ARROW_COLOR}"/>
  </svg>`;
  return Buffer.from(svg);
}

// Helper: create a rect border overlay
function borderSvg(w, h, color = BORDER_COLOR, strokeWidth = 2) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect x="${strokeWidth/2}" y="${strokeWidth/2}" width="${w-strokeWidth}" height="${h-strokeWidth}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" rx="3"/>
  </svg>`;
  return Buffer.from(svg);
}

// Helper: create a "3/3" badge SVG
function badgeSvg(text, bgColor = '#661111', textColor = '#ff6666') {
  const w = 44;
  const h = 22;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect x="0" y="0" width="${w}" height="${h}" rx="4" fill="${bgColor}"/>
    <text x="${w/2}" y="15" font-family="monospace, Courier" font-size="13" fill="${textColor}" text-anchor="middle" font-weight="bold">${text}</text>
  </svg>`;
  return Buffer.from(svg);
}

// ============================================================
// IMG-2: Confusion Pair Grid
// ============================================================
async function generateConfusionPairs() {
  console.log('Generating confusion-pairs.png...');

  const pairs = [
    { crop: 'skyhammer_red_2_warrior', actualSpec: 'warrior', actualLabel: 'Core Warrior', llmGuess: 'firebrand', llmLabel: 'Firebrand' },
    { crop: 'skyhammer_blue_3_daredevil', actualSpec: 'daredevil', actualLabel: 'Daredevil', llmGuess: 'vindicator', llmLabel: 'Vindicator' },
    { crop: 'sunjiang_red_3_virtuoso', actualSpec: 'virtuoso', actualLabel: 'Virtuoso', llmGuess: 'firebrand', llmLabel: 'Firebrand' },
    { crop: 'djinns-dominion_red_4_chronomancer', actualSpec: 'chronomancer', actualLabel: 'Chronomancer', llmGuess: 'harbinger', llmLabel: 'Harbinger' },
  ];

  const ICON_BIG = 80;         // reference icons shown large
  const CROP_DISPLAY = 80;     // crop shown same size
  const ARROW_W = 50;
  const STAGE_GAP = 12;        // gap between arrow and next icon
  const ROW_H = 120;
  const PAD = 24;
  const HEADER_H = 28;
  const WIDTH = 820;

  const totalH = PAD + HEADER_H + pairs.length * ROW_H + PAD;
  const composites = [];

  // Column headers
  const col1X = PAD;
  const col2X = PAD + ICON_BIG + STAGE_GAP + ARROW_W + STAGE_GAP;
  const col3X = col2X + CROP_DISPLAY + STAGE_GAP + ARROW_W + STAGE_GAP;
  const labelColX = col3X + ICON_BIG + 24;

  composites.push({
    input: textSvg('Ground Truth', 11, MUTED_COLOR, ICON_BIG + 10, 'middle'),
    left: col1X - 5, top: PAD
  });
  composites.push({
    input: textSvg('Screenshot Crop', 11, MUTED_COLOR, 130, 'middle'),
    left: col2X + (CROP_DISPLAY - 130) / 2, top: PAD
  });
  composites.push({
    input: textSvg("Sonnet's Guess", 11, MUTED_COLOR, ICON_BIG + 10, 'middle'),
    left: col3X - 5, top: PAD
  });

  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];
    const rowY = PAD + HEADER_H + i * ROW_H;
    const iconY = rowY + 4;

    // — Stage 1: Ground truth reference icon —
    const actualIcon = await sharp(join(ICONS, `${p.actualSpec}.png`))
      .resize(ICON_BIG, ICON_BIG)
      .png().toBuffer();
    composites.push({ input: actualIcon, left: col1X, top: iconY });
    // Border around it
    composites.push({ input: borderSvg(ICON_BIG + 4, ICON_BIG + 4, '#336633'), left: col1X - 2, top: iconY - 2 });
    // Label
    composites.push({
      input: textSvg(p.actualLabel, 12, GREEN_COLOR, ICON_BIG + 20, 'start'),
      left: col1X, top: iconY + ICON_BIG + 4
    });

    // — Arrow 1 —
    const arrowY = iconY + ICON_BIG / 2 - 12;
    composites.push({
      input: arrowSvg(ARROW_W, 24),
      left: col1X + ICON_BIG + STAGE_GAP, top: arrowY
    });

    // — Stage 2: Screenshot crop —
    const cropBuf = await sharp(join(CROPS, `${p.crop}_8x.png`))
      .resize(CROP_DISPLAY, CROP_DISPLAY, { kernel: 'nearest' })
      .png().toBuffer();
    composites.push({ input: cropBuf, left: col2X, top: iconY });
    // Border
    composites.push({ input: borderSvg(CROP_DISPLAY + 4, CROP_DISPLAY + 4, BORDER_COLOR), left: col2X - 2, top: iconY - 2 });

    // — Arrow 2 —
    composites.push({
      input: arrowSvg(ARROW_W, 24),
      left: col2X + CROP_DISPLAY + STAGE_GAP, top: arrowY
    });

    // — Stage 3: LLM's wrong guess —
    const llmIcon = await sharp(join(ICONS, `${p.llmGuess}.png`))
      .resize(ICON_BIG, ICON_BIG)
      .png().toBuffer();
    composites.push({ input: llmIcon, left: col3X, top: iconY });
    // Red border
    composites.push({ input: borderSvg(ICON_BIG + 4, ICON_BIG + 4, '#663333'), left: col3X - 2, top: iconY - 2 });
    // Label
    composites.push({
      input: textSvg(p.llmLabel, 12, RED_COLOR, ICON_BIG + 20, 'start'),
      left: col3X, top: iconY + ICON_BIG + 4
    });

    // — Right side: verdict text —
    // "3/3" badge — prominent
    composites.push({
      input: badgeSvg('3/3'),
      left: labelColX, top: iconY + 4
    });

    // Actual vs guess
    composites.push({
      input: textSvg(`Actually: ${p.actualLabel}`, 13, GREEN_COLOR, 220),
      left: labelColX + 52, top: iconY + 4
    });
    composites.push({
      input: textSvg(`Guessed: ${p.llmLabel}`, 13, RED_COLOR, 220),
      left: labelColX + 52, top: iconY + 24
    });
  }

  await sharp({
    create: { width: WIDTH, height: totalH, channels: 4, background: BG_COLOR }
  })
    .composite(composites)
    .png()
    .toFile(join(OUT, 'confusion-pairs.png'));

  console.log('  → confusion-pairs.png');
}

// ============================================================
// IMG-3: Minimap Thumbnail Grid
// ============================================================
async function generateMinimapGrid() {
  console.log('Generating minimap-grid.png...');

  // 4 maps with paired screenshot crops — every blob has proof
  const maps = [
    { fixture: 'skyhammer', name: 'Skyhammer', ref: 'skyhammer_large_a.png' },
    { fixture: 'djinns-dominion', name: "Djinn's Dominion", ref: 'djinns_dominion_large.png' },
    { fixture: 'sunjiang', name: 'Sunjiang Backstreets', ref: 'sunjiang_backstreets_large.png' },
    { fixture: 'skyhammer2', name: 'Legacy of the Foefire', ref: 'legacy_of_the_foefire_large.png' },
  ];

  const CROP_SIZE = 150;
  const THUMB_DISPLAY = 128; // 16px * 8
  const COL_W = 180;
  const PAD = 20;
  const GAP = 16;
  const BORDER_W = 2;
  const HEADER_H = 24;

  // Layout: 4 columns top row, 3 columns bottom row
  // Each column: [crop 150] [8px gap] [thumb 128] [map name]
  // For ref-only maps: just [thumb 128] [map name], no crop

  const cols = 4;
  const totalW = PAD + cols * COL_W + (cols - 1) * GAP + PAD;

  const composites = [];

  // Header with the visual punchline
  composites.push({
    input: textSvg('16x16 pixel references vs actual minimap regions — 100% map detection accuracy', 12, MUTED_COLOR, totalW - 40),
    left: PAD, top: 8
  });

  // Row 1: 4 maps with screenshots (crop + thumb pair stacked vertically)
  const row1Y = PAD + HEADER_H;
  const cropThumbGap = 10;
  const thumbLabelGap = 4;

  for (let i = 0; i < 4; i++) {
    const m = maps[i];
    const x = PAD + i * (COL_W + GAP);
    const centerX = x + COL_W / 2;

    // Minimap crop from screenshot
    const minimapCrop = await sharp(join(FIXTURES, `${m.fixture}.png`))
      .extract({ left: 3100, top: 1100, width: 300, height: 300 })
      .resize(CROP_SIZE, CROP_SIZE)
      .png().toBuffer();

    const cropX = centerX - CROP_SIZE / 2;
    composites.push({ input: minimapCrop, left: Math.round(cropX), top: row1Y });
    // Border around crop
    composites.push({
      input: borderSvg(CROP_SIZE + 4, CROP_SIZE + 4, '#444466'),
      left: Math.round(cropX) - 2, top: row1Y - 2
    });

    // Down arrow between crop and thumb
    const downArrowY = row1Y + CROP_SIZE + 2;
    const downArrowSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="${cropThumbGap + 4}">
      <line x1="10" y1="0" x2="10" y2="${cropThumbGap - 2}" stroke="${ARROW_COLOR}" stroke-width="2"/>
      <polygon points="4,${cropThumbGap - 2} 10,${cropThumbGap + 3} 16,${cropThumbGap - 2}" fill="${ARROW_COLOR}"/>
    </svg>`;
    composites.push({ input: Buffer.from(downArrowSvg), left: Math.round(centerX) - 10, top: downArrowY });

    // Reference thumbnail (nearest-neighbor upscale)
    const refThumb = await sharp(join(MINIMAP_REFS, m.ref))
      .resize(THUMB_DISPLAY, THUMB_DISPLAY, { kernel: 'nearest' })
      .png().toBuffer();
    const thumbX = centerX - THUMB_DISPLAY / 2;
    const thumbY = row1Y + CROP_SIZE + cropThumbGap + 8;
    composites.push({ input: refThumb, left: Math.round(thumbX), top: thumbY });
    // Border around thumb
    composites.push({
      input: borderSvg(THUMB_DISPLAY + 4, THUMB_DISPLAY + 4, '#444466'),
      left: Math.round(thumbX) - 2, top: thumbY - 2
    });

    // Map name centered
    composites.push({
      input: textSvg(m.name, 12, TEXT_COLOR, COL_W, 'middle'),
      left: x, top: thumbY + THUMB_DISPLAY + thumbLabelGap
    });
  }

  const totalH = row1Y + CROP_SIZE + cropThumbGap + 8 + THUMB_DISPLAY + thumbLabelGap + 20 + PAD;

  await sharp({
    create: { width: totalW, height: totalH, channels: 4, background: BG_COLOR }
  })
    .composite(composites)
    .png()
    .toFile(join(OUT, 'minimap-grid.png'));

  console.log('  → minimap-grid.png');
}

// ============================================================
// IMG-COMPOSITE: LLM Reference Chart
// ============================================================
async function generateReferenceChart() {
  console.log('Generating reference-chart.png...');

  const specs = JSON.parse(readFileSync(join(BASE, 'data/specs.json'), 'utf-8'));
  const profOrder = ['guardian', 'revenant', 'warrior', 'engineer', 'ranger', 'thief', 'elementalist', 'mesmer', 'necromancer'];

  const ICON_SIZE = 64;
  const CELL_W = 100;
  const CELL_H = 96;
  const PAD = 24;
  const PROF_LABEL_W = 130;
  const COLS = 5;
  const ROWS = profOrder.length;
  const TITLE_H = 28;

  const totalW = PROF_LABEL_W + COLS * CELL_W + PAD;
  const totalH = PAD + TITLE_H + ROWS * CELL_H + PAD;

  const composites = [];

  // Title
  composites.push({
    input: textSvg('All 45 elite specializations — sent as a visual dictionary', 13, MUTED_COLOR, totalW - 40),
    left: PAD, top: 8
  });

  for (let row = 0; row < profOrder.length; row++) {
    const profId = profOrder[row];
    const prof = specs.professions[profId];
    const y = PAD + TITLE_H + row * CELL_H;

    // Profession label — larger, brighter
    composites.push({
      input: textSvg(prof.label, 15, '#bbbbdd', PROF_LABEL_W, 'start', true),
      left: PAD, top: y + ICON_SIZE / 2 - 7
    });

    for (let col = 0; col < prof.specs.length; col++) {
      const spec = prof.specs[col];
      const x = PROF_LABEL_W + col * CELL_W;

      const iconFile = spec.id === 'core' ? `${profId}.png` : `${spec.id}.png`;
      const icon = await sharp(join(ICONS, iconFile))
        .resize(ICON_SIZE, ICON_SIZE)
        .png().toBuffer();
      composites.push({ input: icon, left: x + (CELL_W - ICON_SIZE) / 2, top: y });

      const label = spec.id === 'core' ? 'core' : spec.id;
      composites.push({
        input: textSvg(label, 10, '#cccccc', CELL_W, 'middle'),
        left: x, top: y + ICON_SIZE + 2
      });
    }
  }

  await sharp({
    create: { width: totalW, height: totalH, channels: 4, background: BG_COLOR }
  })
    .composite(composites)
    .png()
    .toFile(join(OUT, 'reference-chart.png'));

  console.log('  → reference-chart.png');
}

// Run all
async function main() {
  await generateConfusionPairs();
  await generateMinimapGrid();
  await generateReferenceChart();
  console.log('\nAll visuals generated in blog-export/generated-visuals/');
}

main().catch(console.error);
