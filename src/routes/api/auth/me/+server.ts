import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/server/db/index.js';
import { users } from '$lib/server/db/schema.js';
import { eq } from 'drizzle-orm';

/** GET /api/auth/me — return current user from session with usage stats */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		return json({ user: null }, { status: 401 });
	}

	// Fetch full user record for usage stats
	const [fullUser] = await db
		.select({
			adviceCallsRemaining: users.adviceCallsRemaining,
			profileGensRemaining: users.profileGensRemaining,
			byokModelPreference: users.byokModelPreference,
			hasKey: users.byokApiKeyEncrypted
		})
		.from(users)
		.where(eq(users.id, locals.user.id));

	return json({
		user: {
			...locals.user,
			adviceCallsRemaining: fullUser?.adviceCallsRemaining ?? 0,
			profileGensRemaining: fullUser?.profileGensRemaining ?? 0,
			byokModelPreference: fullUser?.byokModelPreference ?? 'claude-sonnet-4-6',
			hasByokKey: !!fullUser?.hasKey
		}
	});
};
