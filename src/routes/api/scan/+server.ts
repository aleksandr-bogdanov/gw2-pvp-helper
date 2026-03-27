import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { scanScreenshot } from '$lib/server/scan/index.js';
import { db } from '$lib/server/db/index.js';
import { trainingSamples } from '$lib/server/db/schema.js';
import { createHash } from 'crypto';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import sharp from 'sharp';
import { logger } from '$lib/server/logger.js';
import { withSpan } from '$lib/server/telemetry.js';
import {
	loadProfileNames,
	identifyUserInTeams,
	enrichPlayersWithHistory
} from '$lib/server/scan-utils.js';

const SCREENSHOTS_DIR = process.env.SCREENSHOTS_DIR || resolve('static', 'screenshots');

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

	// Identify user and enrich with history (tenant-scoped)
	const userId = locals?.effectiveUserId ?? null;
	const profileNames = await loadProfileNames(userId);
	const userTeamColor = identifyUserInTeams(
		result.red_team, result.blue_team, profileNames, result.user_team_color
	);

	const allPlayers = [...result.red_team, ...result.blue_team];
	const enriched = await enrichPlayersWithHistory(allPlayers, userId);

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
		red_team: result.red_team.map((p) => enriched.get(p.character_name) ?? p),
		blue_team: result.blue_team.map((p) => enriched.get(p.character_name) ?? p),
		screenshotHash,
		screenshotUrl: `/api/screenshots/${screenshotHash}`
	});
};
