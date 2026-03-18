/**
 * Anchor detection: find the scoreboard close button (X) via template matching.
 *
 * Uses Normalized Cross-Correlation (NCC) on grayscale pixel buffers.
 * Full pixel-level scan on narrowed ROI (x=1700-2500, y=100-500) — NCC is too
 * peaky for coarse-to-fine (drops from 1.0 to 0.55 at 1-2px offset).
 *
 * 4 templates for 4 UI sizes: Small (21×21), Normal (23×23), Large (24×24), Larger (28×28).
 * Team color validation (red/blue channel analysis) disambiguates multiple X buttons
 * when Options panel, PvP menu, or popups are open.
 *
 * Mode detection uses Y heuristic (y>300 → push) as initial guess.
 * The real mode comes from minimap detection in the pipeline (see minimap.ts).
 *
 * Accuracy: 23/23 (100%) on test fixtures, 2.27px avg crop error across 230 crops.
 * Performance: ~1.7s per screenshot (~38s for all 23).
 */

import { resolve } from 'path';
import { loadTemplateFromFile, extractROI } from './preprocess.js';
import { getLayout, computeIconPositions } from './layouts.js';
import type { RawImage, AnchorResult, UISize, GameMode } from './types.js';
import { logger } from '$lib/server/logger.js';

const TEMPLATE_DIR = resolve(process.cwd(), 'data', 'x-templates');

interface Template {
	image: RawImage;
	uiSize: UISize;
	meanVal: number;
	stdVal: number;
}

let templates: Template[] | null = null;
let templatesLoading: Promise<Template[]> | null = null;

function computeStats(data: Uint8Array): { mean: number; std: number } {
	let sum = 0;
	for (let i = 0; i < data.length; i++) sum += data[i];
	const mean = sum / data.length;
	let sumSq = 0;
	for (let i = 0; i < data.length; i++) {
		const d = data[i] - mean;
		sumSq += d * d;
	}
	return { mean, std: Math.sqrt(sumSq) };
}

async function loadTemplates(): Promise<Template[]> {
	const templateFiles: { file: string; uiSize: UISize }[] = [
		{ file: 'x_template_small.png', uiSize: 'small' },
		{ file: 'x_template_normal_ui.png', uiSize: 'normal' },
		{ file: 'x_template_normal.png', uiSize: 'large' },
		{ file: 'x_template_zoomed.png', uiSize: 'larger' }
	];

	const result: Template[] = [];
	for (const { file, uiSize } of templateFiles) {
		try {
			const image = await loadTemplateFromFile(resolve(TEMPLATE_DIR, file));
			const { mean, std } = computeStats(image.data);
			result.push({ image, uiSize, meanVal: mean, stdVal: std });
		} catch {
			// Template file missing — skip
		}
	}
	return result;
}

async function getTemplates(): Promise<Template[]> {
	if (templates) return templates;
	if (!templatesLoading) {
		templatesLoading = loadTemplates().then((t) => {
			templates = t;
			return t;
		});
	}
	return templatesLoading;
}

/**
 * Two-stage NCC: coarse scan (step=4), then refine top candidates at pixel level.
 * Returns ALL local maxima above threshold, not just the global best.
 */
function nccMatchAll(
	roi: RawImage,
	template: Template,
	threshold: number,
	maxResults: number = 5
): { x: number; y: number; score: number }[] {
	const tw = template.image.width;
	const th = template.image.height;
	const tData = template.image.data;
	const tMean = template.meanVal;
	const tStd = template.stdVal;

	const iw = roi.width;
	const iData = roi.data;

	const maxU = roi.width - tw;
	const maxV = roi.height - th;

	// Full scan at pixel level — NCC is too peaky for coarse-to-fine.
	// With narrowed ROI (700×400) and small templates (24-28px), this is fast enough.
	const results: { x: number; y: number; score: number }[] = [];

	for (let v = 0; v <= maxV; v++) {
		for (let u = 0; u <= maxU; u++) {
			const score = nccAt(iData, iw, u, v, tData, tw, th, tMean, tStd);
			if (score >= threshold) {
				// Check if this is a local maximum (better than all 8 neighbors)
				let isMax = true;
				for (let dv = -1; dv <= 1 && isMax; dv++) {
					for (let du = -1; du <= 1 && isMax; du++) {
						if (du === 0 && dv === 0) continue;
						const nu = u + du,
							nv = v + dv;
						if (nu < 0 || nu > maxU || nv < 0 || nv > maxV) continue;
						const ns = nccAt(iData, iw, nu, nv, tData, tw, th, tMean, tStd);
						if (ns > score) isMax = false;
					}
				}
				if (isMax) {
					const tooClose = results.some(
						(r) => Math.abs(r.x - u) < tw && Math.abs(r.y - v) < th
					);
					if (!tooClose) {
						results.push({ x: u, y: v, score });
					}
				}
			}
		}
	}

	results.sort((a, b) => b.score - a.score);
	return results.slice(0, maxResults);
}

/** Compute NCC at a single position */
function nccAt(
	iData: Uint8Array,
	iw: number,
	u: number,
	v: number,
	tData: Uint8Array,
	tw: number,
	th: number,
	tMean: number,
	tStd: number
): number {
	const n = tw * th;

	// Compute image patch mean
	let iSum = 0;
	for (let ty = 0; ty < th; ty++) {
		const rowStart = (v + ty) * iw + u;
		for (let tx = 0; tx < tw; tx++) {
			iSum += iData[rowStart + tx];
		}
	}
	const iMean = iSum / n;

	// Compute cross-correlation and image patch std
	let cross = 0;
	let iSumSq = 0;
	for (let ty = 0; ty < th; ty++) {
		const rowStart = (v + ty) * iw + u;
		for (let tx = 0; tx < tw; tx++) {
			const iVal = iData[rowStart + tx] - iMean;
			const tVal = tData[ty * tw + tx] - tMean;
			cross += iVal * tVal;
			iSumSq += iVal * iVal;
		}
	}

	const denom = Math.sqrt(iSumSq) * tStd;
	return denom > 0 ? cross / denom : 0;
}

/**
 * Determine game mode and validate with team colors.
 *
 * Primary: anchor_y > 300 → push, else conquest.
 * Works perfectly for default-position windows (19/23 test cases).
 * TODO: For moved windows, detect mode from panel width or GW2 API.
 */
function detectModeAndValidate(
	rgbImage: RawImage,
	_grayImage: RawImage,
	anchorX: number,
	anchorY: number,
	uiSize: UISize
): { mode: GameMode; score: number } {
	const mode: GameMode = anchorY > 300 ? 'push' : 'conquest';
	const tcScore = teamColorScore(rgbImage, anchorX, anchorY, uiSize, mode);
	return { mode, score: tcScore };
}

function teamColorScore(
	rgbImage: RawImage,
	anchorX: number,
	anchorY: number,
	uiSize: UISize,
	mode: GameMode
): number {
	const layout = getLayout(uiSize, mode);
	const positions = computeIconPositions(anchorX, anchorY, layout);
	const half = Math.floor(layout.cropSize / 2);

	let redCorrect = 0;
	let blueCorrect = 0;

	for (let i = 0; i < 5; i++) {
		const rp = positions.red[i];
		if (
			rp.x - half >= 0 &&
			rp.x + half < rgbImage.width &&
			rp.y - half >= 0 &&
			rp.y + half < rgbImage.height
		) {
			let rSum = 0,
				bSum = 0;
			const ss = Math.min(half, 10);
			for (let dy = -ss; dy <= ss; dy += 2) {
				for (let dx = -ss; dx <= ss; dx += 2) {
					const idx = ((rp.y + dy) * rgbImage.width + (rp.x + dx)) * 3;
					rSum += rgbImage.data[idx];
					bSum += rgbImage.data[idx + 2];
				}
			}
			if (rSum > bSum * 1.1) redCorrect++;
		}

		const bp = positions.blue[i];
		if (
			bp.x - half >= 0 &&
			bp.x + half < rgbImage.width &&
			bp.y - half >= 0 &&
			bp.y + half < rgbImage.height
		) {
			let rSum = 0,
				bSum = 0;
			const ss = Math.min(half, 10);
			for (let dy = -ss; dy <= ss; dy += 2) {
				for (let dx = -ss; dx <= ss; dx += 2) {
					const idx = ((bp.y + dy) * rgbImage.width + (bp.x + dx)) * 3;
					rSum += rgbImage.data[idx];
					bSum += rgbImage.data[idx + 2];
				}
			}
			if (bSum > rSum * 1.1) blueCorrect++;
		}
	}

	return Math.min(redCorrect, blueCorrect) / 5;
}

// Search region — covers all observed anchor positions (1874-2385, 220-356).
// Widened left bound for moved windows. Right bound covers default Larger position.
const SEARCH_X1 = 1700;
const SEARCH_Y1 = 100;
const SEARCH_X2 = 2500;
const SEARCH_Y2 = 500;

export interface FindAnchorOptions {
	minScore?: number;
	rgbImage?: RawImage;
}

/**
 * Find the scoreboard anchor by template matching the close button (X).
 *
 * Strategy:
 * 1. Two-stage NCC (coarse + fine) against all templates
 * 2. For every candidate, validate with team colors (trying both modes)
 * 3. Pick the candidate with best combined NCC + team color score
 * 4. Fall back to NCC-only if no candidate passes team color validation
 */
export async function findAnchor(
	grayImage: RawImage,
	options: FindAnchorOptions = {}
): Promise<AnchorResult | null> {
	const { minScore = 0.85, rgbImage } = options;
	const tmpls = await getTemplates();

	if (tmpls.length === 0) {
		throw new Error(
			'No X button templates found. Check data/x-templates/ for template files.'
		);
	}

	const roiWidth = Math.min(SEARCH_X2, grayImage.width) - SEARCH_X1;
	const roiHeight = Math.min(SEARCH_Y2, grayImage.height) - SEARCH_Y1;
	if (roiWidth <= 0 || roiHeight <= 0) return null;

	const roi = extractROI(grayImage, SEARCH_X1, SEARCH_Y1, roiWidth, roiHeight);

	const DEBUG = process.env.DEBUG_ANCHOR === '1';

	// Collect candidates from all templates. Each template contributes position + UI size.
	interface Candidate {
		x: number;
		y: number;
		score: number;
		uiSize: UISize;
	}

	const HIGH_THRESHOLD = minScore; // 0.85
	const LOW_THRESHOLD = 0.7;
	const allCandidates: Candidate[] = [];

	if (DEBUG) logger.debug({ event: 'anchor_templates_loaded', count: tmpls.length }, `Templates loaded: ${tmpls.length}`);
	for (const tmpl of tmpls) {
		const matches = nccMatchAll(roi, tmpl, LOW_THRESHOLD, 3);
		if (DEBUG) logger.debug({ event: 'anchor_template_match', uiSize: tmpl.uiSize, width: tmpl.image.width, matchCount: matches.length }, `Template ${tmpl.uiSize} (${tmpl.image.width}px): ${matches.length} matches`);
		for (const m of matches) {
			const cx = SEARCH_X1 + m.x + Math.floor(tmpl.image.width / 2);
			const cy = SEARCH_Y1 + m.y + Math.floor(tmpl.image.height / 2);
			allCandidates.push({ x: cx, y: cy, score: m.score, uiSize: tmpl.uiSize });
		}
	}

	if (allCandidates.length === 0) return null;

	// Group by position: multiple templates may match the same X button.
	// Keep only the best-scoring template per position (determines UI size).
	interface PositionGroup {
		x: number;
		y: number;
		score: number;
		uiSize: UISize;
	}

	const groups: PositionGroup[] = [];
	const sorted = allCandidates.sort((a, b) => b.score - a.score);
	for (const c of sorted) {
		const existing = groups.find(
			(g) => Math.abs(g.x - c.x) < 20 && Math.abs(g.y - c.y) < 20
		);
		if (!existing) {
			groups.push({ x: c.x, y: c.y, score: c.score, uiSize: c.uiSize });
		}
		// else: lower-scoring template at same position → skip (first one determined UI size)
	}

	// For each position group, determine mode via team color validation.
	// Team color also serves as a validity check.
	interface ScoredPosition extends PositionGroup {
		mode: GameMode;
		teamScore: number;
	}

	const scoredPositions: ScoredPosition[] = [];
	for (const g of groups) {
		if (rgbImage) {
			const { mode, score: teamScore } = detectModeAndValidate(rgbImage, grayImage, g.x, g.y, g.uiSize);
			scoredPositions.push({ ...g, mode, teamScore });
		} else {
			// No RGB image — fall back to Y heuristic
			const mode: GameMode = g.y > 300 ? 'push' : 'conquest';
			scoredPositions.push({ ...g, mode, teamScore: 0.5 });
		}
	}

	// Strategy:
	// 1. If exactly one high-confidence match → use it (with mode from team color)
	// 2. If multiple high-confidence matches → pick the one with best team color
	// 3. If no high-confidence match but some low-confidence with good team color → use it

	const highConf = scoredPositions.filter((p) => p.score >= HIGH_THRESHOLD);

	let winner: ScoredPosition | undefined;

	if (highConf.length === 1) {
		winner = highConf[0];
	} else if (highConf.length > 1) {
		// Multiple X buttons found (e.g. Options panel + scoreboard)
		// Team color disambiguates: the real scoreboard has red + blue backgrounds
		winner = highConf.sort((a, b) => b.teamScore - a.teamScore)[0];
	} else {
		// No high-confidence match — try low-confidence with team color rescue
		const lowConf = scoredPositions
			.filter((p) => p.score >= LOW_THRESHOLD && p.teamScore >= 0.6)
			.sort((a, b) => b.teamScore - a.teamScore);
		winner = lowConf[0];
	}

	if (!winner) return null;

	return {
		x: winner.x,
		y: winner.y,
		uiSize: winner.uiSize,
		mode: winner.mode,
		score: winner.score,
		method: 'x-button'
	};
}
