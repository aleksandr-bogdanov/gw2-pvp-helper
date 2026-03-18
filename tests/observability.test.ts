import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Sentry initialization', () => {
	it('initializes without throwing when SENTRY_DSN is set', async () => {
		const Sentry = await import('@sentry/sveltekit');
		expect(() => {
			Sentry.init({
				dsn: 'https://examplePublicKey@o0.ingest.sentry.io/0',
				tracesSampleRate: 0,
				environment: 'test'
			});
		}).not.toThrow();
	});

	it('skips gracefully when SENTRY_DSN is missing (empty)', async () => {
		const Sentry = await import('@sentry/sveltekit');
		// Init with empty DSN should not throw — Sentry just becomes a no-op
		expect(() => {
			Sentry.init({
				dsn: '',
				tracesSampleRate: 0,
				environment: 'test'
			});
		}).not.toThrow();
	});
});

describe('Honeycomb/OpenTelemetry initialization', () => {
	it('skips gracefully when HONEYCOMB_API_KEY is missing', async () => {
		// Ensure env var is not set
		const original = process.env.HONEYCOMB_API_KEY;
		delete process.env.HONEYCOMB_API_KEY;

		// Our initTelemetry should not throw
		const { initTelemetry } = await import('$lib/server/telemetry.js');
		await expect(initTelemetry()).resolves.not.toThrow();

		// Restore
		if (original) process.env.HONEYCOMB_API_KEY = original;
	});
});

describe('Custom span creation', () => {
	it('withSpan does not throw and returns the value', async () => {
		const { withSpan } = await import('$lib/server/telemetry.js');
		const result = await withSpan('test.span', { 'test.key': 'value' }, async (span) => {
			expect(span).toBeDefined();
			return 42;
		});
		expect(result).toBe(42);
	});

	it('withSpan propagates errors correctly', async () => {
		const { withSpan } = await import('$lib/server/telemetry.js');
		await expect(
			withSpan('test.error_span', {}, async () => {
				throw new Error('test error');
			})
		).rejects.toThrow('test error');
	});
});
