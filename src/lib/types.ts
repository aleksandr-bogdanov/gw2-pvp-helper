/** A single classifier candidate for the quick-review panel */
export interface SpecCandidate {
	specId: string;
	professionId: string;
	confidence: number;
}

export interface PlayerInfo {
	character_name: string;
	profession_id: string;
	spec_id: string;
	role: string;
	is_user: boolean;
	spec_source?: 'detected' | 'corrected' | 'history';
	/** Cosine similarity from HOG classifier (0–1, higher = more confident) */
	spec_confidence?: number;
	/** Tesseract OCR confidence (0–100, higher = more confident) */
	name_confidence?: number;
	/** Top 3 classifier candidates for quick-review UI */
	top_candidates?: SpecCandidate[];
	/** Base64 PNG of the cropped icon from the screenshot (for quick-review UI) */
	icon_crop_base64?: string;
	/** Player memory fields */
	times_seen?: number;
	wins_against?: number;
	losses_against?: number;
	last_seen_at?: string | null;
	avg_skill?: number | null;
	avg_friendly?: number | null;
	tag?: string | null;
}

export interface ScanResult {
	user_team_color: 'red' | 'blue';
	red_team: PlayerInfo[];
	blue_team: PlayerInfo[];
	detected_map?: {
		mapId: string;
		mode: string;
		confidence: number;
	};
	screenshotHash?: string;
	screenshotUrl?: string;
}

export interface SpecInfo {
	id: string;
	label: string;
	roles: string[] | null;
	default_role: string;
}

export interface ProfessionInfo {
	label: string;
	specs: SpecInfo[];
}

export interface GameSpecs {
	professions: Record<string, ProfessionInfo>;
}

export interface WeaponData {
	mainhand: string[];
	offhand: string[];
	twohand: string[];
}

export interface MapInfo {
	id: string;
	name: string;
	mode: string;
	mechanic: string;
	is_default?: boolean;
}

export interface MatchupAssessment {
	threat: 'HUNT' | 'RESPECT' | 'AVOID';
	tip: string;
}

export type ProfileMatchups = Record<string, MatchupAssessment>;
