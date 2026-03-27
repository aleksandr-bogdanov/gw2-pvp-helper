import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/server/db/index.js';
import { matches, matchPlayers, players } from '$lib/server/db/schema.js';
import { eq, desc, inArray, count, and } from 'drizzle-orm';
import { existsSync, unlinkSync } from 'fs';
import { resolve } from 'path';
import { learnMinimapReference } from '$lib/server/scan/minimap.js';
import { logger } from '$lib/server/logger.js';

// --- Helpers ---

const SCREENSHOTS_DIR = process.env.SCREENSHOTS_DIR || resolve('static', 'screenshots');

function resolveScreenshotUrl(hash: string | null): string | null {
	if (!hash) return null;
	for (const ext of ['jpg', 'jpeg', 'png']) {
		if (existsSync(resolve(SCREENSHOTS_DIR, `${hash}.${ext}`))) {
			return `/api/screenshots/${hash}`;
		}
	}
	return null;
}

function resolveScreenshotPath(hash: string | null): string | null {
	if (!hash) return null;
	for (const ext of ['jpg', 'jpeg', 'png']) {
		const path = resolve(SCREENSHOTS_DIR, `${hash}.${ext}`);
		if (existsSync(path)) return path;
	}
	return null;
}

// --- GET: Fetch match history ---

export const GET: RequestHandler = async ({ url, locals }) => {
	const limit = parseInt(url.searchParams.get('limit') ?? '50');
	const offset = parseInt(url.searchParams.get('offset') ?? '0');
	const userId = locals.effectiveUserId;

	const countQuery = userId
		? db.select({ total: count() }).from(matches).where(eq(matches.userId, userId))
		: db.select({ total: count() }).from(matches);
	const [{ total: totalCount }] = await countQuery;

	const baseQuery = db
		.select()
		.from(matches)
		.orderBy(desc(matches.timestamp))
		.limit(limit)
		.offset(offset);
	const matchList = userId
		? await baseQuery.where(eq(matches.userId, userId))
		: await baseQuery;

	const matchIds = matchList.map((m) => m.matchId);
	const allMatchPlayers = matchIds.length > 0
		? await db.select().from(matchPlayers).where(inArray(matchPlayers.matchId, matchIds))
		: [];

	const playersByMatch = new Map<string, typeof allMatchPlayers>();
	for (const mp of allMatchPlayers) {
		if (!mp.matchId) continue;
		const list = playersByMatch.get(mp.matchId) ?? [];
		list.push(mp);
		playersByMatch.set(mp.matchId, list);
	}

	// Fetch tags for all players — scoped to current user's metadata (multi-tenant)
	const allNames = [...new Set(allMatchPlayers.map(mp => mp.characterName).filter((n): n is string => !!n))];
	const playerMeta = allNames.length > 0 && userId
		? await db.select({ characterName: players.characterName, tag: players.tag }).from(players).where(and(inArray(players.characterName, allNames), eq(players.userId, userId)))
		: allNames.length > 0
			? await db.select({ characterName: players.characterName, tag: players.tag }).from(players).where(inArray(players.characterName, allNames))
			: [];
	const tagMap = new Map(playerMeta.map(p => [p.characterName, p.tag]));

	const result = matchList.map((m) => ({
		...m,
		screenshotUrl: resolveScreenshotUrl(m.screenshotHash),
		players: (playersByMatch.get(m.matchId) ?? []).map((p) => ({
			characterName: p.characterName,
			team: p.team,
			profession: p.profession,
			spec: p.spec,
			role: p.role,
			isUser: p.isUser ?? false,
			ratingSkill: p.ratingSkill,
			ratingFriendly: p.ratingFriendly,
			tag: tagMap.get(p.characterName ?? '') ?? null
		}))
	}));

	return json({ matches: result, total: totalCount });
};

// --- POST: Save a new match ---

export const POST: RequestHandler = async ({ request, locals }) => {
	const { myTeam, enemyTeam, map, userTeamColor, userProfileId, screenshotHash } = await request.json();
	const userId = locals.effectiveUserId;

	if (!myTeam || !enemyTeam) {
		throw error(400, 'Missing team data');
	}

	// Dedup by screenshot hash — return existing match + corrected players
	if (screenshotHash) {
		const [existing] = await db
			.select()
			.from(matches)
			.where(eq(matches.screenshotHash, screenshotHash));
		if (existing) {
			const existingPlayers = await db
				.select()
				.from(matchPlayers)
				.where(eq(matchPlayers.matchId, existing.matchId));
			return json({
				matchId: existing.matchId,
				duplicate: true,
				players: existingPlayers.map((p) => ({
					characterName: p.characterName,
					team: p.team,
					profession: p.profession,
					spec: p.spec,
					role: p.role,
					isUser: p.isUser ?? false
				}))
			}, { status: 200 });
		}
	}

	const [match] = await db
		.insert(matches)
		.values({
			userId: userId ?? null,
			userProfileId: userProfileId ?? null,
			userTeamColor: userTeamColor ?? null,
			map: map ?? null,
			screenshotHash: screenshotHash ?? null
		})
		.returning();

	const allPlayers = [
		...myTeam.map((p: { character_name: string; profession_id: string; spec_id: string; role: string; is_user?: boolean }) => ({
			matchId: match.matchId,
			characterName: p.character_name,
			team: userTeamColor,
			profession: p.profession_id,
			spec: p.spec_id,
			role: p.role,
			isUser: p.is_user ?? false
		})),
		...enemyTeam.map((p: { character_name: string; profession_id: string; spec_id: string; role: string }) => ({
			matchId: match.matchId,
			characterName: p.character_name,
			team: userTeamColor === 'red' ? 'blue' : 'red',
			profession: p.profession_id,
			spec: p.spec_id,
			role: p.role,
			isUser: false
		}))
	];

	if (allPlayers.length > 0) {
		await db.insert(matchPlayers).values(allPlayers);
	}

	// Learn minimap reference from this screenshot (fire and forget)
	if (screenshotHash && map) {
		const ssPath = resolveScreenshotPath(screenshotHash);
		if (ssPath) {
			learnMinimapReference(ssPath, map, screenshotHash).catch((e) =>
				logger.warn({ event: 'minimap_learn_failed', screenshotHash, error: e instanceof Error ? e.message : String(e) }, 'Minimap learn failed on POST')
			);
		}
	}

	return json({ matchId: match.matchId }, { status: 201 });
};

// --- PATCH: Update result or advice text ---

export const PATCH: RequestHandler = async ({ request, locals }) => {
	const { matchId, result, adviceText, map, updatePlayers, userTeamColor: patchTeamColor } = await request.json();
	const userId = locals.effectiveUserId;

	if (!matchId) {
		throw error(400, 'Missing matchId');
	}

	const whereClause = userId
		? and(eq(matches.matchId, matchId), eq(matches.userId, userId))
		: eq(matches.matchId, matchId);
	const [current] = await db.select().from(matches).where(whereClause);
	if (!current) {
		throw error(404, 'Match not found');
	}

	const updates: Record<string, unknown> = {};

	if (result !== undefined) {
		updates.result = result;
	}

	if (adviceText !== undefined) {
		updates.adviceText = adviceText;
	}

	if (map !== undefined) {
		updates.map = map;
	}

	if (patchTeamColor !== undefined) {
		updates.userTeamColor = patchTeamColor;
	}

	if (Object.keys(updates).length > 0) {
		await db
			.update(matches)
			.set(updates)
			.where(whereClause);
	}

	// Learn minimap reference when map is set/corrected
	if (map !== undefined && current.screenshotHash) {
		const ssPath = resolveScreenshotPath(current.screenshotHash);
		if (ssPath) {
			learnMinimapReference(ssPath, map, current.screenshotHash).catch((e) =>
				logger.warn({ event: 'minimap_learn_failed', screenshotHash: current.screenshotHash, error: e instanceof Error ? e.message : String(e) }, 'Minimap learn failed on PATCH')
			);
		}
	}

	// Replace all match_players with corrected roster
	if (updatePlayers) {
		const { myTeam, enemyTeam, userTeamColor: utc } = updatePlayers;
		const teamColor = utc ?? current.userTeamColor ?? 'red';
		const enemyColor = teamColor === 'red' ? 'blue' : 'red';

		await db.delete(matchPlayers).where(eq(matchPlayers.matchId, matchId));

		const allPlayers = [
			...(myTeam ?? []).map((p: { character_name: string; profession_id: string; spec_id: string; role: string; is_user?: boolean }) => ({
				matchId,
				characterName: p.character_name,
				team: teamColor,
				profession: p.profession_id,
				spec: p.spec_id,
				role: p.role,
				isUser: p.is_user ?? false
			})),
			...(enemyTeam ?? []).map((p: { character_name: string; profession_id: string; spec_id: string; role: string }) => ({
				matchId,
				characterName: p.character_name,
				team: enemyColor,
				profession: p.profession_id,
				spec: p.spec_id,
				role: p.role,
				isUser: false
			}))
		];

		if (allPlayers.length > 0) {
			await db.insert(matchPlayers).values(allPlayers);
		}
	}

	return json({ matchId: current.matchId, result: current.result ?? result });
};

// --- DELETE: Remove a match ---

export const DELETE: RequestHandler = async ({ request, locals }) => {
	const { matchId } = await request.json();
	const userId = locals.effectiveUserId;

	if (!matchId) {
		throw error(400, 'Missing matchId');
	}

	const deleteWhere = userId
		? and(eq(matches.matchId, matchId), eq(matches.userId, userId))
		: eq(matches.matchId, matchId);
	const [match] = await db.select().from(matches).where(deleteWhere);
	if (!match) {
		throw error(404, 'Match not found');
	}

	// Delete match players first (FK constraint), then the match (ownership-scoped)
	await db.delete(matchPlayers).where(eq(matchPlayers.matchId, matchId));
	await db.delete(matches).where(deleteWhere);

	// Clean up screenshot file (only if no other match references same hash)
	if (match.screenshotHash) {
		const [otherMatch] = await db
			.select()
			.from(matches)
			.where(eq(matches.screenshotHash, match.screenshotHash));
		if (!otherMatch) {
			const screenshotPath = resolveScreenshotPath(match.screenshotHash);
			if (screenshotPath) {
				try { unlinkSync(screenshotPath); } catch { /* non-critical */ }
			}
		}
	}

	return json({ deleted: true });
};
