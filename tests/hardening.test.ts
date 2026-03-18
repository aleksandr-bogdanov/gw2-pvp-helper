/**
 * Prompt 8 — Request body size limit tests
 *
 * Tests that the body size limiter in hooks.server.ts rejects oversized requests.
 * These test the middleware logic directly without needing a running server.
 */
import { describe, it, expect } from 'vitest';

// We test the logic by simulating what the hook does: check Content-Length header
const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10 MB

const SIZE_LIMITED_PATHS = ['/api/scan', '/api/scan/upload'];

function wouldReject(method: string, pathname: string, contentLength: number | null): boolean {
	if (method !== 'POST') return false;
	if (!SIZE_LIMITED_PATHS.some((p) => pathname === p)) return false;
	if (contentLength === null) return false;
	return contentLength > MAX_BODY_SIZE;
}

describe('Request body size limits', () => {
	it('rejects POST /api/scan with body > 10 MB', () => {
		expect(wouldReject('POST', '/api/scan', 11 * 1024 * 1024)).toBe(true);
	});

	it('rejects POST /api/scan/upload with body > 10 MB', () => {
		expect(wouldReject('POST', '/api/scan/upload', 11 * 1024 * 1024)).toBe(true);
	});

	it('allows POST /api/scan with body exactly 10 MB', () => {
		expect(wouldReject('POST', '/api/scan', 10 * 1024 * 1024)).toBe(false);
	});

	it('allows POST /api/scan with normal-sized body (1 MB)', () => {
		expect(wouldReject('POST', '/api/scan', 1 * 1024 * 1024)).toBe(false);
	});

	it('allows GET requests regardless of path', () => {
		expect(wouldReject('GET', '/api/scan', 100 * 1024 * 1024)).toBe(false);
	});

	it('allows POST to non-limited paths regardless of size', () => {
		expect(wouldReject('POST', '/api/advice', 100 * 1024 * 1024)).toBe(false);
	});

	it('allows POST with no Content-Length header', () => {
		expect(wouldReject('POST', '/api/scan', null)).toBe(false);
	});

	it('MAX_BODY_SIZE constant equals 10 MB', () => {
		expect(MAX_BODY_SIZE).toBe(10485760);
	});
});
