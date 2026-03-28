/**
 * Browser-side minimap map detection using cosine similarity.
 *
 * Pure math — identical to server version.
 * References loaded via fetch from static manifest instead of DB + Sharp.
 */
import type { RawImage, GameMode } from './types.js';

const CROP_X = 3100;
const CROP_Y = 1100;
const CROP_W = 300;
const CROP_H = 300;
const THUMB_SIZE = 16;

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

const HIST_BINS = 8;
const HIST_SIZE = HIST_BINS * HIST_BINS * HIST_BINS;
const RADIAL_RINGS = 6;
const RADIAL_SIZE = RADIAL_RINGS * 3;

interface MinimapReference {
	mapId: string;
	features: Float64Array;
	riFeatures: Float64Array;
}

export interface MapDetectionResult {
	mapId: string;
	mode: GameMode;
	confidence: number;
}

let references: MinimapReference[] | null = null;
let refsLoading: Promise<MinimapReference[]> | null = null;

function cosineSimilarity(a: Float64Array, b: Float64Array): number {
	let dot = 0, normA = 0, normB = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}
	const denom = Math.sqrt(normA) * Math.sqrt(normB);
	return denom > 0 ? dot / denom : 0;
}

function computeRotationInvariantFeatures(spatial: Float64Array): Float64Array {
	const size = THUMB_SIZE;
	const totalPixels = size * size;

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
	for (let i = 0; i < HIST_SIZE; i++) hist[i] /= totalPixels;

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
	for (let ring = 0; ring < RADIAL_RINGS; ring++) {
		if (radialCounts[ring] > 0) {
			radial[ring * 3] /= radialCounts[ring];
			radial[ring * 3 + 1] /= radialCounts[ring];
			radial[ring * 3 + 2] /= radialCounts[ring];
		}
	}

	const combined = new Float64Array(HIST_SIZE + RADIAL_SIZE);
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
 * Extract minimap thumbnail from RGB image using Canvas.
 */
function extractMinimapThumb(rgbImage: RawImage): Float64Array {
	const x1 = Math.min(CROP_X, rgbImage.width);
	const y1 = Math.min(CROP_Y, rgbImage.height);
	const x2 = Math.min(CROP_X + CROP_W, rgbImage.width);
	const y2 = Math.min(CROP_Y + CROP_H, rgbImage.height);
	const w = x2 - x1;
	const h = y2 - y1;

	if (w < 50 || h < 50) {
		throw new Error(`Minimap region too small (${w}×${h}). Expected 3440×1440 screenshot.`);
	}

	// Extract ROI
	const roiCanvas = new OffscreenCanvas(w, h);
	const roiCtx = roiCanvas.getContext('2d', { willReadFrequently: true })!;
	const roiData = roiCtx.createImageData(w, h);

	for (let row = 0; row < h; row++) {
		for (let col = 0; col < w; col++) {
			const srcIdx = ((y1 + row) * rgbImage.width + (x1 + col)) * 3;
			const dstIdx = (row * w + col) * 4;
			roiData.data[dstIdx] = rgbImage.data[srcIdx];
			roiData.data[dstIdx + 1] = rgbImage.data[srcIdx + 1];
			roiData.data[dstIdx + 2] = rgbImage.data[srcIdx + 2];
			roiData.data[dstIdx + 3] = 255;
		}
	}
	roiCtx.putImageData(roiData, 0, 0);

	// Resize to thumbnail using highest quality resampling (bicubic or better)
	const thumbCanvas = new OffscreenCanvas(THUMB_SIZE, THUMB_SIZE);
	const thumbCtx = thumbCanvas.getContext('2d', { willReadFrequently: true })!;
	thumbCtx.imageSmoothingEnabled = true;
	thumbCtx.imageSmoothingQuality = 'high';
	thumbCtx.drawImage(roiCanvas, 0, 0, THUMB_SIZE, THUMB_SIZE);
	const thumbData = thumbCtx.getImageData(0, 0, THUMB_SIZE, THUMB_SIZE);

	const features = new Float64Array(THUMB_SIZE * THUMB_SIZE * 3);
	for (let i = 0; i < THUMB_SIZE * THUMB_SIZE; i++) {
		features[i * 3] = thumbData.data[i * 4] / 255.0;
		features[i * 3 + 1] = thumbData.data[i * 4 + 1] / 255.0;
		features[i * 3 + 2] = thumbData.data[i * 4 + 2] / 255.0;
	}

	return features;
}

/**
 * Load reference thumbnails from static manifest via fetch.
 */
async function loadReferences(): Promise<MinimapReference[]> {
	const manifestRes = await fetch('/scan-data/minimap-thumbs/manifest.json');
	const manifest: { mapId: string; file: string }[] = await manifestRes.json();

	const refs: MinimapReference[] = [];

	for (const entry of manifest) {
		try {
			const imgRes = await fetch(`/scan-data/minimap-thumbs/${entry.file}`);
			const blob = await imgRes.blob();
			const bitmap = await createImageBitmap(blob);

			const canvas = new OffscreenCanvas(THUMB_SIZE, THUMB_SIZE);
			const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
			ctx.drawImage(bitmap, 0, 0, THUMB_SIZE, THUMB_SIZE);
			const data = ctx.getImageData(0, 0, THUMB_SIZE, THUMB_SIZE);

			const features = new Float64Array(THUMB_SIZE * THUMB_SIZE * 3);
			for (let i = 0; i < THUMB_SIZE * THUMB_SIZE; i++) {
				features[i * 3] = data.data[i * 4] / 255.0;
				features[i * 3 + 1] = data.data[i * 4 + 1] / 255.0;
				features[i * 3 + 2] = data.data[i * 4 + 2] / 255.0;
			}

			const riFeatures = computeRotationInvariantFeatures(features);
			refs.push({ mapId: entry.mapId, features, riFeatures });
			bitmap.close();
		} catch {
			// Skip missing files
		}
	}

	return refs;
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
 * Detect which PvP map is shown in the minimap.
 */
export async function detectMap(
	_grayImage: RawImage,
	rgbImage?: RawImage
): Promise<MapDetectionResult | null> {
	if (!rgbImage || rgbImage.channels !== 3) return null;

	const refs = await getReferences();
	if (refs.length === 0) return null;

	let thumbFeatures: Float64Array;
	try {
		thumbFeatures = extractMinimapThumb(rgbImage);
	} catch {
		return null;
	}

	const queryRI = computeRotationInvariantFeatures(thumbFeatures);

	const allScores = refs.map((ref) => ({
		mapId: ref.mapId,
		spatialScore: cosineSimilarity(thumbFeatures, ref.features),
		riScore: cosineSimilarity(queryRI, ref.riFeatures)
	}));

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

	const mapIds = [...new Set(allScores.map(s => s.mapId))];

	const spatialRanked = mapIds
		.map(mapId => ({ mapId, score: spatialScores[mapId] }))
		.sort((a, b) => b.score - a.score);
	const riRanked = mapIds
		.map(mapId => ({ mapId, score: riScores[mapId] }))
		.sort((a, b) => b.score - a.score);

	if (spatialRanked.length === 0) return null;

	const spatialGap = spatialRanked.length > 1
		? spatialRanked[0].score - spatialRanked[1].score
		: spatialRanked[0].score;
	const riGap = riRanked.length > 1
		? riRanked[0].score - riRanked[1].score
		: riRanked[0].score;

	let best: { mapId: string; score: number };
	let gap: number;

	if (spatialGap >= 0.03) {
		best = spatialRanked[0];
		gap = spatialGap;
	} else if (riGap > spatialGap) {
		best = riRanked[0];
		gap = riGap;
	} else {
		best = spatialRanked[0];
		gap = spatialGap;
	}

	const confidence = Math.min(gap / 0.15, 1.0);
	const mode = MAP_MODES[best.mapId] || 'conquest';

	return { mapId: best.mapId, mode, confidence };
}

/**
 * Pre-warm minimap detector by loading references.
 */
export async function warmupMinimap(): Promise<void> {
	await getReferences();
}
