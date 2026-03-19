import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { setImpersonation, SESSION_COOKIE_NAME } from '$lib/server/auth.js';

/** POST /api/admin/impersonate — set or clear impersonation target */
export const POST: RequestHandler = async ({ request, cookies, locals }) => {
	if (!locals.user || locals.user.role !== 'admin') {
		throw error(403, 'Forbidden');
	}

	const { userId } = await request.json();
	const token = cookies.get(SESSION_COOKIE_NAME);
	if (!token) {
		throw error(401, 'No session');
	}

	// userId=null clears impersonation
	const targetId = userId === null ? null : parseInt(userId, 10);
	if (userId !== null && isNaN(targetId!)) {
		throw error(400, 'Invalid userId');
	}

	await setImpersonation(token, targetId);

	return json({ impersonating: targetId });
};
