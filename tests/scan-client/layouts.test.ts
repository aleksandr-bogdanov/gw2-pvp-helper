/**
 * Tests for layout presets and position calculations.
 *
 * Pure math — no Canvas/fetch/DB dependencies.
 */
import { describe, it, expect } from 'vitest';
import { getLayout, computeIconPositions, computeNameRegions, detectMode } from '$lib/scan-client/layouts.js';

describe('getLayout', () => {
	it('returns valid layout for all 8 presets', () => {
		const sizes = ['small', 'normal', 'large', 'larger'] as const;
		const modes = ['conquest', 'push'] as const;

		for (const size of sizes) {
			for (const mode of modes) {
				const layout = getLayout(size, mode);
				expect(layout.cropSize).toBeGreaterThan(0);
				expect(layout.rowSpacing).toBeGreaterThan(0);
				expect(layout.redXOffset).toBeLessThan(0); // Always left of anchor
				expect(layout.blueXOffset).toBeLessThan(0); // Always left of anchor
			}
		}
	});

	it('throws for unknown layout key', () => {
		// @ts-expect-error testing invalid input
		expect(() => getLayout('invalid', 'conquest')).toThrow('Unknown layout');
	});

	it('push layouts have larger (less negative) redXOffset than conquest', () => {
		// Push panels are narrower, so red icons are closer to anchor
		const sizes = ['small', 'normal', 'large', 'larger'] as const;
		for (const size of sizes) {
			const conquest = getLayout(size, 'conquest');
			const push = getLayout(size, 'push');
			expect(push.redXOffset).toBeGreaterThan(conquest.redXOffset);
		}
	});
});

describe('computeIconPositions', () => {
	it('returns 5 red and 5 blue positions', () => {
		const layout = getLayout('normal', 'conquest');
		const positions = computeIconPositions(2200, 250, layout);

		expect(positions.red).toHaveLength(5);
		expect(positions.blue).toHaveLength(5);
	});

	it('positions are vertically spaced by rowSpacing', () => {
		const layout = getLayout('normal', 'conquest');
		const positions = computeIconPositions(2200, 250, layout);

		for (let i = 1; i < 5; i++) {
			const gap = positions.red[i].y - positions.red[i - 1].y;
			expect(gap).toBe(layout.rowSpacing);
		}
	});

	it('red positions are to the left of blue positions', () => {
		const layout = getLayout('normal', 'conquest');
		const positions = computeIconPositions(2200, 250, layout);

		for (let i = 0; i < 5; i++) {
			expect(positions.red[i].x).toBeLessThan(positions.blue[i].x);
		}
	});
});

describe('computeNameRegions', () => {
	it('returns 5 red and 5 blue regions', () => {
		const layout = getLayout('normal', 'conquest');
		const regions = computeNameRegions(2200, 250, layout);

		expect(regions.red).toHaveLength(5);
		expect(regions.blue).toHaveLength(5);
	});

	it('all regions have positive width and height', () => {
		const layout = getLayout('normal', 'conquest');
		const regions = computeNameRegions(2200, 250, layout);

		for (const r of [...regions.red, ...regions.blue]) {
			expect(r.width).toBeGreaterThan(0);
			expect(r.height).toBeGreaterThan(0);
		}
	});

	it('red name regions are to the right of red icon positions', () => {
		const layout = getLayout('normal', 'conquest');
		const icons = computeIconPositions(2200, 250, layout);
		const names = computeNameRegions(2200, 250, layout);

		for (let i = 0; i < 5; i++) {
			expect(names.red[i].x).toBeGreaterThan(icons.red[i].x);
		}
	});

	it('blue name regions are to the left of blue icon positions', () => {
		const layout = getLayout('normal', 'conquest');
		const icons = computeIconPositions(2200, 250, layout);
		const names = computeNameRegions(2200, 250, layout);

		for (let i = 0; i < 5; i++) {
			expect(names.blue[i].x + names.blue[i].width).toBeLessThan(icons.blue[i].x);
		}
	});
});

describe('detectMode', () => {
	it('returns conquest for y <= 300', () => {
		expect(detectMode(200)).toBe('conquest');
		expect(detectMode(300)).toBe('conquest');
	});

	it('returns push for y > 300', () => {
		expect(detectMode(301)).toBe('push');
		expect(detectMode(400)).toBe('push');
	});
});
