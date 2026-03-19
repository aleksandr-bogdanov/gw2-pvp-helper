import type { MatchPlayer, MatchRecord, ParsedAdvice } from './match-types.js';
import { maps, getProfessionColor } from './game-data.js';

export function getSpecIconUrl(specId: string, professionId?: string): string {
	const id = specId === 'core' && professionId ? professionId : specId;
	return `/icons/specs/${id}.png`;
}

export function specIconStyle(specId: string, professionId: string): string {
	const url = getSpecIconUrl(specId, professionId);
	const color = getProfessionColor(professionId);
	return `background-color: ${color}; -webkit-mask-image: url(${url}); mask-image: url(${url}); -webkit-mask-size: contain; mask-size: contain; -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;`;
}

export function getMapName(mapId: string | null): string {
	if (!mapId) return 'Unknown';
	return maps.find((m) => m.id === mapId)?.name ?? mapId;
}

export function getMapMode(mapId: string | null): string | null {
	if (!mapId) return null;
	return maps.find((m) => m.id === mapId)?.mode ?? null;
}

export function getThreatColor(threat: string): string {
	switch (threat) {
		case 'hunt': return 'text-(--color-red) bg-(--color-red)/10';
		case 'respect': return 'text-(--color-amber) bg-(--color-amber)/10';
		case 'avoid': return 'text-(--color-text-tertiary) bg-(--color-surface-raised)';
		default: return 'text-(--color-text-tertiary)';
	}
}

export function getModeColor(mode: string): string {
	switch (mode) {
		case 'conquest': return 'text-(--color-accent)/70 bg-(--color-accent)/10';
		case 'push': return 'text-(--color-amber)/70 bg-(--color-amber)/10';
		case 'stronghold': return 'text-(--color-red)/70 bg-(--color-red)/10';
		default: return 'text-(--color-text-tertiary) bg-(--color-surface-raised)';
	}
}

export function formatTime(ts: string): string {
	const d = new Date(ts);
	const now = new Date();
	const diff = now.getTime() - d.getTime();
	const mins = Math.floor(diff / 60000);
	const hours = Math.floor(diff / 3600000);
	const days = Math.floor(diff / 86400000);

	if (mins < 60) return `${mins}m ago`;
	if (hours < 24) return `${hours}h ago`;
	if (days < 7) return `${days}d ago`;
	return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function getTeams(match: MatchRecord) {
	return {
		redTeam: match.players.filter((p) => p.team === 'red'),
		blueTeam: match.players.filter((p) => p.team === 'blue')
	};
}

export function getEnemyAllyTeams(match: MatchRecord) {
	const myColor = match.userTeamColor ?? 'red';
	const enemyColor = myColor === 'red' ? 'blue' : 'red';
	return {
		myTeam: match.players.filter((p) => p.team === myColor),
		enemyTeam: match.players.filter((p) => p.team === enemyColor)
	};
}

export function getEnemyAdviceForIdx(advice: ParsedAdvice | null, idx: number) {
	if (!advice) return null;
	const a = advice.enemyAdvice[idx];
	return a?.advice ? a : null;
}

export function getAllyAdviceForIdx(advice: ParsedAdvice | null, idx: number) {
	if (!advice) return null;
	const a = advice.allyAdvice[idx];
	return a?.advice ? a : null;
}

export function buildNameFragments(match: MatchRecord): Set<string> {
	const fragments = new Set<string>();
	for (const p of match.players) {
		const name = p.characterName;
		if (!name || name.startsWith('Unknown Player')) continue;
		fragments.add(name);
		const words = name.split(/\s+/);
		if (words.length > 1) {
			for (const word of words) {
				if (word.length >= 3) fragments.add(word);
			}
		}
	}
	return fragments;
}

export function splitSentences(text: string): string {
	const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z"'"(])/).map(s => s.trim()).filter(Boolean);
	if (sentences.length <= 1) return `• ${text}`;
	return '<ul class="list-disc list-inside space-y-0.5">' + sentences.map(s => `<li>${s}</li>`).join('') + '</ul>';
}

export function highlightNames(text: string, fragments: Set<string>): string {
	let result = splitSentences(text);
	result = result.replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold text-(--color-text)">$1</strong>');
	if (fragments.size === 0) return result;
	const sorted = [...fragments].sort((a, b) => b.length - a.length);
	const escaped = sorted.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
	const pattern = new RegExp(`(?<![<\\w])\\b(${escaped.join('|')})\\b(?![\\w>])`, 'gi');
	return result.replace(pattern, '<strong class="font-semibold text-(--color-text)">$1</strong>');
}

export function parseAdvice(match: MatchRecord): ParsedAdvice | null {
	if (!match.adviceText) return null;

	const { myTeam: myTeamPlayers, enemyTeam: enemyTeamPlayers } = getEnemyAllyTeams(match);
	const result: ParsedAdvice = {
		focusOrder: '',
		babysit: '',
		mapAdvice: '',
		gameplan: '',
		positioning: '',
		enemyAdvice: enemyTeamPlayers.map(() => ({ threat: '', advice: '' })),
		allyAdvice: myTeamPlayers.map(() => ({ advice: undefined }))
	};

	const lines = match.adviceText.split('\n');
	let section = '';
	let playerIdx = -1;
	let currentBlock = '';

	for (const line of lines) {
		const trimmed = line.trim();

		if (/^-{3,}$|^\*{3,}$|^_{3,}$/.test(trimmed)) continue;

		if (/^(?:#+|\d+\.|\*\*)\s*(TEAM COMP|PER-ENEMY|PER.ALLY|FOCUS ORDER|MAP STRATEGY|GENERAL GAMEPLAN|WHO TO BABYSIT|ENEMY THREATS|TEAMFIGHT POSITION|KEY COOLDOWN)/i.test(trimmed)) {
			flushAdvice(result, section, playerIdx, currentBlock, enemyTeamPlayers, myTeamPlayers);
			currentBlock = '';
			playerIdx = -1;

			if (/PER-ENEMY|ENEMY THREATS/i.test(trimmed)) section = 'per_enemy';
			else if (/PER.ALLY/i.test(trimmed)) section = 'per_ally';
			else if (/FOCUS ORDER/i.test(trimmed)) section = 'focus';
			else if (/MAP STRATEGY/i.test(trimmed)) section = 'map';
			else if (/GENERAL GAMEPLAN/i.test(trimmed)) section = 'gameplan';
			else if (/WHO TO BABYSIT/i.test(trimmed)) section = 'babysit';
			else if (/TEAMFIGHT POSITION/i.test(trimmed)) section = 'positioning';
			else if (/KEY COOLDOWN/i.test(trimmed)) section = 'gameplan';
			else section = 'team_comp';
			continue;
		}

		const playerMatch = trimmed.match(/^(?:#+\s*|\*\*)?(\d+)\.[\s*]*(.+)/);
		if (playerMatch && (section === 'per_enemy' || section === 'per_ally')) {
			flushAdvice(result, section, playerIdx, currentBlock, enemyTeamPlayers, myTeamPlayers);
			currentBlock = '';

			const headerText = playerMatch[2].toLowerCase();
			const team = section === 'per_enemy' ? enemyTeamPlayers : myTeamPlayers;
			const nameMatchIdx = team.findIndex(p =>
				p.characterName && headerText.includes(p.characterName.toLowerCase())
			);

			playerIdx = nameMatchIdx >= 0 ? nameMatchIdx : parseInt(playerMatch[1]) - 1;

			if (section === 'per_enemy') {
				const threatMatch = headerText.match(/\b(HUNT|RESPECT|AVOID)\b/i);
				if (threatMatch && playerIdx >= 0 && playerIdx < result.enemyAdvice.length) {
					result.enemyAdvice[playerIdx] = {
						...result.enemyAdvice[playerIdx],
						threat: threatMatch[1].toLowerCase()
					};
				}
			}
			continue;
		}

		currentBlock += line + '\n';
	}

	flushAdvice(result, section, playerIdx, currentBlock, enemyTeamPlayers, myTeamPlayers);
	return result;
}

export function flushAdvice(
	result: ParsedAdvice,
	section: string,
	playerIdx: number,
	block: string,
	enemyTeam: MatchPlayer[],
	myTeam: MatchPlayer[]
) {
	const text = block.trim();
	if (!text) return;

	if (section === 'per_enemy' && playerIdx >= 0 && playerIdx < result.enemyAdvice.length) {
		const dontHitMatch = text.match(/(?:DON'?T\s+HIT|DO NOT HIT)[:\s]*(.*)/is);
		const mainAdvice = dontHitMatch ? text.replace(dontHitMatch[0], '').trim() : text;
		const dontHit = dontHitMatch ? dontHitMatch[1].trim() : undefined;

		result.enemyAdvice[playerIdx] = {
			...result.enemyAdvice[playerIdx],
			advice: mainAdvice,
			dont_hit: dontHit || result.enemyAdvice[playerIdx].dont_hit
		};
	} else if (section === 'per_ally' && playerIdx >= 0 && playerIdx < result.allyAdvice.length) {
		result.allyAdvice[playerIdx] = { advice: text };
	} else if (section === 'focus') {
		result.focusOrder = text;
	} else if (section === 'map') {
		result.mapAdvice = text;
	} else if (section === 'gameplan') {
		result.gameplan = text;
	} else if (section === 'babysit') {
		result.babysit = text;
	} else if (section === 'positioning') {
		result.positioning = text;
	}
}
