/**
 * Icon classification using HOG (Histogram of Oriented Gradients) features
 * with cosine distance against reference icons.
 *
 * Port of the Python approach2_features.py classifier.
 * TypeScript accuracy: 97.5% (39/40 on 4 labeled fixtures).
 * Single error: mirage→reaper on one low-confidence crop.
 *
 * HOG parameters (matching skimage.hog defaults used in Python):
 * - orientations: 8
 * - pixels_per_cell: 8×8
 * - cells_per_block: 2×2
 * - block_norm: L2-Hys
 * - Target image size: 32×32
 *
 * For a 32×32 image:
 * - 4×4 cells (32/8 = 4 per dimension)
 * - 3×3 blocks (4-2+1 = 3 per dimension)
 * - Each block: 2×2 cells × 8 bins = 32 features
 * - Total: 9 blocks × 32 = 288 features
 */

import { resolve } from 'path';
import { readdirSync } from 'fs';
import { loadReferenceIcon, resizeGrayscale } from './preprocess.js';
import { getProfessionForSpec } from '$lib/game-data.js';
import type { RawImage, ClassificationResult, ClassificationCandidate } from './types.js';

const WIKI_ICONS_DIR = resolve(process.cwd(), 'data', 'profession-icons', 'wiki-big');

const TARGET_SIZE = 32;
const ORIENTATIONS = 8;
const CELL_SIZE = 8;
const BLOCK_SIZE = 2; // in cells

// Precomputed reference features
interface ReferenceIcon {
	specId: string;
	features: Float64Array;
}

let referenceIcons: ReferenceIcon[] | null = null;
let referencesLoading: Promise<ReferenceIcon[]> | null = null;

/**
 * Extract HOG features from a 32×32 grayscale image.
 *
 * Implementation follows skimage.hog with unsigned gradients.
 */
export function extractHOG(data: Uint8Array, width: number, height: number): Float64Array {
	if (width !== TARGET_SIZE || height !== TARGET_SIZE) {
		throw new Error(`Expected ${TARGET_SIZE}×${TARGET_SIZE}, got ${width}×${height}`);
	}

	const cellsX = Math.floor(width / CELL_SIZE); // 4
	const cellsY = Math.floor(height / CELL_SIZE); // 4

	// Step 1: Compute gradients using [-1, 0, 1] kernel (central differences)
	const gx = new Float64Array(width * height);
	const gy = new Float64Array(width * height);

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const idx = y * width + x;
			// Horizontal gradient
			const left = x > 0 ? data[y * width + (x - 1)] : data[idx];
			const right = x < width - 1 ? data[y * width + (x + 1)] : data[idx];
			gx[idx] = right - left;
			// Vertical gradient
			const top = y > 0 ? data[(y - 1) * width + x] : data[idx];
			const bottom = y < height - 1 ? data[(y + 1) * width + x] : data[idx];
			gy[idx] = bottom - top;
		}
	}

	// Step 2: Compute magnitude and orientation per pixel
	const magnitude = new Float64Array(width * height);
	const orientation = new Float64Array(width * height);

	for (let i = 0; i < width * height; i++) {
		magnitude[i] = Math.sqrt(gx[i] * gx[i] + gy[i] * gy[i]);
		// Unsigned orientation [0, π)
		let angle = Math.atan2(gy[i], gx[i]);
		if (angle < 0) angle += Math.PI;
		if (angle >= Math.PI) angle -= Math.PI;
		orientation[i] = angle;
	}

	// Step 3: Compute cell histograms with bilinear orientation interpolation
	const cellHist = new Float64Array(cellsY * cellsX * ORIENTATIONS);
	const binWidth = Math.PI / ORIENTATIONS;

	for (let cy = 0; cy < cellsY; cy++) {
		for (let cx = 0; cx < cellsX; cx++) {
			const histOffset = (cy * cellsX + cx) * ORIENTATIONS;
			for (let py = 0; py < CELL_SIZE; py++) {
				for (let px = 0; px < CELL_SIZE; px++) {
					const imgY = cy * CELL_SIZE + py;
					const imgX = cx * CELL_SIZE + px;
					const idx = imgY * width + imgX;

					const mag = magnitude[idx];
					const ori = orientation[idx];

					// Bilinear interpolation between adjacent bins
					const binFloat = ori / binWidth;
					const bin0 = Math.floor(binFloat) % ORIENTATIONS;
					const bin1 = (bin0 + 1) % ORIENTATIONS;
					const frac = binFloat - Math.floor(binFloat);

					cellHist[histOffset + bin0] += mag * (1 - frac);
					cellHist[histOffset + bin1] += mag * frac;
				}
			}
		}
	}

	// Step 4: Block normalization (L2-Hys)
	const blocksX = cellsX - BLOCK_SIZE + 1; // 3
	const blocksY = cellsY - BLOCK_SIZE + 1; // 3
	const blockFeatureSize = BLOCK_SIZE * BLOCK_SIZE * ORIENTATIONS; // 32
	const totalFeatures = blocksX * blocksY * blockFeatureSize; // 288
	const features = new Float64Array(totalFeatures);
	const EPS = 1e-5;
	const L2_HYS_CLIP = 0.2;

	let featureIdx = 0;
	for (let by = 0; by < blocksY; by++) {
		for (let bx = 0; bx < blocksX; bx++) {
			// Collect unnormalized block features
			const blockStart = featureIdx;
			for (let cy = 0; cy < BLOCK_SIZE; cy++) {
				for (let cx = 0; cx < BLOCK_SIZE; cx++) {
					const histOffset = ((by + cy) * cellsX + (bx + cx)) * ORIENTATIONS;
					for (let o = 0; o < ORIENTATIONS; o++) {
						features[featureIdx++] = cellHist[histOffset + o];
					}
				}
			}

			// L2-Hys normalization
			// First pass: L2 normalize
			let norm = 0;
			for (let i = blockStart; i < featureIdx; i++) {
				norm += features[i] * features[i];
			}
			norm = Math.sqrt(norm + EPS);
			for (let i = blockStart; i < featureIdx; i++) {
				features[i] /= norm;
			}

			// Clip
			for (let i = blockStart; i < featureIdx; i++) {
				if (features[i] > L2_HYS_CLIP) features[i] = L2_HYS_CLIP;
			}

			// Re-normalize after clipping
			norm = 0;
			for (let i = blockStart; i < featureIdx; i++) {
				norm += features[i] * features[i];
			}
			norm = Math.sqrt(norm + EPS);
			for (let i = blockStart; i < featureIdx; i++) {
				features[i] /= norm;
			}
		}
	}

	return features;
}

/**
 * Cosine distance between two feature vectors.
 * Returns 0 for identical vectors, 2 for opposite vectors.
 */
function cosineDistance(a: Float64Array, b: Float64Array): number {
	let dot = 0,
		normA = 0,
		normB = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}
	const denom = Math.sqrt(normA) * Math.sqrt(normB);
	if (denom === 0) return 1;
	return 1 - dot / denom;
}

async function loadReferenceIcons(): Promise<ReferenceIcon[]> {
	const files = readdirSync(WIKI_ICONS_DIR).filter((f) => f.endsWith('.png'));
	const icons: ReferenceIcon[] = [];

	for (const file of files) {
		const specId = file.replace('.png', '').toLowerCase();
		const image = await loadReferenceIcon(resolve(WIKI_ICONS_DIR, file), TARGET_SIZE);
		const features = extractHOG(image.data, image.width, image.height);
		icons.push({ specId, features });
	}

	return icons;
}

async function getReferences(): Promise<ReferenceIcon[]> {
	if (referenceIcons) return referenceIcons;
	if (!referencesLoading) {
		referencesLoading = loadReferenceIcons().then((icons) => {
			referenceIcons = icons;
			return icons;
		}).catch((err) => {
			// Clear cached promise so next call retries instead of permanently failing
			referencesLoading = null;
			throw err;
		});
	}
	return referencesLoading;
}

/**
 * Classify a single icon crop.
 * Input: raw grayscale crop (any size, will be resized to 32×32).
 */
export async function classifyIcon(crop: RawImage): Promise<ClassificationResult> {
	const refs = await getReferences();

	// Resize to target
	let resized: RawImage;
	if (crop.width === TARGET_SIZE && crop.height === TARGET_SIZE) {
		resized = crop;
	} else {
		resized = await resizeGrayscale(crop, TARGET_SIZE, TARGET_SIZE);
	}

	const features = extractHOG(resized.data, resized.width, resized.height);

	// Base profession icons (warrior.png, thief.png, etc.) mean "core" spec
	const BASE_PROFESSIONS = new Set([
		'guardian', 'revenant', 'warrior', 'engineer', 'ranger',
		'thief', 'elementalist', 'mesmer', 'necromancer'
	]);

	// Compute distances for all references
	const scored: { specId: string; distance: number }[] = [];
	for (const ref of refs) {
		scored.push({ specId: ref.specId, distance: cosineDistance(features, ref.features) });
	}
	scored.sort((a, b) => a.distance - b.distance);

	// Build top N candidates (deduplicate by resolved specId)
	const TOP_N = 3;
	const topCandidates: ClassificationCandidate[] = [];
	const seen = new Set<string>();
	for (const s of scored) {
		const isBase = BASE_PROFESSIONS.has(s.specId);
		const resolvedSpec = isBase ? 'core' : s.specId;
		const resolvedProf = isBase ? s.specId : (getProfessionForSpec(s.specId) || s.specId);
		const key = `${resolvedProf}:${resolvedSpec}`;
		if (seen.has(key)) continue;
		seen.add(key);
		topCandidates.push({
			specId: resolvedSpec,
			professionId: resolvedProf,
			confidence: 1 - s.distance
		});
		if (topCandidates.length >= TOP_N) break;
	}

	const best = topCandidates[0];
	return {
		specId: best.specId,
		professionId: best.professionId,
		confidence: best.confidence,
		topCandidates
	};
}

/**
 * Classify multiple icon crops in parallel.
 */
export async function classifyIcons(crops: RawImage[]): Promise<ClassificationResult[]> {
	// Ensure references are loaded before parallel classification
	await getReferences();
	return Promise.all(crops.map((crop) => classifyIcon(crop)));
}

/**
 * Pre-warm the classifier by loading all reference icons.
 * Call this at server startup to avoid cold start on first scan.
 */
export async function warmupClassifier(): Promise<void> {
	await getReferences();
}
