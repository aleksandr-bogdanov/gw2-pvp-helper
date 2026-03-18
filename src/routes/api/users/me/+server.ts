import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { deleteUser, SESSION_COOKIE_NAME } from '$lib/server/auth.js';

/** DELETE /api/users/me — GDPR: delete all user data */
export const DELETE: RequestHandler = async ({ locals, cookies }) => {
	if (!locals.user) {
		throw error(401, 'Unauthorized');
	}

	await deleteUser(locals.user.id);

	cookies.delete(SESSION_COOKIE_NAME, { path: '/' });

	return json({ deleted: true });
};
