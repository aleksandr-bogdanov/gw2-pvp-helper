/**
 * Tests for the full client-side scan pipeline.
 *
 * Most tests are skipped because jsdom doesn't support Canvas/OffscreenCanvas/ImageBitmap.
 * The real validation is manual testing with actual GW2 screenshots in a browser.
 */
import { describe, it, expect, test } from 'vitest';

describe('scan-client/pipeline', () => {
	it('module exports scanScreenshotClient function', async () => {
		const mod = await import('$lib/scan-client/index.js');
		expect(typeof mod.scanScreenshotClient).toBe('function');
	});

	it('module exports hasLowConfidence function', async () => {
		const mod = await import('$lib/scan-client/index.js');
		expect(typeof mod.hasLowConfidence).toBe('function');
	});

	it('module exports blobToJpegBase64 function', async () => {
		const mod = await import('$lib/scan-client/index.js');
		expect(typeof mod.blobToJpegBase64).toBe('function');
	});

	it('hasLowConfidence detects low spec confidence', async () => {
		const { hasLowConfidence } = await import('$lib/scan-client/index.js');

		const result = {
			user_team_color: 'red' as const,
			red_team: [
				{ character_name: 'Player 1', profession_id: 'warrior', spec_id: 'berserker', role: 'dps', is_user: false, spec_confidence: 0.5, name_confidence: 80 },
				{ character_name: 'Player 2', profession_id: 'thief', spec_id: 'daredevil', role: 'dps', is_user: false, spec_confidence: 0.95, name_confidence: 90 },
				{ character_name: 'Player 3', profession_id: 'mesmer', spec_id: 'chronomancer', role: 'support', is_user: false, spec_confidence: 0.9, name_confidence: 85 },
				{ character_name: 'Player 4', profession_id: 'guardian', spec_id: 'firebrand', role: 'support', is_user: false, spec_confidence: 0.88, name_confidence: 75 },
				{ character_name: 'Player 5', profession_id: 'necromancer', spec_id: 'scourge', role: 'dps', is_user: false, spec_confidence: 0.92, name_confidence: 82 }
			],
			blue_team: [
				{ character_name: 'Player 6', profession_id: 'elementalist', spec_id: 'weaver', role: 'dps', is_user: false, spec_confidence: 0.91, name_confidence: 88 },
				{ character_name: 'Player 7', profession_id: 'ranger', spec_id: 'druid', role: 'support', is_user: false, spec_confidence: 0.87, name_confidence: 70 },
				{ character_name: 'Player 8', profession_id: 'revenant', spec_id: 'herald', role: 'dps', is_user: false, spec_confidence: 0.93, name_confidence: 91 },
				{ character_name: 'Player 9', profession_id: 'engineer', spec_id: 'holosmith', role: 'dps', is_user: false, spec_confidence: 0.89, name_confidence: 78 },
				{ character_name: 'Player 10', profession_id: 'warrior', spec_id: 'spellbreaker', role: 'dps', is_user: false, spec_confidence: 0.94, name_confidence: 85 }
			]
		};

		// Player 1 has spec_confidence 0.5 < 0.85 → should trigger
		expect(hasLowConfidence(result)).toBe(true);
	});

	it('hasLowConfidence returns false when all confidence is high', async () => {
		const { hasLowConfidence } = await import('$lib/scan-client/index.js');

		const result = {
			user_team_color: 'red' as const,
			red_team: Array.from({ length: 5 }, (_, i) => ({
				character_name: `Player ${i + 1}`,
				profession_id: 'warrior',
				spec_id: 'berserker',
				role: 'dps',
				is_user: false,
				spec_confidence: 0.9,
				name_confidence: 80
			})),
			blue_team: Array.from({ length: 5 }, (_, i) => ({
				character_name: `Player ${i + 6}`,
				profession_id: 'thief',
				spec_id: 'daredevil',
				role: 'dps',
				is_user: false,
				spec_confidence: 0.95,
				name_confidence: 85
			}))
		};

		expect(hasLowConfidence(result)).toBe(false);
	});

	it('hasLowConfidence detects low name confidence', async () => {
		const { hasLowConfidence } = await import('$lib/scan-client/index.js');

		const result = {
			user_team_color: 'red' as const,
			red_team: Array.from({ length: 5 }, (_, i) => ({
				character_name: `Player ${i + 1}`,
				profession_id: 'warrior',
				spec_id: 'berserker',
				role: 'dps',
				is_user: false,
				spec_confidence: 0.95,
				name_confidence: i === 0 ? 30 : 80 // First player has low name confidence
			})),
			blue_team: Array.from({ length: 5 }, (_, i) => ({
				character_name: `Player ${i + 6}`,
				profession_id: 'thief',
				spec_id: 'daredevil',
				role: 'dps',
				is_user: false,
				spec_confidence: 0.9,
				name_confidence: 85
			}))
		};

		expect(hasLowConfidence(result)).toBe(true);
	});

	// Canvas-dependent tests — real validation is manual
	test.skip('full scanScreenshotClient() produces valid ScanResult shape', async () => {
		// Would need: real browser with Canvas + fetch mocking
		// Expected: result has 5 red_team + 5 blue_team entries
		// Each entry has character_name, profession_id, spec_id, confidence
	});

	test.skip('ScanResult has 5 red_team + 5 blue_team entries', async () => {
		// Requires full pipeline execution with a test screenshot
	});

	test.skip('each entry has character_name, profession_id, spec_id, confidence', async () => {
		// Requires full pipeline execution
	});

	test.skip('confidence scores populated for all slots', async () => {
		// Requires full pipeline execution
	});
});
