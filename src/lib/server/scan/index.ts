/**
 * Local CV scan pipeline: screenshot → ScanResult
 *
 * Replaces the LLM-based scanner with pure local computer vision:
 * 1. NCC template matching to find anchor (X close button) → anchor (x,y) + UI size
 * 2. Minimap thumbnail matching → map ID + game mode (overrides Y heuristic)
 * 3. Layout preset lookup → 10 icon positions + 10 name regions
 * 4. HOG k-NN classification for spec icons (97.5% accuracy)
 * 5. Tesseract.js OCR for player names (~80% accuracy, app has manual correction)
 *
 * Performance: ~3-4s per screenshot (dominated by OCR).
 * Accuracy: 23/23 anchor detection, 39/40 spec classification, 23/23 map detection.
 */

import type { ScanResult, PlayerInfo } from '$lib/types.js';
import { getDefaultRole, getProfessionForSpec } from '$lib/game-data.js';
import { loadImageGrayscale, loadImageRGB, extractROI, rawImageToBase64PNG } from './preprocess.js';
import { findAnchor } from './anchor.js';
import { getLayout, computeIconPositions, computeNameRegions } from './layouts.js';
import { classifyIcons } from './classifier.js';
import { recognizeNames } from './ocr.js';
import { detectMap } from './minimap.js';
import type { RawImage } from './types.js';

/**
 * Main scan entry point — drop-in replacement for the old LLM-based scanScreenshot.
 *
 * Takes a base64 image and returns the same ScanResult interface.
 */
export async function scanScreenshot(imageBase64: string, _mediaType: string): Promise<ScanResult> {
	const imageBuffer = Buffer.from(imageBase64, 'base64');

	// Load image in both grayscale (for template matching + HOG) and RGB (for team color validation)
	const [grayImage, rgbImage] = await Promise.all([
		loadImageGrayscale(imageBuffer),
		loadImageRGB(imageBuffer)
	]);

	// 1. Find anchor (X button)
	const anchor = await findAnchor(grayImage, { rgbImage });
	if (!anchor) {
		throw new Error(
			'Could not locate the scoreboard. Make sure the PvP scoreboard panel is open and visible.'
		);
	}

	// 2. Detect map from minimap (runs in parallel with crop extraction)
	const mapPromise = detectMap(grayImage, rgbImage);

	// 3. Get layout using anchor's initial mode guess (Y heuristic)
	// We'll re-layout with minimap mode if it differs
	let mode = anchor.mode;
	let layout = getLayout(anchor.uiSize, mode);

	// Check if minimap gives us a better mode
	const mapResult = await mapPromise;
	if (mapResult && mapResult.confidence > 0.2) {
		if (mapResult.mode !== mode) {
			mode = mapResult.mode;
			layout = getLayout(anchor.uiSize, mode);
		}
	}

	const iconPositions = computeIconPositions(anchor.x, anchor.y, layout);
	const nameRegions = computeNameRegions(anchor.x, anchor.y, layout);

	// 4. Extract icon crops
	const half = Math.floor(layout.cropSize / 2);
	const allIconCrops: RawImage[] = [];
	const cropOrder: { team: 'red' | 'blue'; index: number }[] = [];

	for (let i = 0; i < 5; i++) {
		const pos = iconPositions.red[i];
		const crop = extractROI(grayImage, pos.x - half, pos.y - half, layout.cropSize, layout.cropSize);
		allIconCrops.push(crop);
		cropOrder.push({ team: 'red', index: i });
	}
	for (let i = 0; i < 5; i++) {
		const pos = iconPositions.blue[i];
		const crop = extractROI(grayImage, pos.x - half, pos.y - half, layout.cropSize, layout.cropSize);
		allIconCrops.push(crop);
		cropOrder.push({ team: 'blue', index: i });
	}

	// 5. Extract name crops
	const allNameCrops: RawImage[] = [];
	for (let i = 0; i < 5; i++) {
		const region = nameRegions.red[i];
		allNameCrops.push(extractROI(grayImage, region.x, region.y, region.width, region.height));
	}
	for (let i = 0; i < 5; i++) {
		const region = nameRegions.blue[i];
		allNameCrops.push(extractROI(grayImage, region.x, region.y, region.width, region.height));
	}

	// 6. Classify icons, OCR names, and encode icon crops in parallel
	const [classifications, names, iconCropBase64s] = await Promise.all([
		classifyIcons(allIconCrops),
		recognizeNames(allNameCrops),
		Promise.all(allIconCrops.map((crop) => rawImageToBase64PNG(crop)))
	]);

	// 7. Assemble result
	const redTeam: PlayerInfo[] = [];
	const blueTeam: PlayerInfo[] = [];

	for (let i = 0; i < 10; i++) {
		const { team } = cropOrder[i];
		const cls = classifications[i];
		const ocr = names[i];

		// Derive profession from spec
		const professionId = getProfessionForSpec(cls.specId) || cls.professionId;
		const role = getDefaultRole(professionId, cls.specId);

		const player: PlayerInfo = {
			character_name: ocr.text || `Unknown Player ${i + 1}`,
			profession_id: professionId,
			spec_id: cls.specId,
			role: role,
			is_user: false,
			spec_source: 'detected',
			spec_confidence: cls.confidence,
			name_confidence: ocr.text ? ocr.confidence : 0,
			top_candidates: cls.topCandidates.map((c) => ({
				specId: c.specId,
				professionId: c.professionId,
				confidence: c.confidence
			})),
			icon_crop_base64: iconCropBase64s[i]
		};

		if (team === 'red') {
			redTeam.push(player);
		} else {
			blueTeam.push(player);
		}
	}

	return {
		user_team_color: 'red', // Default — user corrects this in the UI
		red_team: redTeam,
		blue_team: blueTeam,
		detected_map: mapResult
			? { mapId: mapResult.mapId, mode: mapResult.mode, confidence: mapResult.confidence }
			: undefined
	};
}

// Re-export warmup functions for server startup
export { warmupClassifier } from './classifier.js';
export { warmupOCR, terminateOCR } from './ocr.js';
export { warmupMinimap, seedMinimapReferences } from './minimap.js';
