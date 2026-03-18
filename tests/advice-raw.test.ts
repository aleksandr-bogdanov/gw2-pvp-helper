import { describe, it, expect } from 'vitest';
import { matches } from '../src/lib/server/db/schema.js';

describe('advice_raw column', () => {
	it('matches table has adviceRaw column', () => {
		expect(matches.adviceRaw).toBeDefined();
	});

	it('advice_raw is a text column', () => {
		expect(matches.adviceRaw.name).toBe('advice_raw');
		expect(matches.adviceRaw.dataType).toBe('string');
	});

	it('advice_raw is nullable (no notNull constraint)', () => {
		// advice_raw should be nullable — it's populated after streaming completes
		expect(matches.adviceRaw.notNull).toBeFalsy();
	});

	it('adviceText and adviceRaw coexist in schema', () => {
		// Both columns must exist — adviceText is the formatted version,
		// adviceRaw is the raw model output for debugging
		const columnNames = Object.keys(matches);
		expect(columnNames).toContain('adviceText');
		expect(columnNames).toContain('adviceRaw');
	});

	it('advice endpoint file imports matches schema', async () => {
		const { readFileSync } = require('fs');
		const { resolve } = require('path');
		const advicePath = resolve(process.cwd(), 'src/routes/api/advice/+server.ts');
		const content = readFileSync(advicePath, 'utf-8');

		expect(content).toContain('matches');
		expect(content).toContain('adviceRaw');
	});

	it('advice endpoint concatenates streamed text chunks', async () => {
		const { readFileSync } = require('fs');
		const { resolve } = require('path');
		const advicePath = resolve(process.cwd(), 'src/routes/api/advice/+server.ts');
		const content = readFileSync(advicePath, 'utf-8');

		// Should have rawChunks array that collects text deltas
		expect(content).toContain('rawChunks');
		expect(content).toContain("rawChunks.join('')");
	});

	it('advice endpoint accepts matchId parameter', async () => {
		const { readFileSync } = require('fs');
		const { resolve } = require('path');
		const advicePath = resolve(process.cwd(), 'src/routes/api/advice/+server.ts');
		const content = readFileSync(advicePath, 'utf-8');

		expect(content).toContain('matchId');
	});
});
