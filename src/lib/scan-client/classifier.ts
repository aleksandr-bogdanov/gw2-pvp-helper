/**
 * Browser-side icon classification using HOG features + cosine distance.
 *
 * Pure TypeScript math — identical to server version.
 * Reference icons loaded via fetch + Canvas instead of fs + Sharp.
 */
import { loadReferenceIcon, resizeGrayscale } from './preprocess.js';
import { getProfessionForSpec } from '$lib/game-data.js';
import type { RawImage, ClassificationResult, ClassificationCandidate } from './types.js';

const TARGET_SIZE = 32;
const ORIENTATIONS = 8;
const CELL_SIZE = 8;
const BLOCK_SIZE = 2;

interface ReferenceIcon {
	specId: string;
	features: Float64Array;
}

let referenceIcons: ReferenceIcon[] | null = null;
let referencesLoading: Promise<ReferenceIcon[]> | null = null;

/** All 45 reference icon filenames (matches data/profession-icons/wiki-big/) */
const ICON_FILES = [
	'amalgam', 'antiquary', 'berserker', 'bladesworn', 'catalyst',
	'chronomancer', 'conduit', 'daredevil', 'deadeye', 'dragonhunter',
	'druid', 'elementalist', 'engineer', 'evoker', 'firebrand',
	'galeshot', 'guardian', 'harbinger', 'herald', 'holosmith',
	'luminary', 'mechanist', 'mesmer', 'mirage', 'necromancer',
	'paragon', 'ranger', 'reaper', 'renegade', 'revenant',
	'ritualist', 'scourge', 'scrapper', 'soulbeast', 'specter',
	'spellbreaker', 'tempest', 'thief', 'troubadour', 'untamed',
	'vindicator', 'virtuoso', 'warrior', 'weaver', 'willbender'
];

/**
 * Extract HOG features from a 32×32 grayscale image.
 * Identical to server version — pure math.
 */
export function extractHOG(data: Uint8Array, width: number, height: number): Float64Array {
	if (width !== TARGET_SIZE || height !== TARGET_SIZE) {
		throw new Error(`Expected ${TARGET_SIZE}×${TARGET_SIZE}, got ${width}×${height}`);
	}

	const cellsX = Math.floor(width / CELL_SIZE);
	const cellsY = Math.floor(height / CELL_SIZE);

	// Step 1: Compute gradients
	const gx = new Float64Array(width * height);
	const gy = new Float64Array(width * height);

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const idx = y * width + x;
			const left = x > 0 ? data[y * width + (x - 1)] : data[idx];
			const right = x < width - 1 ? data[y * width + (x + 1)] : data[idx];
			gx[idx] = right - left;
			const top = y > 0 ? data[(y - 1) * width + x] : data[idx];
			const bottom = y < height - 1 ? data[(y + 1) * width + x] : data[idx];
			gy[idx] = bottom - top;
		}
	}

	// Step 2: Magnitude and orientation
	const magnitude = new Float64Array(width * height);
	const orientation = new Float64Array(width * height);

	for (let i = 0; i < width * height; i++) {
		magnitude[i] = Math.sqrt(gx[i] * gx[i] + gy[i] * gy[i]);
		let angle = Math.atan2(gy[i], gx[i]);
		if (angle < 0) angle += Math.PI;
		if (angle >= Math.PI) angle -= Math.PI;
		orientation[i] = angle;
	}

	// Step 3: Cell histograms with bilinear orientation interpolation
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
	const blocksX = cellsX - BLOCK_SIZE + 1;
	const blocksY = cellsY - BLOCK_SIZE + 1;
	const blockFeatureSize = BLOCK_SIZE * BLOCK_SIZE * ORIENTATIONS;
	const totalFeatures = blocksX * blocksY * blockFeatureSize;
	const features = new Float64Array(totalFeatures);
	const EPS = 1e-5;
	const L2_HYS_CLIP = 0.2;

	let featureIdx = 0;
	for (let by = 0; by < blocksY; by++) {
		for (let bx = 0; bx < blocksX; bx++) {
			const blockStart = featureIdx;
			for (let cy = 0; cy < BLOCK_SIZE; cy++) {
				for (let cx = 0; cx < BLOCK_SIZE; cx++) {
					const histOffset = ((by + cy) * cellsX + (bx + cx)) * ORIENTATIONS;
					for (let o = 0; o < ORIENTATIONS; o++) {
						features[featureIdx++] = cellHist[histOffset + o];
					}
				}
			}

			// L2-Hys
			let norm = 0;
			for (let i = blockStart; i < featureIdx; i++) norm += features[i] * features[i];
			norm = Math.sqrt(norm + EPS);
			for (let i = blockStart; i < featureIdx; i++) features[i] /= norm;
			for (let i = blockStart; i < featureIdx; i++) {
				if (features[i] > L2_HYS_CLIP) features[i] = L2_HYS_CLIP;
			}
			norm = 0;
			for (let i = blockStart; i < featureIdx; i++) norm += features[i] * features[i];
			norm = Math.sqrt(norm + EPS);
			for (let i = blockStart; i < featureIdx; i++) features[i] /= norm;
		}
	}

	return features;
}

function cosineDistance(a: Float64Array, b: Float64Array): number {
	let dot = 0, normA = 0, normB = 0;
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
	const icons: ReferenceIcon[] = [];

	// Load all 45 icons in parallel
	const promises = ICON_FILES.map(async (name) => {
		const url = `/scan-data/icons/${name}.png`;
		const image = await loadReferenceIcon(url, TARGET_SIZE);
		const features = extractHOG(image.data, image.width, image.height);
		return { specId: name, features };
	});

	const results = await Promise.all(promises);
	icons.push(...results);
	return icons;
}

async function getReferences(): Promise<ReferenceIcon[]> {
	if (referenceIcons) return referenceIcons;
	if (!referencesLoading) {
		referencesLoading = loadReferenceIcons().then((icons) => {
			referenceIcons = icons;
			return icons;
		});
	}
	return referencesLoading;
}

/**
 * Classify a single icon crop.
 */
export async function classifyIcon(crop: RawImage): Promise<ClassificationResult> {
	const refs = await getReferences();

	let resized: RawImage;
	if (crop.width === TARGET_SIZE && crop.height === TARGET_SIZE) {
		resized = crop;
	} else {
		resized = resizeGrayscale(crop, TARGET_SIZE, TARGET_SIZE);
	}

	const features = extractHOG(resized.data, resized.width, resized.height);

	const BASE_PROFESSIONS = new Set([
		'guardian', 'revenant', 'warrior', 'engineer', 'ranger',
		'thief', 'elementalist', 'mesmer', 'necromancer'
	]);

	const scored: { specId: string; distance: number }[] = [];
	for (const ref of refs) {
		scored.push({ specId: ref.specId, distance: cosineDistance(features, ref.features) });
	}
	scored.sort((a, b) => a.distance - b.distance);

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
	await getReferences();
	return Promise.all(crops.map((crop) => classifyIcon(crop)));
}

/**
 * Pre-warm the classifier by loading all reference icons.
 */
export async function warmupClassifier(): Promise<void> {
	await getReferences();
}
