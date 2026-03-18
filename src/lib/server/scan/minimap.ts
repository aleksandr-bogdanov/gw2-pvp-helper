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
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import sharp from 'sharp';
import type { RawImage, GameMode } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const THUMB_DIR = resolve(__dirname, '../../../../data/minimap-references/thumbs');
const LEARNED_DIR = resolve(__dirname, '../../../../data/minimap-references/learned');

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

/** Number of bins per RGB channel for the color histogram */
const HIST_BINS = 8;
/** Total histogram feature length: HIST_BINS^3 (RGB joint histogram) */
const HIST_SIZE = HIST_BINS * HIST_BINS * HIST_BINS;
/** Number of concentric rings for radial color profile */
const RADIAL_RINGS = 6;
/** Total radial feature length: rings × 3 channels */
const RADIAL_SIZE = RADIAL_RINGS * 3;

interface MinimapReference {
	mapId: string;
	/** Spatial features: raw 16×16×3 pixel values (rotation-sensitive) */
	features: Float64Array;
	/** Rotation-invariant features: color histogram + radial profile */
	riFeatures: Float64Array;
}

export interface MapDetectionResult {
	mapId: string;
	mode: GameMode;
	confidence: number;
}

let references: MinimapReference[] | null = null;
let refsLoading: Promise<MinimapReference[]> | null = null;

/**
 * Load a manifest file and return references from a given directory.
 */
async function loadManifestRefs(dir: string, manifestFile: string): Promise<MinimapReference[]> {
	const manifestPath = resolve(dir, manifestFile);
	if (!existsSync(manifestPath)) return [];

	const manifest: { mapId: string; file: string }[] = JSON.parse(
		readFileSync(manifestPath, 'utf-8')
	);

	const refs: MinimapReference[] = [];
	for (const entry of manifest) {
		const filePath = resolve(dir, entry.file);
		if (!existsSync(filePath)) continue;
		const { data } = await sharp(filePath)
			.removeAlpha()
			.toColorspace('srgb')
			.raw()
			.toBuffer({ resolveWithObject: true });

		const features = new Float64Array(THUMB_SIZE * THUMB_SIZE * 3);
		for (let i = 0; i < features.length; i++) {
			features[i] = data[i] / 255.0;
		}

		const riFeatures = computeRotationInvariantFeatures(features);
		refs.push({ mapId: entry.mapId, features, riFeatures });
	}

	return refs;
}

/**
 * Load reference thumbnails from both static and learned manifests.
 */
async function loadReferences(): Promise<MinimapReference[]> {
	const [staticRefs, learnedRefs] = await Promise.all([
		loadManifestRefs(THUMB_DIR, 'manifest.json'),
		loadManifestRefs(LEARNED_DIR, 'manifest.json')
	]);
	return [...staticRefs, ...learnedRefs];
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
 * Compute rotation-invariant features from a 16×16 RGB thumbnail.
 *
 * Two components:
 * 1. Joint RGB color histogram (8×8×8 = 512 bins) — captures the overall
 *    color palette of the map, completely invariant to rotation.
 * 2. Radial color profile (6 rings × 3 channels = 18 values) — captures
 *    how colors change from center to edge, invariant to rotation.
 *
 * Both are L2-normalized and concatenated into a single feature vector.
 */
function computeRotationInvariantFeatures(spatial: Float64Array): Float64Array {
	const size = THUMB_SIZE;
	const totalPixels = size * size;

	// --- 1. Joint RGB color histogram ---
	const hist = new Float64Array(HIST_SIZE);
	for (let i = 0; i < totalPixels; i++) {
		const r = spatial[i * 3];
		const g = spatial[i * 3 + 1];
		const b = spatial[i * 3 + 2];
		const rBin = Math.min(Math.floor(r * HIST_BINS), HIST_BINS - 1);
		const gBin = Math.min(Math.floor(g * HIST_BINS), HIST_BINS - 1);
		const bBin = Math.min(Math.floor(b * HIST_BINS), HIST_BINS - 1);
		hist[rBin * HIST_BINS * HIST_BINS + gBin * HIST_BINS + bBin]++;
	}
	// Normalize histogram to sum to 1
	for (let i = 0; i < HIST_SIZE; i++) hist[i] /= totalPixels;

	// --- 2. Radial color profile ---
	const radial = new Float64Array(RADIAL_SIZE);
	const radialCounts = new Float64Array(RADIAL_RINGS);
	const cx = (size - 1) / 2;
	const cy = (size - 1) / 2;
	const maxDist = Math.sqrt(cx * cx + cy * cy);

	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const dist = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
			const ring = Math.min(Math.floor((dist / maxDist) * RADIAL_RINGS), RADIAL_RINGS - 1);
			const idx = (y * size + x) * 3;
			radial[ring * 3] += spatial[idx];
			radial[ring * 3 + 1] += spatial[idx + 1];
			radial[ring * 3 + 2] += spatial[idx + 2];
			radialCounts[ring]++;
		}
	}
	// Average per ring
	for (let ring = 0; ring < RADIAL_RINGS; ring++) {
		if (radialCounts[ring] > 0) {
			radial[ring * 3] /= radialCounts[ring];
			radial[ring * 3 + 1] /= radialCounts[ring];
			radial[ring * 3 + 2] /= radialCounts[ring];
		}
	}

	// --- Concatenate and L2-normalize ---
	const combined = new Float64Array(HIST_SIZE + RADIAL_SIZE);
	// Weight histogram more heavily (it has more discriminative power)
	for (let i = 0; i < HIST_SIZE; i++) combined[i] = hist[i];
	for (let i = 0; i < RADIAL_SIZE; i++) combined[HIST_SIZE + i] = radial[i] * 0.5;

	let norm = 0;
	for (let i = 0; i < combined.length; i++) norm += combined[i] * combined[i];
	norm = Math.sqrt(norm);
	if (norm > 0) {
		for (let i = 0; i < combined.length; i++) combined[i] /= norm;
	}

	return combined;
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

	// Compute rotation-invariant features for the query
	const queryRI = computeRotationInvariantFeatures(thumbFeatures);

	// Score against all references using both spatial and RI features
	const allScores = refs.map((ref) => ({
		mapId: ref.mapId,
		spatialScore: cosineSimilarity(thumbFeatures, ref.features),
		riScore: cosineSimilarity(queryRI, ref.riFeatures)
	}));

	// Max-pool per map for each score type
	const spatialScores: Record<string, number> = {};
	const riScores: Record<string, number> = {};
	for (const { mapId, spatialScore, riScore } of allScores) {
		if (!spatialScores[mapId] || spatialScore > spatialScores[mapId]) {
			spatialScores[mapId] = spatialScore;
		}
		if (!riScores[mapId] || riScore > riScores[mapId]) {
			riScores[mapId] = riScore;
		}
	}

	// Rank by spatial (primary) and RI (secondary/fallback)
	const mapIds = [...new Set(allScores.map(s => s.mapId))];

	const spatialRanked = mapIds
		.map(mapId => ({ mapId, score: spatialScores[mapId] }))
		.sort((a, b) => b.score - a.score);
	const riRanked = mapIds
		.map(mapId => ({ mapId, score: riScores[mapId] }))
		.sort((a, b) => b.score - a.score);

	if (spatialRanked.length === 0) {
		return null;
	}

	const spatialGap = spatialRanked.length > 1
		? spatialRanked[0].score - spatialRanked[1].score
		: spatialRanked[0].score;
	const riGap = riRanked.length > 1
		? riRanked[0].score - riRanked[1].score
		: riRanked[0].score;

	// Use spatial result if its gap is decent; otherwise fall back to RI
	// A low spatial gap suggests possible rotation (spatial features scrambled)
	let best: { mapId: string; score: number };
	let gap: number;

	if (spatialGap >= 0.03) {
		// Spatial is confident enough
		best = spatialRanked[0];
		gap = spatialGap;
	} else if (riGap > spatialGap) {
		// RI features have better separation — likely rotated minimap
		best = riRanked[0];
		gap = riGap;
	} else {
		// Both are weak, go with spatial
		best = spatialRanked[0];
		gap = spatialGap;
	}

	// Confidence: use the gap between 1st and 2nd as a confidence measure.
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

/**
 * Invalidate cached references so the next detection picks up newly learned ones.
 */
export function invalidateMinimapCache(): void {
	references = null;
	refsLoading = null;
}

/**
 * Learn a new minimap reference from a saved screenshot file.
 *
 * Extracts the minimap thumbnail from the screenshot and saves it to the
 * learned references directory. This allows the system to improve map detection
 * over time based on user corrections.
 *
 * @param screenshotPath - Absolute path to the screenshot file
 * @param mapId - The correct map ID (from user correction or confirmed scan)
 * @param screenshotHash - Hash used for the filename (must be unique per screenshot)
 */
export async function learnMinimapReference(
	screenshotPath: string,
	mapId: string,
	screenshotHash: string
): Promise<void> {
	// Validate map ID
	if (!MAP_MODES[mapId]) {
		console.warn(`[minimap-learn] Unknown map ID: ${mapId}, skipping`);
		return;
	}

	// Load screenshot as RGB
	const { data, info } = await sharp(screenshotPath)
		.removeAlpha()
		.toColorspace('srgb')
		.raw()
		.toBuffer({ resolveWithObject: true });

	const rgbImage: RawImage = {
		data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
		width: info.width,
		height: info.height,
		channels: 3
	};

	// Extract minimap thumbnail
	let thumbFeatures: Float64Array;
	try {
		thumbFeatures = await extractMinimapThumb(rgbImage);
	} catch (e) {
		console.warn(`[minimap-learn] Could not extract minimap from ${screenshotHash}: ${e}`);
		return;
	}

	// Save the 16×16 thumbnail as PNG
	const thumbPixels = new Uint8Array(THUMB_SIZE * THUMB_SIZE * 3);
	for (let i = 0; i < thumbFeatures.length; i++) {
		thumbPixels[i] = Math.round(thumbFeatures[i] * 255);
	}

	if (!existsSync(LEARNED_DIR)) {
		mkdirSync(LEARNED_DIR, { recursive: true });
	}

	const thumbFilename = `${mapId}_${screenshotHash}.png`;
	const thumbPath = resolve(LEARNED_DIR, thumbFilename);

	await sharp(Buffer.from(thumbPixels), {
		raw: { width: THUMB_SIZE, height: THUMB_SIZE, channels: 3 }
	})
		.png()
		.toFile(thumbPath);

	// Update learned manifest
	const manifestPath = resolve(LEARNED_DIR, 'manifest.json');
	let manifest: { mapId: string; file: string }[] = [];
	if (existsSync(manifestPath)) {
		manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
	}

	// Replace if same screenshot hash exists, otherwise append
	const existingIdx = manifest.findIndex((e) => e.file === thumbFilename);
	if (existingIdx >= 0) {
		manifest[existingIdx].mapId = mapId;
	} else {
		manifest.push({ mapId, file: thumbFilename });
	}

	writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

	// Invalidate cache so next scan uses the new reference
	invalidateMinimapCache();

	console.log(`[minimap-learn] Learned ${mapId} from ${screenshotHash} (${manifest.length} total learned refs)`);
}
