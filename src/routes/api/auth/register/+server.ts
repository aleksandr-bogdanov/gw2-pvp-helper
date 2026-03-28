import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { validateInviteCode, createUser, sessionCookieOptions, SESSION_COOKIE_NAME } from '$lib/server/auth.js';
import { db } from '$lib/server/db/index.js';
import { users } from '$lib/server/db/schema.js';
import { eq } from 'drizzle-orm';

/** POST /api/auth/register — create account with invite code + username */
export const POST: RequestHandler = async ({ request, cookies }) => {
	const { code, username, password, consent, deviceInfo } = await request.json();

	// Validate deviceInfo: must be a plain object (not array/null) and under 2 KB
	if (deviceInfo !== undefined && deviceInfo !== null) {
		if (typeof deviceInfo !== 'object' || Array.isArray(deviceInfo)) {
			throw error(400, 'Invalid deviceInfo');
		}
		if (JSON.stringify(deviceInfo).length > 2048) {
			throw error(400, 'deviceInfo exceeds maximum size');
		}
	}

	if (!code || typeof code !== 'string') {
		throw error(400, 'Missing invite code');
	}
	if (!username || typeof username !== 'string') {
		throw error(400, 'Missing username');
	}
	if (!password || typeof password !== 'string') {
		throw error(400, 'Missing password');
	}
	if (password.length < 8) {
		throw error(400, 'Password must be at least 8 characters');
	}
	if (!consent) {
		throw error(400, 'Consent is required');
	}

	const trimmedUsername = username.trim();
	if (trimmedUsername.length < 2 || trimmedUsername.length > 32) {
		throw error(400, 'Username must be 2-32 characters');
	}

	// Validate invite code
	const codeResult = await validateInviteCode(code.trim());
	if (!codeResult.valid) {
		return json({ error: codeResult.reason }, { status: 400 });
	}

	// Check username uniqueness
	const [existing] = await db
		.select()
		.from(users)
		.where(eq(users.username, trimmedUsername));

	if (existing) {
		return json({ error: 'Username already taken' }, { status: 409 });
	}

	// Create user + session — wrapped to catch unique constraint violation from concurrent registrations
	let token: string;
	let userId: number;
	try {
		({ token, userId } = await createUser(
			trimmedUsername,
			code.trim(),
			true,
			deviceInfo ?? undefined,
			password
		));
	} catch (err) {
		// Postgres unique_violation: code 23505
		const pgErr = err as { code?: string };
		if (pgErr.code === '23505') {
			return json({ error: 'Username already taken' }, { status: 409 });
		}
		throw err;
	}

	// Set session cookie
	cookies.set(SESSION_COOKIE_NAME, token, sessionCookieOptions());

	return json({ userId, username: trimmedUsername }, { status: 201 });
};
