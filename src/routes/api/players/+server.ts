import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/server/db/index.js';
import { players, matchPlayers, matches } from '$lib/server/db/schema.js';
import { eq, and, sql } from 'drizzle-orm';

// GET: List players — stats computed from user's own matches (multi-tenant)
export const GET: RequestHandler = async ({ url, locals }) => {
	const limit = parseInt(url.searchParams.get('limit') ?? '200');
	const offset = parseInt(url.searchParams.get('offset') ?? '0');
	const userId = locals.effectiveUserId;

	if (!userId) {
		return json([]);
	}

	const rows = await db.execute<{
		character_name: string;
		profession: string | null;
		spec: string | null;
		role: string | null;
		times_seen: number;
		wins_against: number;
		losses_against: number;
		last_seen_at: string | null;
		nickname: string | null;
		comment: string | null;
		tag: string | null;
		avg_skill: number | null;
		avg_friendly: number | null;
	}>(sql`
		WITH stats AS (
			SELECT
				mp.character_name,
				COUNT(DISTINCT mp.match_id)::int AS times_seen,
				COUNT(DISTINCT CASE
					WHEN m.result = 'win' AND mp.team != m.user_team_color THEN m.match_id
				END)::int AS wins_against,
				COUNT(DISTINCT CASE
					WHEN m.result = 'loss' AND mp.team != m.user_team_color THEN m.match_id
				END)::int AS losses_against,
				MAX(m.timestamp) AS last_seen_at,
				ROUND(AVG(mp.rating_skill)::numeric, 1) AS avg_skill,
				ROUND(AVG(mp.rating_friendly)::numeric, 1) AS avg_friendly
			FROM match_players mp
			JOIN matches m ON mp.match_id = m.match_id
			WHERE mp.character_name IS NOT NULL
			  AND mp.character_name NOT LIKE 'Unknown Player%'
			  AND mp.is_user = false
			  AND m.user_id = ${userId}
			GROUP BY mp.character_name
		),
		latest AS (
			SELECT DISTINCT ON (mp.character_name)
				mp.character_name, mp.profession, mp.spec, mp.role
			FROM match_players mp
			JOIN matches m ON mp.match_id = m.match_id
			WHERE mp.character_name IS NOT NULL
			  AND mp.is_user = false
			  AND m.user_id = ${userId}
			ORDER BY mp.character_name, m.timestamp DESC
		)
		SELECT
			s.character_name,
			l.profession,
			l.spec,
			COALESCE(p.role, l.role) AS role,
			s.times_seen,
			s.wins_against,
			s.losses_against,
			s.last_seen_at,
			p.nickname,
			p.comment,
			p.tag,
			s.avg_skill,
			s.avg_friendly
		FROM stats s
		JOIN latest l ON s.character_name = l.character_name
		LEFT JOIN players p ON s.character_name = p.character_name
			AND p.user_id = ${userId}
		ORDER BY s.last_seen_at DESC NULLS LAST
		LIMIT ${limit} OFFSET ${offset}
	`);

	// Map to the shape the frontend expects
	const result = rows.map((r) => ({
		characterName: r.character_name,
		profession: r.profession,
		spec: r.spec,
		role: r.role,
		timesSeen: r.times_seen,
		winsAgainst: r.wins_against,
		lossesAgainst: r.losses_against,
		lastSeenAt: r.last_seen_at,
		nickname: r.nickname,
		comment: r.comment,
		tag: r.tag,
		avgSkill: r.avg_skill ? Number(r.avg_skill) : null,
		avgFriendly: r.avg_friendly ? Number(r.avg_friendly) : null
	}));

	return json(result);
};

// POST: No-op kept for backward compat — match_players is the source of truth now
export const POST: RequestHandler = async () => {
	return json({ success: true });
};

// PATCH: Update player metadata (nickname, comment, role override, ratings) — scoped to user
export const PATCH: RequestHandler = async ({ request, locals }) => {
	const { characterName, nickname, comment, role, tag, ratingSkill, ratingFriendly } = await request.json();
	const userId = locals.effectiveUserId;

	if (!characterName) {
		throw error(400, 'Missing characterName');
	}
	if (!userId) {
		throw error(401, 'Unauthorized');
	}

	// Bulk-update ratings on match_players rows for this player in user's matches only (single query with subquery)
	if (ratingSkill !== undefined || ratingFriendly !== undefined) {
		const setClauses: string[] = [];
		if (ratingSkill !== undefined) {
			setClauses.push(`rating_skill = ${ratingSkill === null ? 'NULL' : Number(ratingSkill)}`);
		}
		if (ratingFriendly !== undefined) {
			setClauses.push(`rating_friendly = ${ratingFriendly === null ? 'NULL' : Number(ratingFriendly)}`);
		}

		await db.execute(sql`
			UPDATE match_players
			SET ${sql.raw(setClauses.join(', '))}
			WHERE character_name = ${characterName}
			  AND match_id IN (SELECT match_id FROM matches WHERE user_id = ${userId})
		`);
	}

	// If only ratings were updated, return early
	const updates: Record<string, unknown> = {};
	if (nickname !== undefined) updates.nickname = nickname;
	if (comment !== undefined) updates.comment = comment;
	if (role !== undefined) updates.role = role;
	if (tag !== undefined) updates.tag = tag;

	if (Object.keys(updates).length === 0) {
		return json({ characterName, ratingSkill, ratingFriendly });
	}

	// Upsert: create metadata row scoped to this user
	const [existing] = await db
		.select()
		.from(players)
		.where(and(eq(players.characterName, characterName), eq(players.userId, userId)));

	if (existing) {
		const [updated] = await db
			.update(players)
			.set(updates)
			.where(and(eq(players.characterName, characterName), eq(players.userId, userId)))
			.returning();
		return json(updated);
	} else {
		const [created] = await db
			.insert(players)
			.values({
				characterName,
				userId,
				nickname: (updates.nickname as string) ?? null,
				comment: (updates.comment as string) ?? null,
				role: (updates.role as string) ?? null,
				tag: (updates.tag as string) ?? null
			})
			.returning();
		return json(created);
	}
};

// DELETE: Remove player metadata for this user (player will still appear from match_players)
export const DELETE: RequestHandler = async ({ request, locals }) => {
	const { characterName } = await request.json();
	const userId = locals.effectiveUserId;

	if (!characterName) {
		throw error(400, 'Missing characterName');
	}
	if (!userId) {
		throw error(401, 'Unauthorized');
	}

	await db
		.delete(players)
		.where(and(eq(players.characterName, characterName), eq(players.userId, userId)));
	return json({ deleted: true });
};
