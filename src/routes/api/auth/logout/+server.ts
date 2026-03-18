import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { deleteSession, SESSION_COOKIE_NAME, sessionCookieOptions } from '$lib/server/auth.js';

/** POST /api/auth/logout — clear session */
export const POST: RequestHandler = async ({ cookies }) => {
	const token = cookies.get(SESSION_COOKIE_NAME);
	if (token) {
		await deleteSession(token);
	}

	cookies.delete(SESSION_COOKIE_NAME, { path: '/' });

	return json({ ok: true });
};
