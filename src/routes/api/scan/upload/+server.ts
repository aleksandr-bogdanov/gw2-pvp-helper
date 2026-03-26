/**
 * POST /api/scan/upload — Upload screenshot + client-side scan result for training data.
 *
 * Called by the client-side scan pipeline after scanning locally.
 * Saves the screenshot as JPEG and stores the training sample in DB.
 * Also enriches the scan result with user identification and player history.
 */
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { lookupPlayers } from '$lib/server/players.js';
import { db } from '$lib/server/db/index.js';
import { userProfiles, trainingSamples } from '$lib/server/db/schema.js';
import { eq } from 'drizzle-orm';
import type { PlayerInfo, ScanResult } from '$lib/types.js';
import { createHash } from 'crypto';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { logger } from '$lib/server/logger.js';

const SCREENSHOTS_DIR = process.env.SCREENSHOTS_DIR || resolve('static', 'screenshots');

function normalizeName(name: string): string {
	return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function namesMatch(ocrName: string, profileName: string): boolean {
	const a = normalizeName(ocrName);
	const b = normalizeName(profileName);
	if (!a || !b) return false;
	if (a === b) return true;
	const maxDist = Math.max(1, Math.floor(Math.max(a.length, b.length) * 0.25));
	return levenshtein(a, b) <= maxDist;
}

function levenshtein(a: string, b: string): number {
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

export const POST: RequestHandler = async ({ request, locals }) => {
	const body = await request.json();
	const { image, scanResult, resolution } = body as {
		image: string; // base64 JPEG
		scanResult: ScanResult;
		resolution?: string;
	};

	if (!image || !scanResult) {
		throw error(400, 'Missing image or scanResult');
	}

	// Save screenshot
	const imageBuffer = Buffer.from(image, 'base64');
	const screenshotHash = createHash('sha256').update(imageBuffer).digest('hex').slice(0, 16);
	if (!existsSync(SCREENSHOTS_DIR)) mkdirSync(SCREENSHOTS_DIR, { recursive: true });
	const screenshotPath = resolve(SCREENSHOTS_DIR, `${screenshotHash}.jpg`);
	if (!existsSync(screenshotPath)) {
		writeFileSync(screenshotPath, imageBuffer);
	}

	// Load THIS user's profile character names for identification (multi-tenant)
	const userId = locals?.effectiveUserId ?? null;
	const profileQuery = userId
		? db.select({ characterName: userProfiles.characterName, profession: userProfiles.profession })
			.from(userProfiles).where(eq(userProfiles.userId, userId))
		: db.select({ characterName: userProfiles.characterName, profession: userProfiles.profession })
			.from(userProfiles);
	const profiles = await profileQuery;

	const profileNames = profiles.map((p) => p.characterName);

	// Identify user player
	let userTeamColor: 'red' | 'blue' = scanResult.user_team_color;
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

	identifyUser(scanResult.red_team, 'red');
	identifyUser(scanResult.blue_team, 'blue');

	// Enrich with player history (scoped to user's own matches)
	const allPlayers = [...scanResult.red_team, ...scanResult.blue_team];
	const names = allPlayers.map((p: PlayerInfo) => p.character_name);
	const history = await lookupPlayers(names, userId);

	function enrichPlayer(p: PlayerInfo): PlayerInfo {
		const h = history.get(p.character_name);
		if (!h) return { ...p, times_seen: 0, wins_against: 0, losses_against: 0, avg_skill: null, avg_friendly: null, tag: null };
		return {
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
		};
	}

	// Store training sample
	const allTeamPlayers = [...(scanResult.red_team ?? []), ...(scanResult.blue_team ?? [])];
	const confidenceScores = allTeamPlayers.map((p, i) => ({
		slot: i,
		spec_confidence: p.spec_confidence ?? null,
		name_confidence: p.name_confidence ?? null
	}));

	db.insert(trainingSamples).values({
		userId,
		screenshotHash,
		screenshotPath,
		resolution: resolution || null,
		uiSize: null,
		deviceInfo: null,
		scanResult: {
			red_team: scanResult.red_team,
			blue_team: scanResult.blue_team,
			map_detection: scanResult.detected_map,
		},
		confidenceScores,
		anchorPosition: null
	}).onConflictDoNothing().catch((e) => {
		logger.warn({ event: 'training_sample_failed', screenshotHash, error: e instanceof Error ? e.message : String(e) }, 'Failed to save training sample');
	});

	logger.info({ event: 'client_scan_upload', screenshotHash, source: 'client' }, 'Client-side scan uploaded');

	return json({
		...scanResult,
		user_team_color: userTeamColor,
		red_team: scanResult.red_team.map(enrichPlayer),
		blue_team: scanResult.blue_team.map(enrichPlayer),
		screenshotHash,
		screenshotUrl: `/api/screenshots/${screenshotHash}`
	});
};
