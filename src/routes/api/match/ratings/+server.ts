import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/server/db/index.js';
import { matches, matchPlayers, players } from '$lib/server/db/schema.js';
import { eq, and, inArray } from 'drizzle-orm';

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
export const PATCH: RequestHandler = async ({ request, locals }) => {
	const { matchId, ratings } = await request.json() as {
		matchId: string;
		ratings: PlayerUpdate[];
	};
	const userId = locals.effectiveUserId;

	if (!userId) {
		throw error(401, 'Authentication required');
	}

	if (!matchId || !ratings || !Array.isArray(ratings)) {
		throw error(400, 'Missing matchId or ratings array');
	}

	// Verify match exists and belongs to the requesting user
	const matchWhere = userId
		? and(eq(matches.matchId, matchId), eq(matches.userId, userId))
		: eq(matches.matchId, matchId);
	const [match] = await db.select().from(matches).where(matchWhere);
	if (!match) {
		throw error(404, 'Match not found');
	}

	// Collect tag upsert names for batched lookup
	const tagUpdates: { name: string; tag: string | null }[] = [];

	await db.transaction(async (tx) => {
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
				await tx
					.update(matchPlayers)
					.set(mpUpdates)
					.where(
						and(
							eq(matchPlayers.matchId, matchId),
							eq(matchPlayers.characterName, r.characterName)
						)
					);
			}

			// Collect tag updates for batched upsert
			if (r.tag !== undefined && userId) {
				tagUpdates.push({ name: r.newCharacterName ?? r.characterName, tag: r.tag });
			}
		}

		// Batch tag upserts: single SELECT to find existing players, then batch updates/inserts
		if (tagUpdates.length > 0 && userId) {
			const tagNames = tagUpdates.map((t) => t.name);
			const existingPlayers = await tx
				.select({ characterName: players.characterName })
				.from(players)
				.where(and(inArray(players.characterName, tagNames), eq(players.userId, userId)));
			const existingSet = new Set(existingPlayers.map((p) => p.characterName));

			for (const { name, tag } of tagUpdates) {
				if (existingSet.has(name)) {
					await tx
						.update(players)
						.set({ tag })
						.where(and(eq(players.characterName, name), eq(players.userId, userId)));
				} else {
					await tx.insert(players).values({ characterName: name, userId, tag });
				}
			}
		}
	});

	return json({ success: true });
};

// GET: Get ratings for a specific match (tenant-scoped)
export const GET: RequestHandler = async ({ url, locals }) => {
	const matchId = url.searchParams.get('matchId');
	const userId = locals.effectiveUserId;

	if (!userId) {
		throw error(401, 'Authentication required');
	}

	if (!matchId) {
		throw error(400, 'Missing matchId');
	}

	// Verify match belongs to the requesting user
	if (userId) {
		const [match] = await db.select({ matchId: matches.matchId }).from(matches)
			.where(and(eq(matches.matchId, matchId), eq(matches.userId, userId)));
		if (!match) {
			throw error(404, 'Match not found');
		}
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
