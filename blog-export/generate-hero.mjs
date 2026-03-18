import sharp from 'sharp';
import { join } from 'path';

const BASE = '/Users/abogdanov/IdeaProjects/gw2-pvp-helper/blog-export';
const ICONS = join(BASE, 'visuals/reference-icons');
const CROPS = join(BASE, 'visuals/icon-crops');
const OUT = join(BASE, 'generated-visuals');

const W = 1200;
const H = 630;
const BG = { r: 26, g: 27, b: 46, alpha: 255 }; // #1a1b2e

const SQUARE = 280;
const GAP = 120;        // space between the two squares (for arrow)
const FRAME_PAD = 6;    // border inset
const FRAME_R = 6;      // border radius

// Total block width: SQUARE + GAP + SQUARE = 680
// Centered: (1200 - 680) / 2 = 260
const blockLeft = Math.round((W - (SQUARE * 2 + GAP)) / 2);
const squareY = Math.round((H - SQUARE - 70) / 2); // shift up a bit for the % text below

function frameSvg(size, color, strokeWidth = 2.5) {
  const s = strokeWidth / 2;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size + strokeWidth * 2}" height="${size + strokeWidth * 2}">
    <rect x="${s}" y="${s}" width="${size + strokeWidth}" height="${size + strokeWidth}" rx="${FRAME_R}" fill="none" stroke="${color}" stroke-width="${strokeWidth}"/>
  </svg>`);
}

function percentSvg(text, color, fontSize = 52) {
  const w = 300;
  const h = fontSize + 12;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <text x="${w/2}" y="${fontSize + 2}" font-family="'SF Mono', 'Fira Code', 'Cascadia Code', monospace, Courier" font-size="${fontSize}" fill="${color}" text-anchor="middle" font-weight="bold">${text}</text>
  </svg>`);
}

function annotationSvg(text, fontSize = 11) {
  const w = 160;
  const h = fontSize + 8;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <text x="${w}" y="${fontSize + 1}" font-family="monospace, Courier" font-size="${fontSize}" fill="#666680" text-anchor="end">${text}</text>
  </svg>`);
}

function arrowSvg() {
  const w = 60;
  const h = 40;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <line x1="4" y1="${h/2}" x2="${w-14}" y2="${h/2}" stroke="#444466" stroke-width="3" stroke-linecap="round"/>
    <polygon points="${w-14},${h/2-8} ${w-2},${h/2} ${w-14},${h/2+8}" fill="#444466"/>
  </svg>`);
}

async function main() {
  console.log('Generating hero.png (1200×630 og:image)...');

  const composites = [];

  // === LEFT SQUARE: blurry crop blown up ===
  const leftX = blockLeft;

  // Load 40×40 crop, blow up to SQUARE with nearest-neighbor (blocky pixels)
  // Chronomancer crop — everyone knows what a clock looks like, so seeing it
  // reduced to an unreadable red blob is instantly felt. Also a real 3/3 failure.
  // Downscale 40→30px to match claimed size, then blow up nearest-neighbor
  const tinyBuf = await sharp(join(CROPS, 'djinns-dominion_red_4_chronomancer.png'))
    .resize(30, 30, { kernel: 'nearest' })
    .png().toBuffer();
  const cropBuf = await sharp(tinyBuf)
    .resize(SQUARE, SQUARE, { kernel: 'nearest' })
    .png().toBuffer();
  composites.push({ input: cropBuf, left: leftX, top: squareY });

  // Frame
  composites.push({
    input: frameSvg(SQUARE, '#553333', 2.5),
    left: leftX - 3, top: squareY - 3
  });

  // Annotation: "40px icon, 7× zoom" at top-right of left square
  composites.push({
    input: annotationSvg('30px icon, 9x zoom', 11),
    left: leftX + SQUARE - 160, top: squareY - 18
  });

  // "24%" below left square
  composites.push({
    input: percentSvg('24%', '#cc5555'),
    left: leftX + (SQUARE - 300) / 2, top: squareY + SQUARE + 16
  });

  // === ARROW between squares ===
  const arrowX = leftX + SQUARE + (GAP - 60) / 2;
  const arrowY = squareY + SQUARE / 2 - 20;
  composites.push({ input: arrowSvg(), left: arrowX, top: arrowY });

  // === RIGHT SQUARE: clean reference icon ===
  const rightX = leftX + SQUARE + GAP;

  // Load 64×64 reference, scale to SQUARE (crisp since it's vector-like)
  const refBuf = await sharp(join(ICONS, 'chronomancer.png'))
    .resize(SQUARE, SQUARE)
    .png().toBuffer();
  composites.push({ input: refBuf, left: rightX, top: squareY });

  // Frame
  composites.push({
    input: frameSvg(SQUARE, '#335533', 2.5),
    left: rightX - 3, top: squareY - 3
  });

  // "97.5%" below right square
  composites.push({
    input: percentSvg('97.5%', '#44bb55'),
    left: rightX + (SQUARE - 300) / 2, top: squareY + SQUARE + 16
  });

  await sharp({
    create: { width: W, height: H, channels: 4, background: BG }
  })
    .composite(composites)
    .png()
    .toFile(join(OUT, 'hero.png'));

  console.log('  → hero.png (1200×630)');
}

main().catch(console.error);
