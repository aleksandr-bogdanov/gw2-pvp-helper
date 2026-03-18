/**
 * Client-side CV scan pipeline: screenshot blob → ScanResult
 *
 * Browser-compatible version of the server pipeline.
 * Uses Canvas API instead of Sharp, tesseract-wasm/Tesseract.js instead of server Tesseract.
 * All math (HOG, NCC, cosine) is identical to the server version.
 */

import type { ScanResult, PlayerInfo } from '$lib/types.js';
import { getDefaultRole, getProfessionForSpec } from '$lib/game-data.js';
import {
	loadImageFromBlob,
	imageToGrayscale,
	imageToRGB,
	extractROI,
	rawImageToBase64PNGAsync
} from './preprocess.js';
import { findAnchor } from './anchor.js';
import { getLayout, computeIconPositions, computeNameRegions } from './layouts.js';
import { classifyIcons } from './classifier.js';
import { recognizeNames } from './ocr.js';
import { detectMap } from './minimap.js';
import type { RawImage } from './types.js';

export type { OCRProgressCallback } from './ocr.js';
export { setOCRProgressCallback } from './ocr.js';

/** Progress callback for scan steps */
export type ScanProgressCallback = (step: number, message: string) => void;

/**
 * Main client-side scan entry point.
 *
 * Takes an image Blob (from clipboard or file input) and returns ScanResult.
 * Runs entirely in the browser — no server call needed for the scan itself.
 */
export async function scanScreenshotClient(
	imageBlob: Blob,
	onProgress?: ScanProgressCallback
): Promise<ScanResult> {
	// 1. Load image
	onProgress?.(0, 'Loading image...');
	const bitmap = await loadImageFromBlob(imageBlob);
	const grayImage = imageToGrayscale(bitmap);
	const rgbImage = imageToRGB(bitmap);
	bitmap.close();

	// 2. Find anchor (X button)
	onProgress?.(1, 'Finding scoreboard...');
	const anchor = await findAnchor(grayImage, { rgbImage });
	if (!anchor) {
		throw new Error(
			'Could not locate the scoreboard. Make sure the PvP scoreboard panel is open and visible.'
		);
	}

	// 3. Detect map from minimap
	onProgress?.(2, 'Detecting map...');
	const mapResult = await detectMap(grayImage, rgbImage);

	// 4. Get layout
	let mode = anchor.mode;
	let layout = getLayout(anchor.uiSize, mode);

	if (mapResult && mapResult.confidence > 0.2) {
		if (mapResult.mode !== mode) {
			mode = mapResult.mode;
			layout = getLayout(anchor.uiSize, mode);
		}
	}

	const iconPositions = computeIconPositions(anchor.x, anchor.y, layout);
	const nameRegions = computeNameRegions(anchor.x, anchor.y, layout);

	// 5. Extract icon crops
	onProgress?.(3, 'Classifying specs...');
	const half = Math.floor(layout.cropSize / 2);
	const allIconCrops: RawImage[] = [];
	const cropOrder: { team: 'red' | 'blue'; index: number }[] = [];

	for (let i = 0; i < 5; i++) {
		const pos = iconPositions.red[i];
		allIconCrops.push(extractROI(grayImage, pos.x - half, pos.y - half, layout.cropSize, layout.cropSize));
		cropOrder.push({ team: 'red', index: i });
	}
	for (let i = 0; i < 5; i++) {
		const pos = iconPositions.blue[i];
		allIconCrops.push(extractROI(grayImage, pos.x - half, pos.y - half, layout.cropSize, layout.cropSize));
		cropOrder.push({ team: 'blue', index: i });
	}

	// 6. Extract name crops
	const allNameCrops: RawImage[] = [];
	for (let i = 0; i < 5; i++) {
		const region = nameRegions.red[i];
		allNameCrops.push(extractROI(grayImage, region.x, region.y, region.width, region.height));
	}
	for (let i = 0; i < 5; i++) {
		const region = nameRegions.blue[i];
		allNameCrops.push(extractROI(grayImage, region.x, region.y, region.width, region.height));
	}

	// 7. Classify icons + OCR names in parallel
	onProgress?.(4, 'Reading names...');
	const [classifications, names, iconCropBase64s] = await Promise.all([
		classifyIcons(allIconCrops),
		recognizeNames(allNameCrops),
		Promise.all(allIconCrops.map((crop) => rawImageToBase64PNGAsync(crop)))
	]);

	// 8. Assemble result
	const redTeam: PlayerInfo[] = [];
	const blueTeam: PlayerInfo[] = [];

	for (let i = 0; i < 10; i++) {
		const { team } = cropOrder[i];
		const cls = classifications[i];
		const ocr = names[i];

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
		user_team_color: 'red',
		red_team: redTeam,
		blue_team: blueTeam,
		detected_map: mapResult
			? { mapId: mapResult.mapId, mode: mapResult.mode, confidence: mapResult.confidence }
			: undefined
	};
}

/**
 * Check if any scan slot has low confidence (for training data upload decision).
 */
export function hasLowConfidence(result: ScanResult): boolean {
	const allPlayers = [...result.red_team, ...result.blue_team];
	return allPlayers.some(
		(p) => (p.spec_confidence ?? 0) < 0.85 || (p.name_confidence ?? 0) < 50
	);
}

/**
 * Convert a Blob to JPEG Q85 for upload.
 */
export async function blobToJpegBase64(blob: Blob, quality: number = 0.85): Promise<string> {
	const bitmap = await createImageBitmap(blob);
	const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
	const ctx = canvas.getContext('2d')!;
	ctx.drawImage(bitmap, 0, 0);
	bitmap.close();

	const jpegBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
	const buffer = await jpegBlob.arrayBuffer();
	const bytes = new Uint8Array(buffer);
	let binary = '';
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}
