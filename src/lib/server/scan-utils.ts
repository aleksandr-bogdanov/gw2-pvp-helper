/**
 * Shared utilities for scan API routes (/api/scan and /api/scan/upload).
 *
 * Extracted to avoid code duplication between the server-side scan route
 * and the client-side scan upload route.
 */

import type { PlayerInfo } from '$lib/types.js';
import { lookupPlayers } from '$lib/server/players.js';
import { db } from '$lib/server/db/index.js';
import { userProfiles } from '$lib/server/db/schema.js';
import { eq } from 'drizzle-orm';

/** Normalize a name for fuzzy matching: lowercase, strip spaces/punctuation */
export function normalizeName(name: string): string {
	return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Levenshtein edit distance between two strings */
export function levenshtein(a: string, b: string): number {
	const m = a.length;
	const n = b.length;
	const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
	for (let i = 0; i <= m; i++) dp[i][0] = i;
	for (let j = 0; j <= n; j++) dp[0][j] = j;
	for (let i = 1; i <= m; i++) {
		for (let j = 1; j <= n; j++) {
			dp[i][j] = Math.min(
				dp[i - 1][j] + 1,
				dp[i][j - 1] + 1,
				dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
			);
		}
	}
	return dp[m][n];
}

/** Check if two names match, accounting for OCR errors (up to ~25% character distance) */
export function namesMatch(ocrName: string, profileName: string): boolean {
	const a = normalizeName(ocrName);
	const b = normalizeName(profileName);
	if (!a || !b) return false;

	// Exact match after normalization
	if (a === b) return true;

	// Levenshtein-based: allow up to ~25% character errors
	const maxDist = Math.max(1, Math.floor(Math.max(a.length, b.length) * 0.25));
	return levenshtein(a, b) <= maxDist;
}

/** Load profile character names from the database, scoped to the given user */
export async function loadProfileNames(userId: number | null): Promise<string[]> {
	const query = userId
		? db.select({ characterName: userProfiles.characterName })
			.from(userProfiles).where(eq(userProfiles.userId, userId))
		: db.select({ characterName: userProfiles.characterName })
			.from(userProfiles);
	const profiles = await query;
	return profiles.map((p) => p.characterName);
}

/**
 * Identify the user player in the scan result by matching against profile names.
 * Mutates the team arrays: sets is_user flag and corrects OCR-mangled names.
 * Returns the detected user team color.
 */
export function identifyUserInTeams(
	redTeam: PlayerInfo[],
	blueTeam: PlayerInfo[],
	profileNames: string[],
	defaultTeamColor: 'red' | 'blue'
): 'red' | 'blue' {
	let userTeamColor = defaultTeamColor;
	let userFound = false;

	function identifyUser(team: PlayerInfo[], teamColor: 'red' | 'blue') {
		for (const player of team) {
			if (userFound) break;
			for (const profileName of profileNames) {
				if (namesMatch(player.character_name, profileName)) {
					player.is_user = true;
					if (player.character_name !== profileName) {
						player.character_name = profileName;
						player.name_confidence = 100;
					}
					userTeamColor = teamColor;
					userFound = true;
					break;
				}
			}
		}
	}

	identifyUser(redTeam, 'red');
	identifyUser(blueTeam, 'blue');

	return userTeamColor;
}

/**
 * Enrich players with historical data from the player memory.
 * Also overrides low-confidence spec detections with historical corrected specs.
 */
export async function enrichPlayersWithHistory(
	players: PlayerInfo[],
	userId: number | null
): Promise<Map<string, PlayerInfo>> {
	const names = players.map((p) => p.character_name);
	const history = await lookupPlayers(names, userId);

	const enriched = new Map<string, PlayerInfo>();
	for (const p of players) {
		const h = history.get(p.character_name);
		const result: PlayerInfo = h
			? {
					...p,
					times_seen: h.times_seen,
					wins_against: h.wins_against,
					losses_against: h.losses_against,
					last_seen_at: h.last_seen_at instanceof Date ? h.last_seen_at.toISOString() : (h.last_seen_at ?? null),
					avg_skill: h.avg_skill,
					avg_friendly: h.avg_friendly,
					tag: h.tag,
					...(p.spec_source !== 'corrected' &&
						(p.spec_confidence ?? 1) < 0.58 &&
						h.spec &&
						h.spec_source === 'corrected'
						? {
								spec_id: h.spec,
								profession_id: h.profession ?? p.profession_id,
								role: h.role ?? p.role,
								spec_source: 'history' as const
							}
						: {})
				}
			: { ...p, times_seen: 0, wins_against: 0, losses_against: 0, avg_skill: null, avg_friendly: null, tag: null };
		enriched.set(p.character_name, result);
	}

	return enriched;
}
