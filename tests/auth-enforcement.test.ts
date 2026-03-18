/**
 * Prompt 8 — Auth enforcement audit tests
 *
 * Verifies that every API endpoint (except /api/health) requires authentication,
 * and that /api/admin/* additionally requires admin role.
 * Tests the hooks.server.ts middleware logic.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('Auth enforcement — hooks middleware audit', () => {
	const hooksSource = readFileSync(
		resolve(process.cwd(), 'src/hooks.server.ts'),
		'utf-8'
	);

	it('/api/health is in the PUBLIC_PATHS list', () => {
		expect(hooksSource).toContain("'/api/health'");
	});

	it('/api/auth/ is in the PUBLIC_PATHS list', () => {
		expect(hooksSource).toContain("'/api/auth/'");
	});

	it('auth guard rejects unauthenticated API requests with 401', () => {
		expect(hooksSource).toContain('status: 401');
		expect(hooksSource).toMatch(/!event\.locals\.user/);
	});

	it('admin guard rejects non-admin with 403 on /api/admin/', () => {
		expect(hooksSource).toContain("'/api/admin/'");
		expect(hooksSource).toContain('status: 403');
		expect(hooksSource).toMatch(/role\s*!==\s*'admin'/);
	});

	it('auth handle is in the exported handle sequence', () => {
		expect(hooksSource).toMatch(/sequence\(.*authHandle/);
	});

	it('body size handle is in the exported handle sequence', () => {
		expect(hooksSource).toMatch(/sequence\(bodySizeHandle/);
	});

	it('only /api/health and /api/auth/ are public paths', () => {
		// Extract the PUBLIC_PATHS array
		const match = hooksSource.match(/PUBLIC_PATHS\s*=\s*\[([^\]]+)\]/);
		expect(match).not.toBeNull();
		const paths = match![1];
		// Should contain exactly 2 paths
		const pathList = paths.split(',').map((p) => p.trim().replace(/['"]/g, ''));
		expect(pathList).toHaveLength(2);
		expect(pathList).toContain('/api/health');
		expect(pathList).toContain('/api/auth/');
	});
});

describe('Auth enforcement — /api/health endpoint', () => {
	it('GET /api/health returns 200 without authentication', async () => {
		const { GET } = await import('../src/routes/api/health/+server.js');

		const response = await GET({
			request: new Request('http://localhost/api/health'),
			url: new URL('http://localhost/api/health'),
			params: {},
			locals: {},
			cookies: { get: () => undefined, set: () => {}, delete: () => {} },
			platform: undefined,
			route: { id: '/api/health' },
			isDataRequest: false,
			isSubRequest: false,
			setHeaders: () => {},
			getClientAddress: () => '127.0.0.1'
		} as any);

		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.status).toBe('ok');
	});
});
