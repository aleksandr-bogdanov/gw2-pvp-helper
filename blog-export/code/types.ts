/**
 * Internal types for the local CV scan pipeline.
 *
 * The pipeline processes 3440×1440 GW2 PvP scoreboard screenshots through:
 * anchor detection → minimap map detection → layout lookup → icon classification → OCR.
 */

/** GW2 UI size setting (Options → Graphics → Interface Size) */
export type UISize = 'small' | 'normal' | 'large' | 'larger';

/** PvP game mode — determines scoreboard layout (different column offsets) */
export type GameMode = 'conquest' | 'push';

/** Result of anchor detection (X close button template matching) */
export interface AnchorResult {
	/** X coordinate of button center in full image */
	x: number;
	/** Y coordinate of button center in full image */
	y: number;
	/** Detected UI size (from which template matched best) */
	uiSize: UISize;
	/** Game mode guess (Y heuristic — may be overridden by minimap detection) */
	mode: GameMode;
	/** NCC template match score (0-1, higher is better, threshold 0.85) */
	score: number;
	/** Detection method used */
	method: 'x-button' | 'score-text';
}

/** Fixed offsets from anchor point for a given UI size + mode combination */
export interface LayoutPreset {
	/** Red team icon X offset from anchor (negative = left of anchor) */
	redXOffset: number;
	/** Blue team icon X offset from anchor (negative = left of anchor) */
	blueXOffset: number;
	/** Y offset from anchor to first player row */
	yOffset: number;
	/** Vertical spacing between player rows in pixels */
	rowSpacing: number;
	/** Icon crop size in pixels (square) */
	cropSize: number;
}

/** A 2D position in the image */
export interface CropPosition {
	x: number;
	y: number;
}

/** An extracted icon crop ready for classification */
export interface IconCrop {
	team: 'red' | 'blue';
	playerIndex: number;
	position: CropPosition;
	pixels: Uint8Array;
	width: number;
	height: number;
}

/** A single candidate from the classifier, ranked by confidence */
export interface ClassificationCandidate {
	/** Elite spec ID (e.g. "daredevil") or "core" for base profession */
	specId: string;
	/** Profession ID (e.g. "thief") */
	professionId: string;
	/** Cosine similarity (0-1, higher is better) */
	confidence: number;
}

/** Result of HOG k-NN icon classification */
export interface ClassificationResult {
	/** Elite spec ID (e.g. "daredevil") or "core" for base profession */
	specId: string;
	/** Profession ID (e.g. "thief") */
	professionId: string;
	/** Cosine similarity to best match (0-1, higher is better) */
	confidence: number;
	/** Top N candidates ranked by confidence (includes the best match) */
	topCandidates: ClassificationCandidate[];
}

/** Raw pixel buffer with metadata — used throughout the pipeline */
export interface RawImage {
	/** Raw pixel data (row-major, interleaved channels) */
	data: Uint8Array;
	width: number;
	height: number;
	/** 1 for grayscale, 3 for RGB */
	channels: number;
}
