import { describe, it, expect, vi, beforeEach } from 'vitest';

// We test pino directly (not through our wrapper) to verify JSON output format
describe('logger', () => {
	it('produces valid JSON output', async () => {
		const pino = (await import('pino')).default;
		const chunks: string[] = [];
		const dest = {
			write(msg: string) {
				chunks.push(msg);
			}
		};
		const testLogger = pino({ formatters: { level(label: string) { return { level: label }; } }, timestamp: pino.stdTimeFunctions.isoTime }, dest);
		testLogger.info({ event: 'test_event' }, 'test message');

		expect(chunks.length).toBe(1);
		const parsed = JSON.parse(chunks[0]);
		expect(parsed).toBeDefined();
		expect(typeof parsed).toBe('object');
	});

	it('log entries contain required fields: time, level, event', async () => {
		const pino = (await import('pino')).default;
		const chunks: string[] = [];
		const dest = {
			write(msg: string) {
				chunks.push(msg);
			}
		};
		const testLogger = pino({ formatters: { level(label: string) { return { level: label }; } }, timestamp: pino.stdTimeFunctions.isoTime }, dest);
		testLogger.info({ event: 'scan_complete' }, 'scan done');

		const parsed = JSON.parse(chunks[0]);
		expect(parsed.time).toBeDefined();
		expect(typeof parsed.time).toBe('string');
		expect(parsed.level).toBe('info');
		expect(parsed.event).toBe('scan_complete');
	});

	it('respects log levels — debug hidden at info level', async () => {
		const pino = (await import('pino')).default;
		const chunks: string[] = [];
		const dest = {
			write(msg: string) {
				chunks.push(msg);
			}
		};
		const testLogger = pino({ level: 'info', formatters: { level(label: string) { return { level: label }; } }, timestamp: pino.stdTimeFunctions.isoTime }, dest);
		testLogger.debug({ event: 'debug_event' }, 'should not appear');
		testLogger.info({ event: 'info_event' }, 'should appear');
		testLogger.warn({ event: 'warn_event' }, 'should appear');
		testLogger.error({ event: 'error_event' }, 'should appear');

		expect(chunks.length).toBe(3);
		expect(JSON.parse(chunks[0]).level).toBe('info');
		expect(JSON.parse(chunks[1]).level).toBe('warn');
		expect(JSON.parse(chunks[2]).level).toBe('error');
	});

	it('child logger includes bound fields', async () => {
		const pino = (await import('pino')).default;
		const chunks: string[] = [];
		const dest = {
			write(msg: string) {
				chunks.push(msg);
			}
		};
		const testLogger = pino({ formatters: { level(label: string) { return { level: label }; } }, timestamp: pino.stdTimeFunctions.isoTime }, dest);
		const child = testLogger.child({ userId: 42, requestId: 'abc-123' });
		child.info({ event: 'test_child' }, 'child log');

		const parsed = JSON.parse(chunks[0]);
		expect(parsed.userId).toBe(42);
		expect(parsed.requestId).toBe('abc-123');
		expect(parsed.event).toBe('test_child');
	});
});
