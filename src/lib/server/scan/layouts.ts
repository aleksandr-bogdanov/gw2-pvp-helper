/**
 * Scoreboard layout presets for all 4 UI sizes × 2 game modes.
 *
 * All offsets are relative to the close button (X) anchor point.
 * Calibrated for 3440×1440 resolution from 23 test screenshots.
 * See ../gw2-research/docs/scoreboard-detection.md for derivation.
 *
 * Conquest: all 4 sizes calibrated precisely from reference screenshots.
 * Push: Large and Larger calibrated; Small and Normal push offsets estimated
 * by scaling from the conquest↔push difference observed in Large/Larger.
 */

import type { UISize, GameMode, LayoutPreset, CropPosition } from './types.js';

const LAYOUTS: Record<string, LayoutPreset> = {
	'small-conquest': {
		redXOffset: -954,
		blueXOffset: -18,
		yOffset: 160,
		rowSpacing: 36,
		cropSize: 35
	},
	'small-push': {
		redXOffset: -920,
		blueXOffset: -18,
		yOffset: 160,
		rowSpacing: 36,
		cropSize: 35
	},
	'normal-conquest': {
		redXOffset: -1062,
		blueXOffset: -20,
		yOffset: 176,
		rowSpacing: 40,
		cropSize: 38
	},
	'normal-push': {
		redXOffset: -1028,
		blueXOffset: -20,
		yOffset: 176,
		rowSpacing: 40,
		cropSize: 38
	},
	'large-conquest': {
		redXOffset: -1181,
		blueXOffset: -24,
		yOffset: 195,
		rowSpacing: 45,
		cropSize: 40
	},
	'large-push': {
		redXOffset: -1145,
		blueXOffset: -24,
		yOffset: 195,
		rowSpacing: 45,
		cropSize: 40
	},
	'larger-conquest': {
		redXOffset: -1297,
		blueXOffset: -26,
		yOffset: 213,
		rowSpacing: 50,
		cropSize: 45
	},
	'larger-push': {
		redXOffset: -1259,
		blueXOffset: -24,
		yOffset: 214,
		rowSpacing: 50,
		cropSize: 45
	}
};

/**
 * Map from crop_size to UI size. Template matching determines crop_size,
 * which uniquely identifies the UI scale.
 */
export const CROP_SIZE_TO_UI: Record<number, UISize> = {
	35: 'small',
	38: 'normal',
	40: 'large',
	45: 'larger'
};

/**
 * Template sizes (X button width/height in px) per UI size.
 * Used to determine which UI size was matched.
 */
export const TEMPLATE_SIZES: Record<UISize, number> = {
	small: 20,
	normal: 22,
	large: 24,
	larger: 28
};

export function getLayout(uiSize: UISize, mode: GameMode): LayoutPreset {
	const effectiveMode = mode === 'stronghold' ? 'conquest' : mode;
	const key = `${uiSize}-${effectiveMode}`;
	const layout = LAYOUTS[key];
	if (!layout) {
		throw new Error(`Unknown layout: ${key}`);
	}
	return layout;
}

/**
 * Compute all 10 icon crop center positions from anchor + layout.
 */
export function computeIconPositions(
	anchorX: number,
	anchorY: number,
	layout: LayoutPreset
): { red: CropPosition[]; blue: CropPosition[] } {
	const yStart = anchorY + layout.yOffset;

	const red: CropPosition[] = [];
	const blue: CropPosition[] = [];

	for (let i = 0; i < 5; i++) {
		const y = yStart + i * layout.rowSpacing;
		red.push({ x: anchorX + layout.redXOffset, y });
		blue.push({ x: anchorX + layout.blueXOffset, y });
	}

	return { red, blue };
}

/**
 * Compute name text regions for OCR.
 * Red team names are to the RIGHT of the icon.
 * Blue team names are to the LEFT of the icon.
 *
 * Returns { x, y, width, height } for each name region (top-left origin).
 */
export function computeNameRegions(
	anchorX: number,
	anchorY: number,
	layout: LayoutPreset
): {
	red: { x: number; y: number; width: number; height: number }[];
	blue: { x: number; y: number; width: number; height: number }[];
} {
	const yStart = anchorY + layout.yOffset;
	const half = Math.floor(layout.cropSize / 2);
	// Name region width scales with UI size
	const nameWidth = Math.round(layout.cropSize * 6);
	const nameHeight = layout.cropSize;

	const red: { x: number; y: number; width: number; height: number }[] = [];
	const blue: { x: number; y: number; width: number; height: number }[] = [];

	for (let i = 0; i < 5; i++) {
		const y = yStart + i * layout.rowSpacing - half;
		const redIconX = anchorX + layout.redXOffset;
		const blueIconX = anchorX + layout.blueXOffset;

		// Red team: name is to the right of the icon
		red.push({
			x: redIconX + half + 4,
			y,
			width: nameWidth,
			height: nameHeight
		});

		// Blue team: name is to the left of the icon
		blue.push({
			x: blueIconX - half - nameWidth - 4,
			y,
			width: nameWidth,
			height: nameHeight
		});
	}

	return { red, blue };
}

/**
 * Detect game mode from anchor Y position (fallback heuristic).
 *
 * Works for default (not-moved) window positions: push panels are lower on screen.
 * Threshold of 300 cleanly separates all default-position calibrated samples.
 *
 * LIMITATION: Fails for 5/23 test screenshots where conquest windows were dragged
 * below y=300. The real pipeline uses minimap-based map detection (minimap.ts)
 * to override this heuristic.
 */
export function detectMode(anchorY: number): GameMode {
	return anchorY > 300 ? 'push' : 'conquest';
}
