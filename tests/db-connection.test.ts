/**
 * Prompt 8 — Database connection pool configuration test
 *
 * Verifies that the postgres client is configured with max: 10 connections.
 * We read the source file directly since the postgres driver options are set at module level.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('Database connection pooling', () => {
	it('db/index.ts configures postgres with max: 10', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/server/db/index.ts'),
			'utf-8'
		);
		// Verify the postgres constructor is called with max: 10
		expect(source).toMatch(/postgres\(DATABASE_URL,\s*\{\s*max:\s*10\s*\}\)/);
	});

	it('max connections is explicitly 10, not any other value', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/server/db/index.ts'),
			'utf-8'
		);
		const match = source.match(/max:\s*(\d+)/);
		expect(match).not.toBeNull();
		expect(parseInt(match![1], 10)).toBe(10);
	});
});
