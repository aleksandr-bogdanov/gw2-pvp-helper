import sharp from 'sharp';
import { join } from 'path';

const FIXTURES = '/Users/abogdanov/IdeaProjects/gw2-pvp-helper/blog-export/visuals/test-fixtures';
const MINIMAP_REFS = '/Users/abogdanov/IdeaProjects/gw2-pvp-helper/blog-export/visuals/minimap-references';
const BLOG_IMAGES = '/Users/abogdanov/IdeaProjects/bogdanov-wtf/src/content/blog/images';

// Djinn's Dominion — colorful map with distinct blue/gold terrain
const fixture = 'djinns-dominion.png';
const ref = 'djinns_dominion_large.png';
const mapName = 'djinns-dominion';

async function main() {
  // 1. Crop 300×300 minimap region from screenshot
  await sharp(join(FIXTURES, fixture))
    .extract({ left: 3100, top: 1100, width: 300, height: 300 })
    .png()
    .toFile(join(BLOG_IMAGES, `minimap-crop-${mapName}.png`));
  console.log(`→ minimap-crop-${mapName}.png (300×300 crop)`);

  // 2. Upscale 16×16 reference to 300×300 with nearest-neighbor
  await sharp(join(MINIMAP_REFS, ref))
    .resize(300, 300, { kernel: 'nearest' })
    .png()
    .toFile(join(BLOG_IMAGES, `minimap-ref-${mapName}.png`));
  console.log(`→ minimap-ref-${mapName}.png (16×16 → 300×300 nearest-neighbor)`);
}

main().catch(console.error);
