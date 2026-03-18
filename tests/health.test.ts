import { describe, it, expect } from 'vitest';

describe('/api/health endpoint', () => {
	it('GET handler returns 200 with {status: ok} and numeric uptime', async () => {
		// Import the handler directly — avoids needing a running server
		const { GET } = await import('../src/routes/api/health/+server.js');

		// Minimal mock of SvelteKit's RequestHandler event
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
		expect(body).toHaveProperty('status', 'ok');
		expect(body).toHaveProperty('uptime');
		expect(typeof body.uptime).toBe('number');
		expect(body.uptime).toBeGreaterThanOrEqual(0);
	});
});
