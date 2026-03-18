/**
 * Client-side scan types — mirrors the server types without importing them.
 * These are pure interfaces with no I/O dependencies.
 */

export type UISize = 'small' | 'normal' | 'large' | 'larger';
export type GameMode = 'conquest' | 'push';

export interface AnchorResult {
	x: number;
	y: number;
	uiSize: UISize;
	mode: GameMode;
	score: number;
	method: 'x-button' | 'score-text';
}

export interface LayoutPreset {
	redXOffset: number;
	blueXOffset: number;
	yOffset: number;
	rowSpacing: number;
	cropSize: number;
}

export interface CropPosition {
	x: number;
	y: number;
}

export interface IconCrop {
	team: 'red' | 'blue';
	playerIndex: number;
	position: CropPosition;
	pixels: Uint8Array;
	width: number;
	height: number;
}

export interface ClassificationCandidate {
	specId: string;
	professionId: string;
	confidence: number;
}

export interface ClassificationResult {
	specId: string;
	professionId: string;
	confidence: number;
	topCandidates: ClassificationCandidate[];
}

export interface RawImage {
	data: Uint8Array;
	width: number;
	height: number;
	channels: number;
}
