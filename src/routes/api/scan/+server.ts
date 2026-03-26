import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { scanScreenshot } from '$lib/server/scan/index.js';
import { lookupPlayers } from '$lib/server/players.js';
import { db } from '$lib/server/db/index.js';
import { userProfiles, trainingSamples } from '$lib/server/db/schema.js';
import { eq } from 'drizzle-orm';
import type { PlayerInfo } from '$lib/types.js';
import { createHash } from 'crypto';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import sharp from 'sharp';
import { logger } from '$lib/server/logger.js';
import { withSpan } from '$lib/server/telemetry.js';

const SCREENSHOTS_DIR = process.env.SCREENSHOTS_DIR || resolve('static', 'screenshots');

/** Normalize a name for fuzzy matching: lowercase, strip spaces/punctuation */
function normalizeName(name: string): string {
	return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Check if two names match, accounting for OCR errors */
function namesMatch(ocrName: string, profileName: string): boolean {
	const a = normalizeName(ocrName);
	const b = normalizeName(profileName);
	if (!a || !b) return false;

	// Exact match after normalization
	if (a === b) return true;

	// Levenshtein-based: allow up to ~20% character errors
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
	const { image, mediaType } = body;

	if (!image || !mediaType) {
		throw error(400, 'Missing image or mediaType');
	}

	// Save screenshot FIRST (before scan) so we always keep the image for debugging
	const imageBuffer = Buffer.from(image, 'base64');
	const screenshotHash = createHash('sha256').update(imageBuffer).digest('hex').slice(0, 16);
	if (!existsSync(SCREENSHOTS_DIR)) mkdirSync(SCREENSHOTS_DIR, { recursive: true });
	const screenshotPath = resolve(SCREENSHOTS_DIR, `${screenshotHash}.jpg`);
	if (!existsSync(screenshotPath)) {
		// Convert to JPEG Q85 for storage efficiency
		const jpegBuffer = await sharp(imageBuffer).jpeg({ quality: 85 }).toBuffer();
		writeFileSync(screenshotPath, jpegBuffer);
	}

	// Get resolution from image metadata for training data
	let resolution = '';
	try {
		const metadata = await sharp(imageBuffer).metadata();
		resolution = `${metadata.width}x${metadata.height}`;
	} catch { /* non-critical */ }

	let result;
	try {
		result = await withSpan('scan.pipeline', {
			'scan.screenshot_hash': screenshotHash,
			'scan.media_type': mediaType
		}, async (span) => {
			const scanResult = await scanScreenshot(image, mediaType);
			const avgConfidence = [...(scanResult.red_team ?? []), ...(scanResult.blue_team ?? [])]
				.reduce((sum, p) => sum + (p.spec_confidence ?? 0), 0) / 10;
			span.setAttribute('scan.confidence_avg', avgConfidence);
			span.setAttribute('scan.map', scanResult.detected_map?.mapId ?? 'unknown');
			return scanResult;
		});
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		logger.error({ event: 'scan_failed', screenshotHash, error: msg }, 'Scan pipeline failed');
		return json({
			error: msg,
			screenshotHash,
			screenshotUrl: `/api/screenshots/${screenshotHash}`
		}, { status: 422 });
	}

	// Load THIS user's profile character names for user identification (multi-tenant)
	const userId = locals?.effectiveUserId ?? null;
	const profileQuery = userId
		? db.select({ characterName: userProfiles.characterName, profession: userProfiles.profession })
			.from(userProfiles).where(eq(userProfiles.userId, userId))
		: db.select({ characterName: userProfiles.characterName, profession: userProfiles.profession })
			.from(userProfiles);
	const profiles = await profileQuery;

	const profileNames = profiles.map((p) => p.characterName);

	// Identify user player by matching against profile names
	let userTeamColor: 'red' | 'blue' = result.user_team_color;
	let userFound = false;

	function identifyUser(team: PlayerInfo[], teamColor: 'red' | 'blue') {
		for (const player of team) {
			if (userFound) break;
			for (const profileName of profileNames) {
				if (namesMatch(player.character_name, profileName)) {
					player.is_user = true;
					// Also fix the name to the profile's exact spelling if OCR mangled it
					if (normalizeName(player.character_name) !== normalizeName(profileName)
						|| player.character_name !== profileName) {
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

	identifyUser(result.red_team, 'red');
	identifyUser(result.blue_team, 'blue');

	// Enrich with player history (scoped to user's own matches)
	const allPlayers = [...result.red_team, ...result.blue_team];
	const names = allPlayers.map((p: PlayerInfo) => p.character_name);
	const history = await lookupPlayers(names, userId);

	function enrichPlayer(p: PlayerInfo): PlayerInfo & {
		times_seen?: number;
		wins_against?: number;
		losses_against?: number;
		last_seen_at?: string | null;
	} {
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
			// If scan confidence is low and we have history, use historical spec
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

	logger.info({ event: 'scan_complete', screenshotHash, map: result.detected_map?.mapId ?? 'unknown' }, 'Scan completed successfully');

	// Store training sample (fire and forget)
	const allTeamPlayers = [...(result.red_team ?? []), ...(result.blue_team ?? [])];
	const confidenceScores = allTeamPlayers.map((p, i) => ({
		slot: i,
		spec_confidence: p.spec_confidence ?? null,
		name_confidence: p.name_confidence ?? null
	}));

	db.insert(trainingSamples).values({
		userId,
		screenshotHash,
		screenshotPath: screenshotPath,
		resolution: resolution || null,
		uiSize: null,
		deviceInfo: userId ? undefined : null,
		scanResult: {
			red_team: result.red_team,
			blue_team: result.blue_team,
			detected_map: result.detected_map ?? null,
			game_mode: result.detected_map?.mode ?? null
		},
		confidenceScores,
		anchorPosition: null
	}).onConflictDoNothing().catch((e) => {
		logger.warn({ event: 'training_sample_failed', screenshotHash, error: e instanceof Error ? e.message : String(e) }, 'Failed to save training sample');
	});

	return json({
		...result,
		user_team_color: userTeamColor,
		red_team: result.red_team.map(enrichPlayer),
		blue_team: result.blue_team.map(enrichPlayer),
		screenshotHash,
		screenshotUrl: `/api/screenshots/${screenshotHash}`
	});
};
