import type { Handle, HandleServerError } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import * as Sentry from '@sentry/sveltekit';
import { warmupClassifier, warmupOCR, warmupMinimap, terminateOCR } from '$lib/server/scan/index.js';
import { resolveSession, SESSION_COOKIE_NAME } from '$lib/server/auth.js';
import { logger } from '$lib/server/logger.js';
import { initTelemetry } from '$lib/server/telemetry.js';

// Initialize Sentry (skips gracefully if no DSN)
const sentryDsn = process.env.SENTRY_DSN;
if (sentryDsn) {
	Sentry.init({
		dsn: sentryDsn,
		tracesSampleRate: 1.0,
		environment: process.env.NODE_ENV ?? 'development'
	});
	logger.info({ event: 'sentry_init' }, 'Sentry initialized');
} else {
	logger.info({ event: 'sentry_skip' }, 'SENTRY_DSN not set, skipping Sentry init');
}

// Initialize OpenTelemetry/Honeycomb
initTelemetry();

// Pre-warm CV pipeline on server start to avoid cold start on first scan
Promise.all([warmupClassifier(), warmupOCR(), warmupMinimap()]).catch((err) => {
	logger.error({ event: 'warmup_error', error: err instanceof Error ? err.message : String(err) }, 'CV pipeline warmup failed');
});

// Graceful shutdown — clean up OCR worker pool on SIGTERM
process.on('SIGTERM', async () => {
	logger.info({ event: 'shutdown_start' }, 'SIGTERM received, cleaning up...');
	await terminateOCR().catch((err) => {
		logger.error({ event: 'shutdown_error', error: err instanceof Error ? err.message : String(err) }, 'OCR termination failed');
	});
	logger.info({ event: 'shutdown_complete' }, 'Cleanup complete, exiting.');
	process.exit(0);
});

/** Routes that don't require authentication */
const PUBLIC_PATHS = ['/api/health', '/api/auth/'];

function isPublicPath(pathname: string): boolean {
	return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p));
}

const authHandle: Handle = async ({ event, resolve }) => {
	// Default: no user
	event.locals.user = null;
	event.locals.effectiveUserId = null;

	// Resolve session from cookie
	const token = event.cookies.get(SESSION_COOKIE_NAME);
	if (token) {
		const user = await resolveSession(token);
		if (user) {
			event.locals.user = {
				id: user.id,
				username: user.username,
				role: user.role as 'user' | 'admin'
			};
			event.locals.effectiveUserId = user.id;

			// Tag Sentry context with user
			if (sentryDsn) {
				Sentry.setUser({ id: String(user.id), username: user.username });
			}

			// Admin impersonation: ?as=<userId> overrides effectiveUserId
			const asParam = event.url.searchParams.get('as');
			if (asParam && user.role === 'admin') {
				const targetId = parseInt(asParam, 10);
				if (!isNaN(targetId)) {
					event.locals.effectiveUserId = targetId;
				}
			}
		}
	}

	// Auth guard: reject unauthenticated API requests (except public paths)
	if (event.url.pathname.startsWith('/api/') && !isPublicPath(event.url.pathname)) {
		if (!event.locals.user) {
			logger.warn({ event: 'auth_failed', path: event.url.pathname }, 'Unauthenticated API request rejected');
			return json({ error: 'Unauthorized' }, { status: 401 });
		}

		// Admin guard: /api/admin/* requires admin role
		if (event.url.pathname.startsWith('/api/admin/') && event.locals.user.role !== 'admin') {
			logger.warn({ event: 'admin_forbidden', path: event.url.pathname, userId: event.locals.user.id }, 'Non-admin access to admin API rejected');
			return json({ error: 'Forbidden' }, { status: 403 });
		}
	}

	return resolve(event);
};

// Compose handles: Sentry wraps auth for error tracking
export const handle: Handle = sentryDsn
	? sequence(Sentry.sentryHandle(), authHandle)
	: authHandle;

// Error handler — Sentry captures server errors with context
export const handleError: HandleServerError = sentryDsn
	? Sentry.handleErrorWithSentry()
	: ({ error, event }) => {
			logger.error(
				{ event: 'unhandled_error', path: event.url.pathname, error: error instanceof Error ? error.message : String(error) },
				'Unhandled server error'
			);
		};
