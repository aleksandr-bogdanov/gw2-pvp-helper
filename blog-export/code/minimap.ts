/**
 * Minimap-based map detection for GW2 PvP scoreboard screenshots.
 *
 * Strategy:
 * 1. Extract a fixed region from the bottom-right corner where the minimap lives.
 * 2. Downscale to a 16×16 RGB thumbnail (blurs out icons, markers, fog of war).
 * 3. Cosine similarity against pre-computed reference thumbnails.
 * 4. Multiple references per map (different UI sizes, game states) with max-pooling.
 *
 * Accuracy: 23/23 (100%) on test fixtures with minimum gap of 0.04.
 * Also solves game mode detection: each map is tied to exactly one mode,
 * replacing the unreliable Y-coordinate heuristic for moved windows.
 *
 * The minimap is always anchored to the bottom-right corner of the screen.
 * Its size scales with UI size (Small → Larger), but the safe inner region
 * at (3100, 1100, 300×300) contains map content for all 4 UI presets.
 */

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import sharp from 'sharp';
import type { RawImage, GameMode } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const THUMB_DIR = resolve(__dirname, '../../../../data/minimap-references/thumbs');

/** Minimap crop region — safe inner area shared by all UI sizes at 3440×1440 */
const CROP_X = 3100;
const CROP_Y = 1100;
const CROP_W = 300;
const CROP_H = 300;

/** Thumbnail size for matching */
const THUMB_SIZE = 16;

/**
 * Map ID → game mode lookup.
 * IDs match src/lib/maps.json. All conquest maps + sunjiang (push).
 * Champion's Dusk is "stronghold" but cast to GameMode since that type
 * only defines conquest|push — stronghold support is TBD.
 */
const MAP_MODES: Record<string, GameMode> = {
	skyhammer: 'conquest',
	djinns_dominion: 'conquest',
	eternal_coliseum: 'conquest',
	forest_of_niflhel: 'conquest',
	legacy_of_the_foefire: 'conquest',
	temple_of_the_silent_storm: 'conquest',
	battle_of_kyhlo: 'conquest',
	revenge_of_the_capricorn: 'conquest',
	spirit_watch: 'conquest',
	sunjiang_backstreets: 'push',
	battle_of_champions_dusk: 'stronghold' as GameMode
};

interface MinimapReference {
	mapId: string;
	features: Float64Array;
}

export interface MapDetectionResult {
	mapId: string;
	mode: GameMode;
	confidence: number;
}

let references: MinimapReference[] | null = null;
let refsLoading: Promise<MinimapReference[]> | null = null;

/**
 * Load reference thumbnails from the manifest.
 */
async function loadReferences(): Promise<MinimapReference[]> {
	const manifestPath = resolve(THUMB_DIR, 'manifest.json');
	const manifest: { mapId: string; file: string }[] = JSON.parse(
		readFileSync(manifestPath, 'utf-8')
	);

	const refs: MinimapReference[] = [];
	for (const entry of manifest) {
		const filePath = resolve(THUMB_DIR, entry.file);
		const { data } = await sharp(filePath)
			.removeAlpha()
			.toColorspace('srgb')
			.raw()
			.toBuffer({ resolveWithObject: true });

		const features = new Float64Array(THUMB_SIZE * THUMB_SIZE * 3);
		for (let i = 0; i < features.length; i++) {
			features[i] = data[i] / 255.0;
		}

		refs.push({ mapId: entry.mapId, features });
	}

	return refs;
}

async function getReferences(): Promise<MinimapReference[]> {
	if (references) return references;
	if (!refsLoading) {
		refsLoading = loadReferences().then((r) => {
			references = r;
			return r;
		});
	}
	return refsLoading;
}

/**
 * Cosine similarity between two feature vectors.
 * Returns value in [-1, 1], where 1 = identical.
 */
function cosineSimilarity(a: Float64Array, b: Float64Array): number {
	let dot = 0,
		normA = 0,
		normB = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}
	const denom = Math.sqrt(normA) * Math.sqrt(normB);
	return denom > 0 ? dot / denom : 0;
}

/**
 * Extract the minimap thumbnail from a screenshot.
 *
 * Takes the full-resolution RGB image, crops the bottom-right minimap region,
 * and downscales to 16×16.
 */
async function extractMinimapThumb(rgbImage: RawImage): Promise<Float64Array> {
	// Clamp crop to image bounds
	const x1 = Math.min(CROP_X, rgbImage.width);
	const y1 = Math.min(CROP_Y, rgbImage.height);
	const x2 = Math.min(CROP_X + CROP_W, rgbImage.width);
	const y2 = Math.min(CROP_Y + CROP_H, rgbImage.height);
	const w = x2 - x1;
	const h = y2 - y1;

	if (w < 50 || h < 50) {
		throw new Error(
			`Minimap region too small (${w}×${h}). Expected 3440×1440 screenshot.`
		);
	}

	// Extract ROI from raw RGB buffer
	const roiData = Buffer.alloc(w * h * 3);
	for (let row = 0; row < h; row++) {
		const srcOffset = ((y1 + row) * rgbImage.width + x1) * 3;
		const dstOffset = row * w * 3;
		roiData.set(rgbImage.data.subarray(srcOffset, srcOffset + w * 3), dstOffset);
	}

	// Downscale to thumbnail
	const { data } = await sharp(roiData, {
		raw: { width: w, height: h, channels: 3 }
	})
		.resize(THUMB_SIZE, THUMB_SIZE, { kernel: 'lanczos3' })
		.raw()
		.toBuffer({ resolveWithObject: true });

	const features = new Float64Array(THUMB_SIZE * THUMB_SIZE * 3);
	for (let i = 0; i < features.length; i++) {
		features[i] = data[i] / 255.0;
	}

	return features;
}

/**
 * Detect which PvP map is shown in the screenshot's minimap.
 *
 * @param _grayImage - Grayscale image (unused, kept for API consistency)
 * @param rgbImage - Full-resolution RGB image (3440×1440, 3 channels)
 * @returns Map ID, game mode, and confidence score, or null if detection fails
 */
export async function detectMap(
	_grayImage: RawImage,
	rgbImage?: RawImage
): Promise<MapDetectionResult | null> {
	if (!rgbImage || rgbImage.channels !== 3) {
		return null;
	}

	const refs = await getReferences();
	if (refs.length === 0) {
		return null;
	}

	let thumbFeatures: Float64Array;
	try {
		thumbFeatures = await extractMinimapThumb(rgbImage);
	} catch {
		return null;
	}

	// Score against all references
	const allScores = refs.map((ref) => ({
		mapId: ref.mapId,
		score: cosineSimilarity(thumbFeatures, ref.features)
	}));

	// Max-pool: best score per map
	const mapScores: Record<string, number> = {};
	for (const { mapId, score } of allScores) {
		if (!mapScores[mapId] || score > mapScores[mapId]) {
			mapScores[mapId] = score;
		}
	}

	// Rank maps
	const ranked = Object.entries(mapScores)
		.map(([mapId, score]) => ({ mapId, score }))
		.sort((a, b) => b.score - a.score);

	if (ranked.length === 0) {
		return null;
	}

	const best = ranked[0];
	const second = ranked.length > 1 ? ranked[1] : { score: 0 };
	const gap = best.score - second.score;

	// Confidence: use the gap between 1st and 2nd as a confidence measure.
	// Minimum useful gap is ~0.04 from experiments.
	// Map raw gap [0, 0.3+] to confidence [0, 1].
	const confidence = Math.min(gap / 0.15, 1.0);

	const mode = MAP_MODES[best.mapId] || 'conquest';

	return {
		mapId: best.mapId,
		mode,
		confidence
	};
}

/**
 * Pre-warm the minimap detector by loading reference thumbnails.
 */
export async function warmupMinimap(): Promise<void> {
	await getReferences();
}
