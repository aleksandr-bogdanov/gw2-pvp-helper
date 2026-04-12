import type { Handle, HandleServerError } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import * as Sentry from '@sentry/sveltekit';
// Dynamic import: server-side scan depends on Sharp (native addon).
// If Sharp fails to load (e.g., missing platform binary), the server
// should still start — client-side scan is the primary pipeline.
let warmupClassifier: () => Promise<void>;
let warmupOCR: () => Promise<void>;
let warmupMinimap: () => Promise<void>;
let terminateOCR: () => Promise<void>;
try {
	const scan = await import('$lib/server/scan/index.js');
	warmupClassifier = scan.warmupClassifier;
	warmupOCR = scan.warmupOCR;
	warmupMinimap = scan.warmupMinimap;
	terminateOCR = scan.terminateOCR;
} catch (err) {
	const noop = async () => {};
	warmupClassifier = noop;
	warmupOCR = noop;
	warmupMinimap = noop;
	terminateOCR = noop;
	console.warn('Server-side scan unavailable (Sharp native addon failed to load). Client-side scan still works.',
		err instanceof Error ? err.message : err);
}
import { resolveSession, SESSION_COOKIE_NAME } from '$lib/server/auth.js';
import { logger } from '$lib/server/logger.js';
import { initTelemetry } from '$lib/server/telemetry.js';
import { db } from '$lib/server/db/index.js';
import { users } from '$lib/server/db/schema.js';
import { eq } from 'drizzle-orm';

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

/** Max request body size in bytes (10 MB) */
const MAX_BODY_SIZE = 10 * 1024 * 1024;

/** Paths subject to body size limits */
const SIZE_LIMITED_PATHS = ['/api/scan', '/api/scan/upload'];

const bodySizeHandle: Handle = async ({ event, resolve }) => {
	if (event.request.method === 'POST' && SIZE_LIMITED_PATHS.some((p) => event.url.pathname === p)) {
		const contentLength = event.request.headers.get('content-length');
		if (contentLength && parseInt(contentLength, 10) > MAX_BODY_SIZE) {
			logger.warn(
				{ event: 'body_too_large', path: event.url.pathname, size: contentLength },
				'Request body exceeds size limit'
			);
			return json({ error: 'Request body too large', maxBytes: MAX_BODY_SIZE }, { status: 413 });
		}
	}
	return resolve(event);
};

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

			// Admin impersonation: session-stored or ?as=<userId> overrides effectiveUserId
			if (user.role === 'admin') {
				// Check query param first (takes priority, also updates session)
				const asParam = event.url.searchParams.get('as');
				if (asParam) {
					const targetId = parseInt(asParam, 10);
					if (!isNaN(targetId)) {
						// Validate target user exists before allowing impersonation
						const [targetUser] = await db
							.select({ id: users.id, username: users.username })
							.from(users)
							.where(eq(users.id, targetId));
						if (targetUser) {
							event.locals.effectiveUserId = targetId;
							logger.info(
								{ event: 'impersonation_query_param', adminId: user.id, adminUsername: user.username, targetUserId: targetId, targetUsername: targetUser.username },
								`Admin ${user.username} impersonating user ${targetUser.username} via ?as= param`
							);
						} else {
							logger.warn(
								{ event: 'impersonation_invalid_target', adminId: user.id, adminUsername: user.username, targetUserId: targetId },
								`Admin ${user.username} attempted ?as= impersonation of non-existent user ${targetId}`
							);
						}
					}
				} else if (user.impersonatingUserId) {
					// Fall back to session-stored impersonation
					event.locals.effectiveUserId = user.impersonatingUserId;
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

// Compose handles: body size → auth → Sentry error tracking
export const handle: Handle = sentryDsn
	? sequence(bodySizeHandle, Sentry.sentryHandle(), authHandle)
	: sequence(bodySizeHandle, authHandle);

// Error handler — Sentry captures server errors with context
export const handleError: HandleServerError = sentryDsn
	? Sentry.handleErrorWithSentry()
	: ({ error, event }) => {
			logger.error(
				{ event: 'unhandled_error', path: event.url.pathname, error: error instanceof Error ? error.message : String(error) },
				'Unhandled server error'
			);
		};
