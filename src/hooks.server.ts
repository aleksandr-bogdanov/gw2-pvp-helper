import type { Handle } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { warmupClassifier, warmupOCR, warmupMinimap, terminateOCR } from '$lib/server/scan/index.js';
import { resolveSession, SESSION_COOKIE_NAME } from '$lib/server/auth.js';

// Pre-warm CV pipeline on server start to avoid cold start on first scan
Promise.all([warmupClassifier(), warmupOCR(), warmupMinimap()]).catch(console.error);

// Graceful shutdown — clean up OCR worker pool on SIGTERM
process.on('SIGTERM', async () => {
	console.log('[shutdown] SIGTERM received, cleaning up...');
	await terminateOCR().catch(console.error);
	console.log('[shutdown] Cleanup complete, exiting.');
	process.exit(0);
});

/** Routes that don't require authentication */
const PUBLIC_PATHS = ['/api/health', '/api/auth/'];

function isPublicPath(pathname: string): boolean {
	return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p));
}

export const handle: Handle = async ({ event, resolve }) => {
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
			return json({ error: 'Unauthorized' }, { status: 401 });
		}
	}

	return resolve(event);
};
