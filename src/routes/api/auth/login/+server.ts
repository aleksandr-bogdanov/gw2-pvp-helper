import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { loginUser, sessionCookieOptions, SESSION_COOKIE_NAME } from '$lib/server/auth.js';

/** POST /api/auth/login — authenticate with username + password */
export const POST: RequestHandler = async ({ request, cookies }) => {
	const { username, password } = await request.json();

	if (!username || typeof username !== 'string') {
		throw error(400, 'Missing username');
	}
	if (!password || typeof password !== 'string') {
		throw error(400, 'Missing password');
	}

	const result = await loginUser(username.trim(), password);

	if (!result) {
		// Generic message — don't reveal whether username exists
		return json({ error: 'Invalid username or password' }, { status: 401 });
	}

	cookies.set(SESSION_COOKIE_NAME, result.token, sessionCookieOptions());

	return json({
		userId: result.userId,
		username: result.username,
		role: result.role
	});
};
