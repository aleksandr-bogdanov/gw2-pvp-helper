import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';

/** GET /api/auth/me — return current user from session (already resolved by hooks) */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		return json({ user: null }, { status: 401 });
	}

	return json({ user: locals.user });
};
