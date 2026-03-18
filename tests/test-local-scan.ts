/**
 * Test harness for the local CV scan pipeline.
 *
 * Validates:
 * 1. Anchor detection against align-crops.json ground truth (23 screenshots)
 * 2. Icon classification accuracy against expected.json (4 labeled fixtures)
 * 3. End-to-end pipeline (anchor + classify + OCR) on labeled fixtures
 *
 * Current results (2026-03-09):
 *   --anchor-only:   23/23 (100%), 2.27px avg crop error, ~38s total
 *   --classify-only: 39/40 (97.5%), 0.4s total
 *   --e2e:           97.5% spec, ~80% names, ~3.3s per fixture
 *
 * Note: anchor test reports mode errors for 5 moved-window screenshots.
 * These are corrected by minimap detection in the real pipeline (index.ts).
 *
 * Usage:
 *   npx tsx tests/test-local-scan.ts                    # Run all tests
 *   npx tsx tests/test-local-scan.ts --anchor-only      # Just anchor detection
 *   npx tsx tests/test-local-scan.ts --classify-only    # Just icon classification
 *   npx tsx tests/test-local-scan.ts --e2e              # Full end-to-end on labeled fixtures
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import sharp from 'sharp';

const PROJECT_ROOT = resolve(import.meta.dirname, '..');
const FIXTURES_DIR = resolve(PROJECT_ROOT, 'tests/fixtures');
const ALIGN_CROPS_PATH = resolve(FIXTURES_DIR, 'align-crops.json');
const EXPECTED_PATH = resolve(FIXTURES_DIR, 'expected.json');

// Parse CLI args
const args = process.argv.slice(2);
const anchorOnly = args.includes('--anchor-only');
const classifyOnly = args.includes('--classify-only');
const e2eOnly = args.includes('--e2e');
const runAll = !anchorOnly && !classifyOnly && !e2eOnly;

interface AlignCropsData {
	screenshots: Record<
		string,
		{
			anchor: { x: number; y: number };
			row_spacing: number;
			crop_size: number;
			crops: {
				red: { x: number; y: number }[];
				blue: { x: number; y: number }[];
			};
		}
	>;
}

// ─── Anchor Detection Test ───────────────────────────────────────────

async function testAnchorDetection() {
	console.log('\n=== Anchor Detection Test ===\n');

	const { loadImageGrayscale, loadImageRGB } = await import(
		'../src/lib/server/scan/preprocess.js'
	);
	const { findAnchor } = await import('../src/lib/server/scan/anchor.js');

	const alignCrops: AlignCropsData = JSON.parse(readFileSync(ALIGN_CROPS_PATH, 'utf-8'));
	const screenshots = alignCrops.screenshots;

	let detected = 0;
	let total = 0;
	let totalAnchorErr = 0;
	let totalCropErr = 0;
	let totalCrops = 0;

	for (const [filename, gt] of Object.entries(screenshots)) {
		total++;
		const filePath = resolve(FIXTURES_DIR, filename);

		let imageBuffer: Buffer;
		try {
			imageBuffer = readFileSync(filePath);
		} catch {
			console.log(`  SKIP ${filename} (file not found)`);
			total--;
			continue;
		}

		const grayImage = await loadImageGrayscale(imageBuffer);
		const rgbImage = await loadImageRGB(imageBuffer);
		const anchor = await findAnchor(grayImage, { rgbImage });

		if (!anchor) {
			console.log(`  FAIL ${filename.slice(0, 45).padEnd(45)} — no anchor found`);
			continue;
		}

		detected++;
		const anchorErr = Math.abs(anchor.x - gt.anchor.x) + Math.abs(anchor.y - gt.anchor.y);
		totalAnchorErr += anchorErr;

		// Check crop positions
		const { computeIconPositions, getLayout } = await import(
			'../src/lib/server/scan/layouts.js'
		);
		const layout = getLayout(anchor.uiSize, anchor.mode);
		const positions = computeIconPositions(anchor.x, anchor.y, layout);

		let maxCropErr = 0;
		for (const team of ['red', 'blue'] as const) {
			for (let i = 0; i < 5; i++) {
				const det = positions[team][i];
				const gtCrop = gt.crops[team][i];
				const err = Math.abs(det.x - gtCrop.x) + Math.abs(det.y - gtCrop.y);
				maxCropErr = Math.max(maxCropErr, err);
				totalCropErr += err;
				totalCrops++;
			}
		}

		const status = maxCropErr <= 2 ? 'OK  ' : maxCropErr <= 5 ? 'WARN' : 'FAIL';
		console.log(
			`  ${status} ${filename.slice(0, 45).padEnd(45)} anchor_err=${anchorErr.toString().padStart(2)} max_crop_err=${maxCropErr.toString().padStart(2)} ` +
				`ui=${anchor.uiSize.padEnd(6)} mode=${anchor.mode.padEnd(8)} score=${anchor.score.toFixed(3)}`
		);
	}

	const avgCropErr = totalCrops > 0 ? totalCropErr / totalCrops : 0;
	console.log(`\n  Detection rate: ${detected}/${total} (${((detected / total) * 100).toFixed(0)}%)`);
	console.log(`  Average crop error: ${avgCropErr.toFixed(2)}px across ${totalCrops} crops`);
}

// ─── Icon Classification Test ────────────────────────────────────────

async function testIconClassification() {
	console.log('\n=== Icon Classification Test ===\n');

	const { loadImageGrayscale } = await import('../src/lib/server/scan/preprocess.js');
	const { extractROI } = await import('../src/lib/server/scan/preprocess.js');
	const { classifyIcon, warmupClassifier } = await import(
		'../src/lib/server/scan/classifier.js'
	);

	await warmupClassifier();

	const alignCrops: AlignCropsData = JSON.parse(readFileSync(ALIGN_CROPS_PATH, 'utf-8'));
	const expected: {
		id: string;
		image: string;
		expected: {
			red_team: { spec_id: string }[];
			blue_team: { spec_id: string }[];
		};
	}[] = JSON.parse(readFileSync(EXPECTED_PATH, 'utf-8'));

	let correct = 0;
	let total = 0;

	for (const fixture of expected) {
		const gt = alignCrops.screenshots[fixture.image];
		if (!gt) {
			console.log(`  SKIP ${fixture.id} — not in align-crops.json`);
			continue;
		}

		const filePath = resolve(FIXTURES_DIR, fixture.image);
		let imageBuffer: Buffer;
		try {
			imageBuffer = readFileSync(filePath);
		} catch {
			console.log(`  SKIP ${fixture.id} — file not found`);
			continue;
		}

		const grayImage = await loadImageGrayscale(imageBuffer);
		const half = Math.floor(gt.crop_size / 2);

		console.log(`  ${fixture.id}:`);

		for (const team of ['red', 'blue'] as const) {
			const expectedTeam =
				team === 'red' ? fixture.expected.red_team : fixture.expected.blue_team;

			for (let i = 0; i < 5; i++) {
				const pos = gt.crops[team][i];
				const crop = extractROI(
					grayImage,
					pos.x - half,
					pos.y - half,
					gt.crop_size,
					gt.crop_size
				);

				const result = await classifyIcon(crop);
				const expectedSpec = expectedTeam[i].spec_id;
				const match = result.specId === expectedSpec;
				if (match) correct++;
				total++;

				const icon = match ? '✓' : '✗';
				if (!match) {
					console.log(
						`    ${icon} ${team}[${i}]: expected=${expectedSpec}, got=${result.specId} (conf=${result.confidence.toFixed(3)})`
					);
				}
			}
		}
	}

	console.log(
		`\n  Accuracy: ${correct}/${total} (${((correct / total) * 100).toFixed(1)}%)`
	);
}

// ─── End-to-End Test ─────────────────────────────────────────────────

async function testEndToEnd() {
	console.log('\n=== End-to-End Pipeline Test ===\n');

	const { scanScreenshot } = await import('../src/lib/server/scan/index.js');

	const expected: {
		id: string;
		image: string;
		expected: {
			user_team_color: string;
			red_team: { character_name: string; profession_id: string; spec_id: string }[];
			blue_team: { character_name: string; profession_id: string; spec_id: string }[];
		};
	}[] = JSON.parse(readFileSync(EXPECTED_PATH, 'utf-8'));

	for (const fixture of expected) {
		const filePath = resolve(FIXTURES_DIR, fixture.image);
		let imageBuffer: Buffer;
		try {
			imageBuffer = readFileSync(filePath);
		} catch {
			console.log(`  SKIP ${fixture.id} — file not found`);
			continue;
		}

		const base64 = imageBuffer.toString('base64');
		const start = Date.now();

		try {
			const result = await scanScreenshot(base64, 'image/png');
			const elapsed = Date.now() - start;

			console.log(`  ${fixture.id} (${elapsed}ms):`);

			let specCorrect = 0;
			let nameScore = 0;
			const totalPlayers = 10;

			for (const team of ['red', 'blue'] as const) {
				const detectedTeam = team === 'red' ? result.red_team : result.blue_team;
				const expectedTeam =
					team === 'red' ? fixture.expected.red_team : fixture.expected.blue_team;

				for (let i = 0; i < 5; i++) {
					const det = detectedTeam[i];
					const exp = expectedTeam[i];

					const specMatch = det.spec_id === exp.spec_id;
					if (specMatch) specCorrect++;

					// Simple name similarity (case-insensitive Levenshtein-like)
					const nameSim = stringSimilarity(
						det.character_name.toLowerCase(),
						exp.character_name.toLowerCase()
					);
					nameScore += nameSim;

					const specIcon = specMatch ? '✓' : '✗';
					const nameIcon = nameSim > 0.8 ? '✓' : nameSim > 0.5 ? '~' : '✗';
					console.log(
						`    ${team}[${i}] spec:${specIcon} name:${nameIcon} | "${det.character_name}" (${det.spec_id}) vs "${exp.character_name}" (${exp.spec_id})`
					);
				}
			}

			console.log(
				`    Spec: ${specCorrect}/${totalPlayers}, Names: ${((nameScore / totalPlayers) * 100).toFixed(0)}%\n`
			);
		} catch (err) {
			const elapsed = Date.now() - start;
			console.log(`  FAIL ${fixture.id} (${elapsed}ms): ${err}`);
		}
	}
}

// ─── Helpers ─────────────────────────────────────────────────────────

function stringSimilarity(a: string, b: string): number {
	if (a === b) return 1;
	if (a.length === 0 || b.length === 0) return 0;

	const matrix: number[][] = [];
	for (let i = 0; i <= a.length; i++) {
		matrix[i] = [i];
	}
	for (let j = 0; j <= b.length; j++) {
		matrix[0][j] = j;
	}

	for (let i = 1; i <= a.length; i++) {
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			matrix[i][j] = Math.min(
				matrix[i - 1][j] + 1,
				matrix[i][j - 1] + 1,
				matrix[i - 1][j - 1] + cost
			);
		}
	}

	const maxLen = Math.max(a.length, b.length);
	return 1 - matrix[a.length][b.length] / maxLen;
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
	const startTime = Date.now();

	if (runAll || anchorOnly) {
		await testAnchorDetection();
	}

	if (runAll || classifyOnly) {
		await testIconClassification();
	}

	if (runAll || e2eOnly) {
		await testEndToEnd();
	}

	console.log(`\nTotal time: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
}

main().catch(console.error);
