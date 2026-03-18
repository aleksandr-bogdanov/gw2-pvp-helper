/**
 * Test minimap detection accuracy against user-corrected maps in match history.
 *
 * Tests 3 strategies:
 * 1. Static refs only (spatial)
 * 2. Static + learned refs (spatial, leave-one-out)
 * 3. Static + learned refs with RI fallback (the actual production logic)
 *
 * Run: npx tsx scripts/test-minimap-detection.ts
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/lib/server/db/schema.js';
import { isNotNull } from 'drizzle-orm';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import sharp from 'sharp';

// Load .env
try {
	const envContent = readFileSync('.env', 'utf-8');
	for (const line of envContent.split('\n')) {
		const match = line.match(/^([^#=]+)=(.*)$/);
		if (match) process.env[match[1].trim()] = match[2].trim();
	}
} catch {}

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://gw2:gw2@localhost:5432/gw2pvp';
const client = postgres(DATABASE_URL);
const db = drizzle(client, { schema });

const THUMB_SIZE = 16;
const CROP_X = 3100, CROP_Y = 1100, CROP_W = 300, CROP_H = 300;
const HIST_BINS = 8;
const HIST_SIZE = HIST_BINS * HIST_BINS * HIST_BINS;
const RADIAL_RINGS = 6;
const RADIAL_SIZE = RADIAL_RINGS * 3;

interface Ref { mapId: string; features: Float64Array; riFeatures: Float64Array; _hash?: string }

function cosineSimilarity(a: Float64Array, b: Float64Array): number {
	let dot = 0, normA = 0, normB = 0;
	for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; normA += a[i] * a[i]; normB += b[i] * b[i]; }
	const denom = Math.sqrt(normA) * Math.sqrt(normB);
	return denom > 0 ? dot / denom : 0;
}

function computeRI(spatial: Float64Array): Float64Array {
	const size = THUMB_SIZE;
	const totalPixels = size * size;

	const hist = new Float64Array(HIST_SIZE);
	for (let i = 0; i < totalPixels; i++) {
		const r = spatial[i * 3], g = spatial[i * 3 + 1], b = spatial[i * 3 + 2];
		const rBin = Math.min(Math.floor(r * HIST_BINS), HIST_BINS - 1);
		const gBin = Math.min(Math.floor(g * HIST_BINS), HIST_BINS - 1);
		const bBin = Math.min(Math.floor(b * HIST_BINS), HIST_BINS - 1);
		hist[rBin * HIST_BINS * HIST_BINS + gBin * HIST_BINS + bBin]++;
	}
	for (let i = 0; i < HIST_SIZE; i++) hist[i] /= totalPixels;

	const radial = new Float64Array(RADIAL_SIZE);
	const radialCounts = new Float64Array(RADIAL_RINGS);
	const cx = (size - 1) / 2, cy = (size - 1) / 2;
	const maxDist = Math.sqrt(cx * cx + cy * cy);
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
			const ring = Math.min(Math.floor((dist / maxDist) * RADIAL_RINGS), RADIAL_RINGS - 1);
			const idx = (y * size + x) * 3;
			radial[ring * 3] += spatial[idx]; radial[ring * 3 + 1] += spatial[idx + 1]; radial[ring * 3 + 2] += spatial[idx + 2];
			radialCounts[ring]++;
		}
	}
	for (let ring = 0; ring < RADIAL_RINGS; ring++) {
		if (radialCounts[ring] > 0) { radial[ring*3] /= radialCounts[ring]; radial[ring*3+1] /= radialCounts[ring]; radial[ring*3+2] /= radialCounts[ring]; }
	}

	const combined = new Float64Array(HIST_SIZE + RADIAL_SIZE);
	for (let i = 0; i < HIST_SIZE; i++) combined[i] = hist[i];
	for (let i = 0; i < RADIAL_SIZE; i++) combined[HIST_SIZE + i] = radial[i] * 0.5;
	let norm = 0;
	for (let i = 0; i < combined.length; i++) norm += combined[i] * combined[i];
	norm = Math.sqrt(norm);
	if (norm > 0) for (let i = 0; i < combined.length; i++) combined[i] /= norm;
	return combined;
}

async function loadRefs(dir: string, tagHashes = false): Promise<Ref[]> {
	const manifestPath = resolve(dir, 'manifest.json');
	if (!existsSync(manifestPath)) return [];
	const manifest: { mapId: string; file: string }[] = JSON.parse(readFileSync(manifestPath, 'utf-8'));
	const refs: Ref[] = [];
	for (const entry of manifest) {
		const filePath = resolve(dir, entry.file);
		if (!existsSync(filePath)) continue;
		const { data } = await sharp(filePath).removeAlpha().toColorspace('srgb').raw().toBuffer({ resolveWithObject: true });
		const features = new Float64Array(THUMB_SIZE * THUMB_SIZE * 3);
		for (let i = 0; i < features.length; i++) features[i] = data[i] / 255.0;
		const riFeatures = computeRI(features);
		const hashMatch = entry.file.match(/_([a-f0-9]{16})\.png$/);
		refs.push({ mapId: entry.mapId, features, riFeatures, _hash: tagHashes ? (hashMatch?.[1] ?? '') : undefined });
	}
	return refs;
}

async function extractThumb(screenshotPath: string): Promise<Float64Array> {
	const { data, info } = await sharp(screenshotPath).removeAlpha().toColorspace('srgb').raw().toBuffer({ resolveWithObject: true });
	const x1 = Math.min(CROP_X, info.width), y1 = Math.min(CROP_Y, info.height);
	const x2 = Math.min(CROP_X + CROP_W, info.width), y2 = Math.min(CROP_Y + CROP_H, info.height);
	const w = x2 - x1, h = y2 - y1;
	const roiData = Buffer.alloc(w * h * 3);
	for (let row = 0; row < h; row++) {
		const srcOff = ((y1 + row) * info.width + x1) * 3;
		roiData.set(data.subarray(srcOff, srcOff + w * 3), row * w * 3);
	}
	const thumb = await sharp(roiData, { raw: { width: w, height: h, channels: 3 } })
		.resize(THUMB_SIZE, THUMB_SIZE, { kernel: 'lanczos3' }).raw().toBuffer({ resolveWithObject: true });
	const features = new Float64Array(THUMB_SIZE * THUMB_SIZE * 3);
	for (let i = 0; i < features.length; i++) features[i] = thumb.data[i] / 255.0;
	return features;
}

type Strategy = 'spatial' | 'ri' | 'combined';

function detect(thumb: Float64Array, thumbRI: Float64Array, refs: Ref[], strategy: Strategy): { mapId: string; gap: number } | null {
	if (refs.length === 0) return null;

	const spatialScores: Record<string, number> = {};
	const riScores: Record<string, number> = {};

	for (const ref of refs) {
		const ss = cosineSimilarity(thumb, ref.features);
		const rs = cosineSimilarity(thumbRI, ref.riFeatures);
		if (!spatialScores[ref.mapId] || ss > spatialScores[ref.mapId]) spatialScores[ref.mapId] = ss;
		if (!riScores[ref.mapId] || rs > riScores[ref.mapId]) riScores[ref.mapId] = rs;
	}

	const mapIds = Object.keys(spatialScores);

	if (strategy === 'spatial') {
		const ranked = mapIds.map(id => ({ mapId: id, score: spatialScores[id] })).sort((a, b) => b.score - a.score);
		const gap = ranked.length > 1 ? ranked[0].score - ranked[1].score : ranked[0].score;
		return { mapId: ranked[0].mapId, gap };
	}

	if (strategy === 'ri') {
		const ranked = mapIds.map(id => ({ mapId: id, score: riScores[id] })).sort((a, b) => b.score - a.score);
		const gap = ranked.length > 1 ? ranked[0].score - ranked[1].score : ranked[0].score;
		return { mapId: ranked[0].mapId, gap };
	}

	// Combined: spatial primary, RI fallback when spatial gap is low
	const spatialRanked = mapIds.map(id => ({ mapId: id, score: spatialScores[id] })).sort((a, b) => b.score - a.score);
	const riRanked = mapIds.map(id => ({ mapId: id, score: riScores[id] })).sort((a, b) => b.score - a.score);
	const spatialGap = spatialRanked.length > 1 ? spatialRanked[0].score - spatialRanked[1].score : spatialRanked[0].score;
	const riGap = riRanked.length > 1 ? riRanked[0].score - riRanked[1].score : riRanked[0].score;

	if (spatialGap >= 0.03) {
		return { mapId: spatialRanked[0].mapId, gap: spatialGap };
	} else if (riGap > spatialGap) {
		return { mapId: riRanked[0].mapId, gap: riGap };
	} else {
		return { mapId: spatialRanked[0].mapId, gap: spatialGap };
	}
}

function resolveScreenshotPath(hash: string): string | null {
	for (const ext of ['png', 'jpg']) {
		const path = resolve('static', 'screenshots', `${hash}.${ext}`);
		if (existsSync(path)) return path;
	}
	return null;
}

async function main() {
	const staticRefs = await loadRefs(resolve('data', 'minimap-references', 'thumbs'));
	const learnedRefs = await loadRefs(resolve('data', 'minimap-references', 'learned'), true);
	console.log(`Static refs: ${staticRefs.length}, Learned refs: ${learnedRefs.length}\n`);

	const allMatches = await db
		.select({ matchId: schema.matches.matchId, map: schema.matches.map, screenshotHash: schema.matches.screenshotHash })
		.from(schema.matches)
		.where(isNotNull(schema.matches.screenshotHash));
	const withMap = allMatches.filter(m => m.map && m.screenshotHash);

	const pad = (s: string, n: number) => s.length > n ? s.slice(0, n) : s.padEnd(n);
	const counts = { staticSpatial: 0, staticRI: 0, staticCombined: 0, learnedSpatial: 0, learnedRI: 0, learnedCombined: 0 };
	let total = 0;

	console.log(`${'Hash'.padEnd(17)}| ${'Correct'.padEnd(32)}| Static:spat  | Static:RI    | Static:comb  | +Learn:spat  | +Learn:RI    | +Learn:comb`);
	console.log('-'.repeat(160));

	for (const match of withMap) {
		const ssPath = resolveScreenshotPath(match.screenshotHash!);
		if (!ssPath) continue;

		const thumb = await extractThumb(ssPath);
		const thumbRI = computeRI(thumb);
		total++;

		const correctMap = match.map!;

		// Fair leave-one-out for learned refs
		const fairLearned = learnedRefs.filter(r => r._hash !== match.screenshotHash);
		const allRefs = [...staticRefs, ...fairLearned];

		const results: { label: string; mapId: string; ok: boolean; countKey: keyof typeof counts }[] = [];
		for (const [label, refs, countPrefix] of [
			['Static', staticRefs, 'static'] as const,
			['+Learn', allRefs, 'learned'] as const,
		]) {
			for (const [stratLabel, strategy, countSuffix] of [
				['spat', 'spatial', 'Spatial'] as const,
				['RI', 'ri', 'RI'] as const,
				['comb', 'combined', 'Combined'] as const,
			]) {
				const r = detect(thumb, thumbRI, refs, strategy);
				const mapId = r?.mapId ?? '???';
				const ok = mapId === correctMap;
				const key = `${countPrefix}${countSuffix}` as keyof typeof counts;
				if (ok) counts[key]++;
				results.push({ label: `${label}:${stratLabel}`, mapId, ok, countKey: key });
			}
		}

		const cells = results.map(r => {
			const status = r.ok ? ' OK ' : 'MISS';
			return `${status} ${pad(r.mapId, 8)}`;
		}).join(' | ');

		console.log(`${match.screenshotHash} | ${pad(correctMap, 30)} | ${cells}`);
	}

	console.log('-'.repeat(160));
	console.log();
	console.log('Strategy comparison:');
	console.log(`  Static spatial:  ${counts.staticSpatial}/${total} (${((counts.staticSpatial/total)*100).toFixed(0)}%)`);
	console.log(`  Static RI:       ${counts.staticRI}/${total} (${((counts.staticRI/total)*100).toFixed(0)}%)`);
	console.log(`  Static combined: ${counts.staticCombined}/${total} (${((counts.staticCombined/total)*100).toFixed(0)}%)`);
	console.log(`  +Learn spatial:  ${counts.learnedSpatial}/${total} (${((counts.learnedSpatial/total)*100).toFixed(0)}%)`);
	console.log(`  +Learn RI:       ${counts.learnedRI}/${total} (${((counts.learnedRI/total)*100).toFixed(0)}%)`);
	console.log(`  +Learn combined: ${counts.learnedCombined}/${total} (${((counts.learnedCombined/total)*100).toFixed(0)}%)`);

	await client.end();
}

main().catch(async (e) => { console.error(e); await client.end(); process.exit(1); });
