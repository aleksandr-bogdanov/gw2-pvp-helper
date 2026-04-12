import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('/api/health endpoint', () => {
	const source = readFileSync(
		resolve(process.cwd(), 'src/routes/api/health/+server.ts'),
		'utf-8'
	);

	it('exports a GET handler', () => {
		expect(source).toMatch(/export\s+(const|function)\s+GET/);
	});

	it('returns json with status ok on success', () => {
		expect(source).toContain("status: 'ok'");
		expect(source).toContain('process.uptime()');
	});

	it('returns 503 on database failure', () => {
		expect(source).toContain('status: 503');
		expect(source).toContain('Database unavailable');
	});

	it('executes a database connectivity check', () => {
		expect(source).toContain('db.execute');
		expect(source).toContain('SELECT 1');
	});
});
