/**
 * Client-side scoreboard layout presets — mirrors server version.
 * Pure data, no I/O. Inlined to avoid importing from $lib/server/.
 */
import type { UISize, GameMode, LayoutPreset, CropPosition } from './types.js';

const LAYOUTS: Record<string, LayoutPreset> = {
	'small-conquest': { redXOffset: -954, blueXOffset: -18, yOffset: 160, rowSpacing: 36, cropSize: 35 },
	'small-push': { redXOffset: -920, blueXOffset: -18, yOffset: 160, rowSpacing: 36, cropSize: 35 },
	'normal-conquest': { redXOffset: -1062, blueXOffset: -20, yOffset: 176, rowSpacing: 40, cropSize: 38 },
	'normal-push': { redXOffset: -1028, blueXOffset: -20, yOffset: 176, rowSpacing: 40, cropSize: 38 },
	'large-conquest': { redXOffset: -1181, blueXOffset: -24, yOffset: 195, rowSpacing: 45, cropSize: 40 },
	'large-push': { redXOffset: -1145, blueXOffset: -24, yOffset: 195, rowSpacing: 45, cropSize: 40 },
	'larger-conquest': { redXOffset: -1297, blueXOffset: -26, yOffset: 213, rowSpacing: 50, cropSize: 45 },
	'larger-push': { redXOffset: -1259, blueXOffset: -24, yOffset: 214, rowSpacing: 50, cropSize: 45 }
};

export const CROP_SIZE_TO_UI: Record<number, UISize> = {
	35: 'small', 38: 'normal', 40: 'large', 45: 'larger'
};

export const TEMPLATE_SIZES: Record<UISize, number> = {
	small: 20, normal: 22, large: 24, larger: 28
};

export function getLayout(uiSize: UISize, mode: GameMode): LayoutPreset {
	const effectiveMode = mode === 'stronghold' ? 'conquest' : mode;
	const key = `${uiSize}-${effectiveMode}`;
	const layout = LAYOUTS[key];
	if (!layout) throw new Error(`Unknown layout: ${key}`);
	return layout;
}

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
	const nameWidth = Math.round(layout.cropSize * 6);
	const nameHeight = layout.cropSize;

	const red: { x: number; y: number; width: number; height: number }[] = [];
	const blue: { x: number; y: number; width: number; height: number }[] = [];

	for (let i = 0; i < 5; i++) {
		const y = yStart + i * layout.rowSpacing - half;
		const redIconX = anchorX + layout.redXOffset;
		const blueIconX = anchorX + layout.blueXOffset;

		red.push({ x: redIconX + half + 4, y, width: nameWidth, height: nameHeight });
		blue.push({ x: blueIconX - half - nameWidth - 4, y, width: nameWidth, height: nameHeight });
	}

	return { red, blue };
}

export function detectMode(anchorY: number): GameMode {
	return anchorY > 300 ? 'push' : 'conquest';
}
