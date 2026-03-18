import { describe, it, expect } from 'vitest';
import { specs, maps, getSpecsForProfession, getProfessionForSpec } from '$lib/game-data';

describe('game data loads correctly', () => {
	it('specs has all 9 professions', () => {
		const profIds = Object.keys(specs.professions);
		expect(profIds).toHaveLength(9);
		expect(profIds).toContain('warrior');
		expect(profIds).toContain('guardian');
		expect(profIds).toContain('mesmer');
	});

	it('each profession has at least 3 elite specs', () => {
		for (const [profId, prof] of Object.entries(specs.professions)) {
			expect(prof.specs.length, `${profId} should have >=3 specs`).toBeGreaterThanOrEqual(3);
		}
	});

	it('maps array is non-empty', () => {
		expect(maps.length).toBeGreaterThan(0);
	});

	it('getSpecsForProfession returns specs for warrior', () => {
		const warriorSpecs = getSpecsForProfession('warrior');
		expect(warriorSpecs.length).toBeGreaterThanOrEqual(3);
	});

	it('getProfessionForSpec resolves paragon to warrior', () => {
		expect(getProfessionForSpec('paragon')).toBe('warrior');
	});
});
