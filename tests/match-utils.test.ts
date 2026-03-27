import { describe, it, expect } from 'vitest';
import {
	getSpecIconUrl,
	getMapName,
	getMapMode,
	getThreatColor,
	formatTime,
	getTeams,
	getEnemyAllyTeams,
	parseAdvice,
	flushAdvice,
	buildNameFragments,
	splitSentences,
	highlightNames
} from '../src/lib/match-utils.js';
import type { MatchRecord, MatchPlayer, ParsedAdvice } from '../src/lib/match-types.js';

// --- Helpers ---

function makePlayer(overrides: Partial<MatchPlayer> = {}): MatchPlayer {
	return {
		characterName: 'Test Player',
		team: 'red',
		profession: 'warrior',
		spec: 'berserker',
		role: 'dps',
		isUser: false,
		ratingSkill: null,
		ratingFriendly: null,
		tag: null,
		...overrides
	};
}

function makeMatch(overrides: Partial<MatchRecord> = {}): MatchRecord {
	return {
		matchId: 'test-match-1',
		userTeamColor: 'red',
		map: 'djinns-dominion',
		result: null,
		screenshotHash: null,
		screenshotUrl: null,
		adviceText: null,
		timestamp: new Date().toISOString(),
		players: [],
		...overrides
	};
}

// --- getSpecIconUrl ---

describe('getSpecIconUrl', () => {
	it('returns spec-based URL for non-core specs', () => {
		expect(getSpecIconUrl('berserker', 'warrior')).toBe('/icons/specs/berserker.png');
	});

	it('returns profession-based URL for core specs', () => {
		expect(getSpecIconUrl('core', 'warrior')).toBe('/icons/specs/warrior.png');
	});

	it('returns core URL when professionId is missing', () => {
		expect(getSpecIconUrl('core')).toBe('/icons/specs/core.png');
	});
});

// --- getMapName / getMapMode ---

describe('getMapName', () => {
	it('returns "Unknown" for null', () => {
		expect(getMapName(null)).toBe('Unknown');
	});

	it('returns raw mapId for unknown maps', () => {
		expect(getMapName('nonexistent-map')).toBe('nonexistent-map');
	});
});

describe('getMapMode', () => {
	it('returns null for null mapId', () => {
		expect(getMapMode(null)).toBeNull();
	});

	it('returns null for unknown maps', () => {
		expect(getMapMode('nonexistent-map')).toBeNull();
	});
});

// --- getThreatColor ---

describe('getThreatColor', () => {
	it('returns red color for hunt', () => {
		expect(getThreatColor('hunt')).toContain('red');
	});

	it('returns amber color for respect', () => {
		expect(getThreatColor('respect')).toContain('amber');
	});

	it('returns tertiary color for avoid', () => {
		expect(getThreatColor('avoid')).toContain('tertiary');
	});

	it('returns tertiary color for unknown', () => {
		expect(getThreatColor('unknown')).toContain('tertiary');
	});
});

// --- formatTime ---

describe('formatTime', () => {
	it('formats recent time as minutes ago', () => {
		const fiveMinAgo = new Date(Date.now() - 5 * 60000).toISOString();
		expect(formatTime(fiveMinAgo)).toBe('5m ago');
	});

	it('formats hours ago', () => {
		const threeHoursAgo = new Date(Date.now() - 3 * 3600000).toISOString();
		expect(formatTime(threeHoursAgo)).toBe('3h ago');
	});

	it('formats days ago', () => {
		const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString();
		expect(formatTime(twoDaysAgo)).toBe('2d ago');
	});

	it('formats old dates as month/day', () => {
		const oldDate = new Date(Date.now() - 30 * 86400000).toISOString();
		const result = formatTime(oldDate);
		// Should be something like "Feb 24" format
		expect(result).not.toContain('ago');
	});
});

// --- getTeams / getEnemyAllyTeams ---

describe('getTeams', () => {
	it('splits players by team color', () => {
		const match = makeMatch({
			players: [
				makePlayer({ team: 'red', characterName: 'Red1' }),
				makePlayer({ team: 'blue', characterName: 'Blue1' }),
				makePlayer({ team: 'red', characterName: 'Red2' })
			]
		});
		const { redTeam, blueTeam } = getTeams(match);
		expect(redTeam).toHaveLength(2);
		expect(blueTeam).toHaveLength(1);
	});

	it('handles empty player list', () => {
		const match = makeMatch({ players: [] });
		const { redTeam, blueTeam } = getTeams(match);
		expect(redTeam).toHaveLength(0);
		expect(blueTeam).toHaveLength(0);
	});
});

describe('getEnemyAllyTeams', () => {
	it('uses userTeamColor to determine sides', () => {
		const match = makeMatch({
			userTeamColor: 'blue',
			players: [
				makePlayer({ team: 'red', characterName: 'Enemy1' }),
				makePlayer({ team: 'blue', characterName: 'Ally1' })
			]
		});
		const { myTeam, enemyTeam } = getEnemyAllyTeams(match);
		expect(myTeam[0].characterName).toBe('Ally1');
		expect(enemyTeam[0].characterName).toBe('Enemy1');
	});

	it('defaults to red when userTeamColor is null', () => {
		const match = makeMatch({
			userTeamColor: null,
			players: [
				makePlayer({ team: 'red', characterName: 'MyTeam' }),
				makePlayer({ team: 'blue', characterName: 'Enemy' })
			]
		});
		const { myTeam, enemyTeam } = getEnemyAllyTeams(match);
		expect(myTeam[0].characterName).toBe('MyTeam');
		expect(enemyTeam[0].characterName).toBe('Enemy');
	});
});

// --- buildNameFragments ---

describe('buildNameFragments', () => {
	it('includes full names and word fragments', () => {
		const match = makeMatch({
			players: [makePlayer({ characterName: 'Kors Pahomius' })]
		});
		const frags = buildNameFragments(match);
		expect(frags.has('Kors Pahomius')).toBe(true);
		expect(frags.has('Kors')).toBe(true);
		expect(frags.has('Pahomius')).toBe(true);
	});

	it('skips "Unknown Player" names', () => {
		const match = makeMatch({
			players: [makePlayer({ characterName: 'Unknown Player 1' })]
		});
		const frags = buildNameFragments(match);
		expect(frags.size).toBe(0);
	});

	it('skips short word fragments', () => {
		const match = makeMatch({
			players: [makePlayer({ characterName: 'Al Bo' })]
		});
		const frags = buildNameFragments(match);
		expect(frags.has('Al Bo')).toBe(true);
		expect(frags.has('Al')).toBe(false); // too short (<3)
		expect(frags.has('Bo')).toBe(false); // too short (<3)
	});

	it('handles empty player list', () => {
		const match = makeMatch({ players: [] });
		const frags = buildNameFragments(match);
		expect(frags.size).toBe(0);
	});
});

// --- splitSentences ---

describe('splitSentences', () => {
	it('returns single sentence with bullet', () => {
		expect(splitSentences('Single sentence')).toBe('• Single sentence');
	});

	it('splits multiple sentences into list items', () => {
		const result = splitSentences('First sentence. Second sentence.');
		expect(result).toContain('<li>First sentence.</li>');
		expect(result).toContain('<li>Second sentence.</li>');
	});
});

// --- parseAdvice ---

describe('parseAdvice', () => {
	it('returns null for null adviceText', () => {
		const match = makeMatch({ adviceText: null });
		expect(parseAdvice(match)).toBeNull();
	});

	it('parses focus order section', () => {
		const match = makeMatch({
			userTeamColor: 'red',
			adviceText: '## FOCUS ORDER\nKill the mesmer first, then the necro.',
			players: [
				makePlayer({ team: 'blue', characterName: 'Enemy1' })
			]
		});
		const result = parseAdvice(match);
		expect(result).not.toBeNull();
		expect(result!.focusOrder).toContain('Kill the mesmer');
	});

	it('parses per-enemy section with threat levels', () => {
		const match = makeMatch({
			userTeamColor: 'red',
			adviceText: [
				'## PER-ENEMY BREAKDOWN',
				'1. Enemy One — Reaper — HUNT',
				'Focus this target down quickly.',
				'2. Enemy Two — Firebrand — AVOID',
				'Do not engage alone.'
			].join('\n'),
			players: [
				makePlayer({ team: 'blue', characterName: 'Enemy One' }),
				makePlayer({ team: 'blue', characterName: 'Enemy Two' })
			]
		});
		const result = parseAdvice(match);
		expect(result).not.toBeNull();
		expect(result!.enemyAdvice[0].threat).toBe('hunt');
		expect(result!.enemyAdvice[0].advice).toContain('Focus this target');
		expect(result!.enemyAdvice[1].threat).toBe('avoid');
		expect(result!.enemyAdvice[1].advice).toContain('Do not engage');
	});

	it('parses map strategy section', () => {
		const match = makeMatch({
			userTeamColor: 'red',
			adviceText: '## MAP STRATEGY\nRotate to far point early.',
			players: []
		});
		const result = parseAdvice(match);
		expect(result!.mapAdvice).toContain('Rotate to far');
	});

	it('parses general gameplan section', () => {
		const match = makeMatch({
			userTeamColor: 'red',
			adviceText: '## GENERAL GAMEPLAN\nPlay aggressive early.',
			players: []
		});
		const result = parseAdvice(match);
		expect(result!.gameplan).toContain('Play aggressive');
	});

	it('parses babysit section', () => {
		const match = makeMatch({
			userTeamColor: 'red',
			adviceText: '## WHO TO BABYSIT\nStay near your healer.',
			players: []
		});
		const result = parseAdvice(match);
		expect(result!.babysit).toContain('Stay near your healer');
	});

	it('handles multiple sections in sequence', () => {
		const match = makeMatch({
			userTeamColor: 'red',
			adviceText: [
				'## FOCUS ORDER',
				'Reaper > Firebrand > Thief',
				'## MAP STRATEGY',
				'Contest home, rotate mid.',
				'## GENERAL GAMEPLAN',
				'Win 2v1 rotations.'
			].join('\n'),
			players: []
		});
		const result = parseAdvice(match);
		expect(result!.focusOrder).toContain('Reaper');
		expect(result!.mapAdvice).toContain('Contest home');
		expect(result!.gameplan).toContain('Win 2v1');
	});

	it('handles empty advice text', () => {
		const match = makeMatch({
			userTeamColor: 'red',
			adviceText: '',
			players: []
		});
		// Empty string is falsy, so parseAdvice should return null
		expect(parseAdvice(match)).toBeNull();
	});

	it('extracts DON\'T HIT annotations from enemy advice', () => {
		const match = makeMatch({
			userTeamColor: 'red',
			adviceText: [
				'## PER-ENEMY BREAKDOWN',
				'1. Enemy One — Reaper — RESPECT',
				'Pressure with ranged attacks. DON\'T HIT: Shroud 4 — reflects projectiles.'
			].join('\n'),
			players: [
				makePlayer({ team: 'blue', characterName: 'Enemy One' })
			]
		});
		const result = parseAdvice(match);
		expect(result!.enemyAdvice[0].dont_hit).toContain('reflects projectiles');
	});
});

// --- highlightNames ---

describe('highlightNames', () => {
	it('wraps player names in strong tags', () => {
		const fragments = new Set(['Kors']);
		const result = highlightNames('Focus Kors first.', fragments);
		expect(result).toContain('<strong');
		expect(result).toContain('Kors');
	});

	it('handles empty fragments', () => {
		const result = highlightNames('No names here.', new Set());
		expect(result).toContain('No names here');
	});

	it('converts markdown bold to HTML', () => {
		const result = highlightNames('**Important** note.', new Set());
		expect(result).toContain('<strong');
		expect(result).toContain('Important');
	});
});
