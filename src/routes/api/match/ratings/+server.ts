import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/server/db/index.js';
import { matchPlayers, players } from '$lib/server/db/schema.js';
import { eq, and } from 'drizzle-orm';

interface PlayerUpdate {
	characterName: string;
	newCharacterName?: string;
	profession?: string;
	spec?: string;
	role?: string;
	ratingSkill?: number | null;
	ratingFriendly?: number | null;
	tag?: string | null;
}

// PATCH: Update player data for a match (ratings, name, spec, profession, role, tag)
export const PATCH: RequestHandler = async ({ request }) => {
	const { matchId, ratings } = await request.json() as {
		matchId: string;
		ratings: PlayerUpdate[];
	};

	if (!matchId || !ratings || !Array.isArray(ratings)) {
		throw error(400, 'Missing matchId or ratings array');
	}

	for (const r of ratings) {
		if (!r.characterName) continue;

		// Update match_players fields
		const mpUpdates: Record<string, unknown> = {};
		if (r.ratingSkill !== undefined) {
			mpUpdates.ratingSkill = r.ratingSkill && r.ratingSkill >= 1 && r.ratingSkill <= 5
				? r.ratingSkill : null;
		}
		if (r.ratingFriendly !== undefined) {
			mpUpdates.ratingFriendly = r.ratingFriendly && r.ratingFriendly >= 1 && r.ratingFriendly <= 5
				? r.ratingFriendly : null;
		}
		if (r.newCharacterName !== undefined) {
			mpUpdates.characterName = r.newCharacterName;
		}
		if (r.profession !== undefined) {
			mpUpdates.profession = r.profession;
		}
		if (r.spec !== undefined) {
			mpUpdates.spec = r.spec;
		}
		if (r.role !== undefined) {
			mpUpdates.role = r.role;
		}

		if (Object.keys(mpUpdates).length > 0) {
			await db
				.update(matchPlayers)
				.set(mpUpdates)
				.where(
					and(
						eq(matchPlayers.matchId, matchId),
						eq(matchPlayers.characterName, r.characterName)
					)
				);
		}

		// Update tag in players metadata table (upsert)
		if (r.tag !== undefined) {
			const name = r.newCharacterName ?? r.characterName;
			const [existing] = await db.select().from(players).where(eq(players.characterName, name));
			if (existing) {
				await db.update(players).set({ tag: r.tag }).where(eq(players.characterName, name));
			} else {
				await db.insert(players).values({ characterName: name, tag: r.tag });
			}
		}
	}

	return json({ success: true });
};

// GET: Get ratings for a specific match
export const GET: RequestHandler = async ({ url }) => {
	const matchId = url.searchParams.get('matchId');
	if (!matchId) {
		throw error(400, 'Missing matchId');
	}

	const rows = await db
		.select({
			characterName: matchPlayers.characterName,
			ratingSkill: matchPlayers.ratingSkill,
			ratingFriendly: matchPlayers.ratingFriendly
		})
		.from(matchPlayers)
		.where(eq(matchPlayers.matchId, matchId));

	return json(rows);
};
