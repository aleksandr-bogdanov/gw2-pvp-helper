import { logger } from './logger.js';
import { trace, type Span, SpanStatusCode } from '@opentelemetry/api';

let initialized = false;

/**
 * Initialize OpenTelemetry with Honeycomb exporter.
 * Skips gracefully when HONEYCOMB_API_KEY is not set (dev mode).
 *
 * The heavy SDK packages (@opentelemetry/sdk-node, exporters, instrumentations)
 * are NOT in package.json — they're installed separately in the Dockerfile:
 *   bun add @opentelemetry/sdk-node @opentelemetry/exporter-trace-otlp-proto \
 *     @opentelemetry/instrumentation-http @opentelemetry/instrumentation-pg
 *
 * This keeps them out of Vite's build analysis (which was adding 5+ min).
 * @opentelemetry/api is lightweight (23 MB via Sentry) and acts as no-ops
 * when no SDK provider is registered.
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
		// Dynamic imports use a variable to prevent Vite/Vitest static analysis from
		// resolving these at build time. They're only installed in the Docker production
		// image (see Dockerfile), not during development.
		const load = (pkg: string) => import(/* @vite-ignore */ pkg);
		const { NodeSDK } = await load('@opentelemetry/sdk-node');
		const { OTLPTraceExporter } = await load('@opentelemetry/exporter-trace-otlp-proto');
		const { HttpInstrumentation } = await load('@opentelemetry/instrumentation-http');
		const { PgInstrumentation } = await load('@opentelemetry/instrumentation-pg');

		const sdk = new NodeSDK({
			serviceName: process.env.OTEL_SERVICE_NAME ?? 'gw2-pvp-helper',
			traceExporter: new OTLPTraceExporter({
				url: 'https://api.honeycomb.io/v1/traces',
				headers: {
					'x-honeycomb-team': apiKey
				}
			}),
			instrumentations: [
				new HttpInstrumentation(),
				new PgInstrumentation()
			]
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
