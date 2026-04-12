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
 *
 * References are stored in the minimap_references DB table, with in-memory
 * cache for fast detection. On first load, if the DB table is empty, it is
 * seeded from data/minimap-references/thumbs/manifest.json.
 */

import { resolve } from 'path';
import { readFileSync, existsSync } from 'fs';
import sharp from 'sharp';
import type { RawImage, GameMode } from './types.js';
import { logger } from '$lib/server/logger.js';
import { db } from '$lib/server/db/index.js';
import { minimapReferences } from '$lib/server/db/schema.js';
import { eq } from 'drizzle-orm';

const THUMB_DIR = resolve(process.cwd(), 'data', 'minimap-references', 'thumbs');

/** Reference resolution for crop region constants */
const REFERENCE_WIDTH = 3440;
const REFERENCE_HEIGHT = 1440;

/** Minimap crop region — safe inner area shared by all UI sizes at 3440x1440.
 *  Scaled proportionally at runtime for other resolutions. */
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
	battle_of_champions_dusk: 'stronghold'
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
 * Encode a Float64Array as a base64 string for DB storage.
 */
function encodeFeatures(features: Float64Array): string {
	return Buffer.from(features.buffer).toString('base64');
}

/**
 * Decode a base64 string back to Float64Array.
 */
function decodeFeatures(encoded: string): Float64Array {
	const buf = Buffer.from(encoded, 'base64');
	// Copy to a fresh Uint8Array to ensure 8-byte alignment required by Float64Array.
	// Buffer.from(base64) may return a non-aligned slice from the pool allocator.
	const aligned = new Uint8Array(buf);
	return new Float64Array(aligned.buffer);
}

/**
 * Seed the minimap_references table from the static manifest.json file.
 * Only runs if the table is empty.
 */
export async function seedMinimapReferences(): Promise<number> {
	// Check if table already has data
	const existing = await db.select({ id: minimapReferences.id }).from(minimapReferences).limit(1);
	if (existing.length > 0) {
		return 0;
	}

	const manifestPath = resolve(THUMB_DIR, 'manifest.json');
	if (!existsSync(manifestPath)) {
		logger.warn({ event: 'minimap_seed_no_manifest' }, 'No manifest.json found for seeding');
		return 0;
	}

	const manifest: { mapId: string; file: string }[] = JSON.parse(
		readFileSync(manifestPath, 'utf-8')
	);

	let seeded = 0;
	for (const entry of manifest) {
		const filePath = resolve(THUMB_DIR, entry.file);
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

		const thumbnailData = encodeFeatures(features);

		await db.insert(minimapReferences).values({
			mapId: entry.mapId,
			source: 'static',
			thumbnailData
		});
		seeded++;
	}

	logger.info({ event: 'minimap_seed_complete', count: seeded }, 'Minimap references seeded from manifest');
	return seeded;
}

/**
 * Load reference thumbnails from the database.
 */
async function loadReferences(): Promise<MinimapReference[]> {
	// Seed if needed (lazy — first time only)
	await seedMinimapReferences();

	const rows = await db.select().from(minimapReferences);

	return rows.map((row) => {
		const features = decodeFeatures(row.thumbnailData);
		const riFeatures = computeRotationInvariantFeatures(features);
		return { mapId: row.mapId, features, riFeatures };
	});
}

async function getReferences(): Promise<MinimapReference[]> {
	if (references) return references;
	if (!refsLoading) {
		refsLoading = loadReferences().then((r) => {
			references = r;
			return r;
		}).catch((err) => {
			// Clear cached promise so next call retries instead of permanently failing
			refsLoading = null;
			throw err;
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
	// Scale crop region proportionally for non-reference resolutions
	const scaleX = rgbImage.width / REFERENCE_WIDTH;
	const scaleY = rgbImage.height / REFERENCE_HEIGHT;
	const cropX = Math.round(CROP_X * scaleX);
	const cropY = Math.round(CROP_Y * scaleY);
	const cropW = Math.round(CROP_W * scaleX);
	const cropH = Math.round(CROP_H * scaleY);

	// Clamp crop to image bounds
	const x1 = Math.min(cropX, rgbImage.width);
	const y1 = Math.min(cropY, rgbImage.height);
	const x2 = Math.min(cropX + cropW, rgbImage.width);
	const y2 = Math.min(cropY + cropH, rgbImage.height);
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
 * minimap_references DB table. This allows the system to improve map detection
 * over time based on user corrections.
 *
 * @param screenshotPath - Absolute path to the screenshot file
 * @param mapId - The correct map ID (from user correction or confirmed scan)
 * @param screenshotHash - Hash used for dedup (must be unique per screenshot)
 */
export async function learnMinimapReference(
	screenshotPath: string,
	mapId: string,
	screenshotHash: string
): Promise<void> {
	// Validate map ID
	if (!MAP_MODES[mapId]) {
		logger.warn({ event: 'minimap_learn_unknown_map', mapId }, 'Unknown map ID, skipping learn');
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
		logger.warn({ event: 'minimap_learn_extract_failed', screenshotHash, error: e instanceof Error ? e.message : String(e) }, 'Could not extract minimap for learning');
		return;
	}

	const thumbnailData = encodeFeatures(thumbFeatures);

	// Upsert: check if this screenshot hash already has a reference
	const [existing] = await db.select()
		.from(minimapReferences)
		.where(eq(minimapReferences.screenshotHash, screenshotHash));

	if (existing) {
		await db.update(minimapReferences)
			.set({ mapId, thumbnailData })
			.where(eq(minimapReferences.id, existing.id));
	} else {
		await db.insert(minimapReferences).values({
			mapId,
			source: 'learned',
			screenshotHash,
			thumbnailData
		});
	}

	// Invalidate cache so next scan uses the new reference
	invalidateMinimapCache();

	const totalCount = await db.select({ id: minimapReferences.id }).from(minimapReferences);
	logger.info({ event: 'minimap_learn_success', mapId, screenshotHash, totalRefs: totalCount.length }, 'Minimap reference learned');
}
