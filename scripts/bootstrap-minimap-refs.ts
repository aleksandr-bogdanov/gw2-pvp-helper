/**
 * Bootstrap script: extract minimap references from all existing matches.
 *
 * Queries all matches with a screenshot hash and map, then extracts
 * minimap thumbnails and saves them as learned references.
 *
 * Run: npx tsx scripts/bootstrap-minimap-refs.ts
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/lib/server/db/schema.js';
import { learnMinimapReference } from '../src/lib/server/scan/minimap.js';
import { isNotNull } from 'drizzle-orm';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

// Load .env manually (no dotenv dependency)
try {
	const envContent = readFileSync('.env', 'utf-8');
	for (const line of envContent.split('\n')) {
		const match = line.match(/^([^#=]+)=(.*)$/);
		if (match) process.env[match[1].trim()] = match[2].trim();
	}
} catch { /* .env not found, use defaults */ }

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://gw2:gw2@localhost:5432/gw2pvp';
const client = postgres(DATABASE_URL);
const db = drizzle(client, { schema });

function resolveScreenshotPath(hash: string): string | null {
	for (const ext of ['png', 'jpg']) {
		const path = resolve('static', 'screenshots', `${hash}.${ext}`);
		if (existsSync(path)) return path;
	}
	return null;
}

async function main() {
	const allMatches = await db
		.select({
			matchId: schema.matches.matchId,
			map: schema.matches.map,
			screenshotHash: schema.matches.screenshotHash
		})
		.from(schema.matches)
		.where(isNotNull(schema.matches.screenshotHash));

	const withMap = allMatches.filter((m) => m.map && m.screenshotHash);

	console.log(`Found ${allMatches.length} matches with screenshots, ${withMap.length} have a map set`);

	let learned = 0;
	let skipped = 0;

	for (const match of withMap) {
		const ssPath = resolveScreenshotPath(match.screenshotHash!);
		if (!ssPath) {
			console.warn(`  [skip] ${match.screenshotHash} — screenshot file not found`);
			skipped++;
			continue;
		}

		try {
			await learnMinimapReference(ssPath, match.map!, match.screenshotHash!);
			learned++;
		} catch (e) {
			console.warn(`  [fail] ${match.screenshotHash}: ${e}`);
			skipped++;
		}
	}

	console.log(`\nDone: ${learned} learned, ${skipped} skipped`);
	await client.end();
	process.exit(0);
}

main().catch(async (e) => {
	console.error(e);
	await client.end();
	process.exit(1);
});
