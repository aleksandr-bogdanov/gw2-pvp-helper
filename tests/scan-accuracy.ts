/**
 * Scan accuracy test — sends real screenshots to Haiku and scores results.
 *
 * Usage:
 *   npx tsx tests/scan-accuracy.ts                    # run all fixtures
 *   npx tsx tests/scan-accuracy.ts skyhammer           # run one fixture
 *   npx tsx tests/scan-accuracy.ts --runs 3            # average over N runs
 *
 * Requires:
 *   - ANTHROPIC_API_KEY in .env
 *   - Screenshot PNGs in tests/fixtures/ matching filenames in expected.json
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// Load env
const envPath = resolve(ROOT, '.env');
if (existsSync(envPath)) {
	for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
		const match = line.match(/^([^#=]+)=(.*)$/);
		if (match) process.env[match[1].trim()] = match[2].trim();
	}
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

// Reference icon chart
const REFERENCE_IMAGE_PATH = resolve(ROOT, 'data/profession-icons/reference.png');
const referenceImageBase64 = readFileSync(REFERENCE_IMAGE_PATH).toString('base64');

// Import the same prompt used in production (inlined here so test is standalone)
import { readFile } from 'fs/promises';

interface ExpectedPlayer {
	character_name: string;
	profession_id: string;
	spec_id?: string;
	is_user?: boolean;
}

interface TestCase {
	id: string;
	image: string;
	expected: {
		user_team_color: 'red' | 'blue';
		red_team: ExpectedPlayer[];
		blue_team: ExpectedPlayer[];
	};
}

interface ScanResultPlayer {
	character_name: string;
	profession_id: string;
	spec_id: string;
	is_user: boolean;
}

interface ScanResult {
	user_team_color: string;
	red_team: ScanResultPlayer[];
	blue_team: ScanResultPlayer[];
}

// ─── Prompt (kept in sync with src/lib/server/scan.ts) ───

function getScanPrompts(): { system: string; user: string } {
	const scanPath = resolve(ROOT, 'src/lib/server/scan.ts');
	const source = readFileSync(scanPath, 'utf-8');

	const systemMatch = source.match(/const SCAN_SYSTEM = `([\s\S]*?)`;/);
	const userMatch = source.match(/const SCAN_PROMPT = `([\s\S]*?)`;/);

	return {
		system: systemMatch ? systemMatch[1] : '',
		user: userMatch ? userMatch[1] : ''
	};
}

// ─── Scoring ───

function levenshtein(a: string, b: string): number {
	const m = a.length,
		n = b.length;
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

function nameSimilarity(actual: string, expected: string): number {
	const a = actual.toLowerCase().trim();
	const e = expected.toLowerCase().trim();
	if (a === e) return 1;
	const maxLen = Math.max(a.length, e.length);
	if (maxLen === 0) return 1;
	return 1 - levenshtein(a, e) / maxLen;
}

interface TeamScore {
	nameScores: { expected: string; actual: string; similarity: number }[];
	professionCorrect: { expected: string; actual: string; correct: boolean }[];
	specCorrect: { expected: string; actual: string; correct: boolean }[];
	orderCorrect: boolean;
}

// Build a map from spec_id → profession_id using specs.json
const specsData = JSON.parse(readFileSync(resolve(__dirname, '../src/lib/specs.json'), 'utf-8'));
const specToProfession: Record<string, string> = {};
for (const [profId, prof] of Object.entries(specsData.professions) as [string, any][]) {
	for (const spec of prof.specs) {
		if (spec.id !== 'core') {
			specToProfession[spec.id] = profId;
		}
	}
}

// Normalize a spec_id from model output: derive profession, handle base profession names
function normalizeSpec(rawSpecId: string, rawProfessionId?: string): { specId: string; professionId: string } {
	const specId = (rawSpecId || 'core').toLowerCase();
	// If spec is a known elite spec, derive profession
	const derivedProf = specToProfession[specId];
	if (derivedProf) {
		return { specId, professionId: derivedProf };
	}
	// spec_id is a base profession name (model output "mesmer" instead of a spec)
	if (specsData.professions[specId]) {
		return { specId: 'core', professionId: specId };
	}
	// Fallback: use whatever profession_id the model gave
	return { specId, professionId: (rawProfessionId || specId).toLowerCase() };
}

function scoreTeam(actual: ScanResultPlayer[], expected: ExpectedPlayer[]): TeamScore {
	const nameScores: TeamScore['nameScores'] = [];
	const professionCorrect: TeamScore['professionCorrect'] = [];
	const specCorrect: TeamScore['specCorrect'] = [];

	const len = Math.max(actual.length, expected.length);
	let orderCorrect = true;

	for (let i = 0; i < len; i++) {
		const exp = expected[i];
		const act = actual[i];

		if (!exp || !act) {
			if (exp) {
				nameScores.push({ expected: exp.character_name, actual: '(missing)', similarity: 0 });
				professionCorrect.push({ expected: exp.profession_id, actual: '(missing)', correct: false });
				specCorrect.push({ expected: exp.spec_id || 'core', actual: '(missing)', correct: false });
			}
			orderCorrect = false;
			continue;
		}

		const sim = nameSimilarity(act.character_name, exp.character_name);
		nameScores.push({ expected: exp.character_name, actual: act.character_name, similarity: sim });

		// Normalize model output
		const norm = normalizeSpec(act.spec_id, act.profession_id);

		professionCorrect.push({
			expected: exp.profession_id,
			actual: norm.professionId,
			correct: norm.professionId === exp.profession_id.toLowerCase()
		});

		// Spec comparison
		const expectedSpec = (exp.spec_id || 'core').toLowerCase();
		specCorrect.push({
			expected: expectedSpec,
			actual: norm.specId,
			correct: norm.specId === expectedSpec
		});

		if (sim < 0.8) orderCorrect = false;
	}

	return { nameScores, professionCorrect, specCorrect, orderCorrect };
}

// ─── Image resize ───

async function resizeImage(inputBuffer: Buffer, format: 'jpeg' | 'png' | 'hires' = 'jpeg'): Promise<{ base64: string; mediaType: string }> {
	let pipeline = sharp(inputBuffer);

	if (format === 'hires') {
		// Original resolution, high-quality JPEG
		const resized = await pipeline.jpeg({ quality: 95 }).toBuffer();
		return { base64: resized.toString('base64'), mediaType: 'image/jpeg' };
	} else if (format === 'png') {
		const resized = await pipeline.resize(1920, 1080, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
		return { base64: resized.toString('base64'), mediaType: 'image/png' };
	} else {
		const resized = await pipeline.resize(2560, 1440, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
		return { base64: resized.toString('base64'), mediaType: 'image/jpeg' };
	}
}

// ─── Run scan ───

async function runScan(imageBase64: string, systemPrompt: string, userPrompt: string, mediaType: string = 'image/jpeg', model: string = 'claude-haiku-4-5-20251001', verbose: boolean = false): Promise<ScanResult> {
	const response = await anthropic.messages.create({
		model,
		max_tokens: 2048,
		temperature: 0,
		...(systemPrompt ? { system: systemPrompt } : {}),
		messages: [
			{
				role: 'user',
				content: [
					{
						type: 'image',
						source: { type: 'base64', media_type: 'image/png' as any, data: referenceImageBase64 }
					},
					{
						type: 'image',
						source: { type: 'base64', media_type: mediaType as any, data: imageBase64 }
					},
					{ type: 'text', text: userPrompt }
				]
			}
		]
	});

	const textBlock = response.content.find((b) => b.type === 'text');
	if (!textBlock || textBlock.type !== 'text') throw new Error('No text response');

	const fullText = textBlock.text.trim();
	if (verbose) {
		console.log('\n--- MODEL RESPONSE ---');
		console.log(fullText);
		console.log('--- END RESPONSE ---\n');
	}

	// Strip code fences first, then look for RESULT: marker
	let json = fullText;
	const fence = json.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
	if (fence) json = fence[1];
	const resultIdx = json.lastIndexOf('RESULT:');
	if (resultIdx !== -1) json = json.slice(resultIdx + 7).trim();

	return JSON.parse(json);
}

// ─── Main ───

async function main() {
	const args = process.argv.slice(2);
	let filterFixture: string | null = null;
	let runs = 1;
	let model = 'claude-haiku-4-5-20251001';
	let verbose = false;
	let imageFormat: 'jpeg' | 'png' | 'hires' = 'jpeg';

	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--runs' && args[i + 1]) {
			runs = parseInt(args[i + 1]);
			i++;
		} else if (args[i] === '--model' && args[i + 1]) {
			model = args[i + 1];
			i++;
		} else if (args[i] === '--verbose' || args[i] === '-v') {
			verbose = true;
		} else if (args[i] === '--png') {
			imageFormat = 'png';
		} else if (args[i] === '--hires') {
			imageFormat = 'hires';
		} else if (!args[i].startsWith('-')) {
			filterFixture = args[i];
		}
	}

	const fixtures: TestCase[] = JSON.parse(
		readFileSync(resolve(__dirname, 'fixtures/expected.json'), 'utf-8')
	);

	const { system: systemPrompt, user: userPrompt } = getScanPrompts();
	console.log(`Model: ${model} | Format: ${imageFormat}`);
	const testCases = filterFixture ? fixtures.filter((f) => f.id === filterFixture) : fixtures;

	if (testCases.length === 0) {
		console.error(`No fixture found matching "${filterFixture}"`);
		console.error('Available:', fixtures.map((f) => f.id).join(', '));
		process.exit(1);
	}

	let totalNames = 0;
	let totalNameScore = 0;
	let totalProfessions = 0;
	let totalProfessionCorrect = 0;
	let totalSpecs = 0;
	let totalSpecCorrect = 0;
	let totalUserCorrect = 0;
	let totalUserChecks = 0;
	let totalTeamColorCorrect = 0;
	let totalTeamColorChecks = 0;

	for (const tc of testCases) {
		const imgPath = resolve(__dirname, 'fixtures', tc.image);
		if (!existsSync(imgPath)) {
			console.error(`\n⚠ Skipping "${tc.id}" — image not found: ${imgPath}`);
			continue;
		}

		const rawBuffer = readFileSync(imgPath);
		const { base64: imageBase64, mediaType } = await resizeImage(rawBuffer, imageFormat);

		console.log(`\n${'═'.repeat(60)}`);
		console.log(`TEST: ${tc.id} (${runs} run${runs > 1 ? 's' : ''})`);
		console.log('═'.repeat(60));

		for (let run = 0; run < runs; run++) {
			if (runs > 1) console.log(`\n── Run ${run + 1}/${runs} ──`);

			const result = await runScan(imageBase64, systemPrompt, userPrompt, mediaType, model, verbose);

			// Team color
			const colorCorrect = result.user_team_color === tc.expected.user_team_color;
			totalTeamColorCorrect += colorCorrect ? 1 : 0;
			totalTeamColorChecks++;
			console.log(
				`\nTeam color: ${colorCorrect ? '✓' : '✗'} (got ${result.user_team_color}, expected ${tc.expected.user_team_color})`
			);

			// Score each team
			for (const team of ['red_team', 'blue_team'] as const) {
				const teamLabel = team === 'red_team' ? 'RED' : 'BLUE';
				const score = scoreTeam(result[team] || [], tc.expected[team]);

				console.log(`\n${teamLabel} TEAM:`);

				for (const ns of score.nameScores) {
					const pct = Math.round(ns.similarity * 100);
					const icon = ns.similarity === 1 ? '✓' : ns.similarity >= 0.8 ? '~' : '✗';
					console.log(`  ${icon} "${ns.actual}" vs "${ns.expected}" (${pct}%)`);
					totalNames++;
					totalNameScore += ns.similarity;
				}

				for (let pi = 0; pi < score.professionCorrect.length; pi++) {
					const pc = score.professionCorrect[pi];
					const sc = score.specCorrect[pi];
					const profIcon = pc.correct ? '✓' : '✗';
					const specIcon = sc.correct ? '✓' : '✗';
					console.log(`  ${profIcon} prof: ${pc.actual} (expected ${pc.expected})  ${specIcon} spec: ${sc.actual} (expected ${sc.expected})`);
					totalProfessions++;
					totalProfessionCorrect += pc.correct ? 1 : 0;
					totalSpecs++;
					totalSpecCorrect += sc.correct ? 1 : 0;
				}
			}

			// User detection
			const allActual = [...(result.red_team || []), ...(result.blue_team || [])];
			const allExpected = [...tc.expected.red_team, ...tc.expected.blue_team];
			const expectedUser = allExpected.find((p) => p.is_user);
			const actualUser = allActual.find((p) => p.is_user);

			if (expectedUser) {
				totalUserChecks++;
				const userCorrect =
					actualUser &&
					nameSimilarity(actualUser.character_name, expectedUser.character_name) >= 0.8;
				totalUserCorrect += userCorrect ? 1 : 0;
				console.log(
					`\nUser detection: ${userCorrect ? '✓' : '✗'} (got "${actualUser?.character_name ?? 'none'}", expected "${expectedUser.character_name}")`
				);
			}
		}
	}

	// Summary
	console.log(`\n${'═'.repeat(60)}`);
	console.log('SUMMARY');
	console.log('═'.repeat(60));
	console.log(
		`Name accuracy:       ${Math.round((totalNameScore / Math.max(totalNames, 1)) * 100)}% avg similarity (${totalNames} names)`
	);
	console.log(
		`Profession accuracy: ${Math.round((totalProfessionCorrect / Math.max(totalProfessions, 1)) * 100)}% (${totalProfessionCorrect}/${totalProfessions})`
	);
	console.log(
		`Spec accuracy:       ${Math.round((totalSpecCorrect / Math.max(totalSpecs, 1)) * 100)}% (${totalSpecCorrect}/${totalSpecs})`
	);
	console.log(
		`Team color accuracy: ${Math.round((totalTeamColorCorrect / Math.max(totalTeamColorChecks, 1)) * 100)}% (${totalTeamColorCorrect}/${totalTeamColorChecks})`
	);
	console.log(
		`User detection:      ${Math.round((totalUserCorrect / Math.max(totalUserChecks, 1)) * 100)}% (${totalUserCorrect}/${totalUserChecks})`
	);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
