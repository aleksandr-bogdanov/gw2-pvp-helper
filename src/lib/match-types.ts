export interface MatchPlayer {
	characterName: string;
	team: string;
	profession: string;
	spec: string;
	role: string;
	isUser: boolean;
	ratingSkill: number | null;
	ratingFriendly: number | null;
	tag: string | null;
}

export interface MatchRecord {
	matchId: string;
	userTeamColor: string | null;
	map: string | null;
	result: string | null;
	screenshotHash: string | null;
	screenshotUrl: string | null;
	adviceText: string | null;
	timestamp: string;
	players: MatchPlayer[];
}

export interface ParsedAdvice {
	focusOrder: string;
	babysit: string;
	mapAdvice: string;
	gameplan: string;
	positioning: string;
	enemyAdvice: { threat: string; advice: string; dont_hit?: string }[];
	allyAdvice: { advice?: string }[];
}
