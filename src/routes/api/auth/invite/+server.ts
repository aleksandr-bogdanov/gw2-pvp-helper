import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { validateInviteCode } from '$lib/server/auth.js';

/** POST /api/auth/invite — validate an invite code (does not consume it) */
export const POST: RequestHandler = async ({ request }) => {
	const { code } = await request.json();

	if (!code || typeof code !== 'string') {
		throw error(400, 'Missing invite code');
	}

	const result = await validateInviteCode(code.trim());

	if (!result.valid) {
		// Return a single generic message to prevent invite code enumeration
		return json({ valid: false, reason: 'Invalid invite code' }, { status: 400 });
	}

	return json({ valid: true });
};
