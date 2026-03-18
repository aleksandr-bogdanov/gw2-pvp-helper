import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/server/db/index.js';
import { matches, matchPlayers, userProfiles } from '$lib/server/db/schema.js';
import { eq } from 'drizzle-orm';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Cache static data files at module level (they never change at runtime)
const fileCache = new Map<string, string>();
function loadDataFile(filename: string): string {
	const cached = fileCache.get(filename);
	if (cached !== undefined) return cached;
	try {
		const content = readFileSync(resolve('data', filename), 'utf-8');
		fileCache.set(filename, content);
		return content;
	} catch {
		const fallback = '(file not found)';
		fileCache.set(filename, fallback);
		return fallback;
	}
}

export const GET: RequestHandler = async ({ params }) => {
	const matchId = params.matchId;
	if (!matchId) {
		throw error(400, 'Missing matchId');
	}

	// Run match and players queries in parallel
	const [[match], players] = await Promise.all([
		db.select().from(matches).where(eq(matches.matchId, matchId)),
		db.select().from(matchPlayers).where(eq(matchPlayers.matchId, matchId))
	]);

	if (!match) {
		throw error(404, 'Match not found');
	}

	// Load the profile used for this match
	let profilePrompt: string | null = null;
	let buildLabel: string | null = null;
	let role = 'dps';
	if (match.userProfileId) {
		const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.id, match.userProfileId));
		if (profile) {
			profilePrompt = profile.profilePrompt;
			buildLabel = profile.buildLabel;
			role = profile.role;
		}
	}

	// Reconstruct system prompt components
	const isSupport = role === 'support' || role === 'heal' || role === 'supp' || role === 'alac';
	const gameKnowledge = loadDataFile('universal-game-knowledge.md');
	const outputFormat = isSupport
		? loadDataFile('output-format-support.md')
		: loadDataFile('output-format-dps.md');

	const myTeam = players.filter(p => p.team === match.userTeamColor);
	const enemyTeam = players.filter(p => p.team !== match.userTeamColor);

	const formatTeam = (team: typeof players) =>
		team.map((p, i) =>
			`${i + 1}. ${p.characterName} — ${p.spec} (${p.profession}) — ${p.role}${p.isUser ? ' ← ME' : ''}`
		).join('\n');

	const userMessage = `CHARACTER: ${buildLabel || 'Unknown'}
ROLE: ${role}
Map: ${match.map ?? 'Unknown'}

ENEMY TEAM:
${formatTeam(enemyTeam)}

MY TEAM:
${formatTeam(myTeam)}`;

	return json({
		matchId: match.matchId,
		adviceRaw: match.adviceRaw,
		adviceText: match.adviceText,
		systemPrompt: `You are a GW2 PvP tactical advisor.\n\n${gameKnowledge}\n\n${outputFormat}`,
		profilePrompt,
		userMessage,
		map: match.map,
		timestamp: match.timestamp
	});
};
