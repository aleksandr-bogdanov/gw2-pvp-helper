import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { loginWithGw2, sessionCookieOptions, SESSION_COOKIE_NAME } from '$lib/server/auth.js';
import { verifyGw2ApiKey, Gw2ApiError } from '$lib/server/gw2-api.js';

/** POST /api/auth/login — authenticate with GW2 API key */
export const POST: RequestHandler = async ({ request, cookies }) => {
	const body = await request.json();
	const apiKey = body.apiKey;

	if (!apiKey || typeof apiKey !== 'string') {
		throw error(400, 'Missing API key');
	}

	let gw2Result;
	try {
		gw2Result = await verifyGw2ApiKey(apiKey);
	} catch (err) {
		if (err instanceof Gw2ApiError) {
			return json({ error: err.message }, { status: err.statusCode });
		}
		return json({ error: 'Failed to verify API key with GW2 servers' }, { status: 502 });
	}

	const deviceInfo = body.deviceInfo ?? undefined;

	const result = await loginWithGw2(
		gw2Result.accountId,
		gw2Result.accountName,
		apiKey.trim(),
		deviceInfo
	);

	cookies.set(SESSION_COOKIE_NAME, result.token, sessionCookieOptions());

	return json({
		userId: result.userId,
		username: result.username,
		role: result.role,
		isNewUser: result.isNewUser
	});
};
