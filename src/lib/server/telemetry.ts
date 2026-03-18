import { logger } from './logger.js';
import { trace, type Span, SpanStatusCode } from '@opentelemetry/api';

let initialized = false;

/**
 * Initialize OpenTelemetry with Honeycomb exporter.
 * Skips gracefully when HONEYCOMB_API_KEY is not set (dev mode).
 * Must be called before any instrumented code runs.
 */
export async function initTelemetry(): Promise<void> {
	if (initialized) return;
	initialized = true;

	const apiKey = process.env.HONEYCOMB_API_KEY;
	if (!apiKey) {
		logger.info({ event: 'telemetry_skip' }, 'HONEYCOMB_API_KEY not set, skipping OpenTelemetry init');
		return;
	}

	try {
		const { HoneycombSDK } = await import('@honeycombio/opentelemetry-node');
		const { getNodeAutoInstrumentations } = await import('@opentelemetry/auto-instrumentations-node');

		const sdk = new HoneycombSDK({
			apiKey,
			serviceName: process.env.OTEL_SERVICE_NAME ?? 'gw2-pvp-helper',
			instrumentations: [getNodeAutoInstrumentations({
				'@opentelemetry/instrumentation-fs': { enabled: false }
			})]
		});

		sdk.start();
		logger.info({ event: 'telemetry_init' }, 'OpenTelemetry initialized with Honeycomb');
	} catch (err) {
		logger.warn({ event: 'telemetry_error', error: err instanceof Error ? err.message : String(err) }, 'Failed to initialize OpenTelemetry');
	}
}

/**
 * Get the default tracer for custom spans.
 */
export function getTracer() {
	return trace.getTracer('gw2-pvp-helper');
}

/**
 * Wrap an async function in a custom span with attributes.
 */
export async function withSpan<T>(
	name: string,
	attributes: Record<string, string | number | boolean>,
	fn: (span: Span) => Promise<T>
): Promise<T> {
	const tracer = getTracer();
	return tracer.startActiveSpan(name, async (span) => {
		for (const [key, value] of Object.entries(attributes)) {
			span.setAttribute(key, value);
		}
		try {
			const result = await fn(span);
			span.setStatus({ code: SpanStatusCode.OK });
			return result;
		} catch (err) {
			span.setStatus({ code: SpanStatusCode.ERROR, message: err instanceof Error ? err.message : String(err) });
			throw err;
		} finally {
			span.end();
		}
	});
}
