/**
 * POST /api/scan/upload - Upload screenshot + client-side scan result for training data.
 *
 * Called by the client-side scan pipeline after scanning locally.
 * Saves the screenshot as JPEG and stores the training sample in DB.
 * Also enriches the scan result with user identification and player history.
 */
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/server/db/index.js';
import { trainingSamples } from '$lib/server/db/schema.js';
import type { ScanResult } from '$lib/types.js';
import { createHash } from 'crypto';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { logger } from '$lib/server/logger.js';
import {
	loadProfileNames,
	identifyUserInTeams,
	enrichPlayersWithHistory
} from '$lib/server/scan-utils.js';

const SCREENSHOTS_DIR = process.env.SCREENSHOTS_DIR || resolve('static', 'screenshots');

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

	// Identify user and enrich with history
	const profileNames = await loadProfileNames();
	const userTeamColor = identifyUserInTeams(
		scanResult.red_team, scanResult.blue_team, profileNames, scanResult.user_team_color
	);

	const allPlayers = [...scanResult.red_team, ...scanResult.blue_team];
	const enriched = await enrichPlayersWithHistory(allPlayers);

	// Store training sample
	const userId = locals?.effectiveUserId ?? null;
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
		red_team: scanResult.red_team.map((p) => enriched.get(p.character_name) ?? p),
		blue_team: scanResult.blue_team.map((p) => enriched.get(p.character_name) ?? p),
		screenshotHash,
		screenshotUrl: `/api/screenshots/${screenshotHash}`
	});
};
