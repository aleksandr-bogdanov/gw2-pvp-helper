import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/server/db/index.js';
import { users } from '$lib/server/db/schema.js';
import { desc, ilike } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

export const GET: RequestHandler = async ({ url }) => {
	const search = url.searchParams.get('search') ?? '';

	let query = db
		.select({
			id: users.id,
			username: users.username,
			role: users.role,
			deviceInfo: users.deviceInfo,
			adviceCallsRemaining: users.adviceCallsRemaining,
			profileGensRemaining: users.profileGensRemaining,
			byokApiKeyEncrypted: users.byokApiKeyEncrypted,
			byokModelPreference: users.byokModelPreference,
			lastSeenAt: users.lastSeenAt,
			createdAt: users.createdAt
		})
		.from(users)
		.orderBy(desc(users.lastSeenAt));

	if (search) {
		// Filter by resolution in device_info JSONB or by username
		query = query.where(
			sql`${users.username} ILIKE ${'%' + search + '%'} OR ${users.deviceInfo}->>'resolution' ILIKE ${'%' + search + '%'}`
		) as typeof query;
	}

	const allUsers = await query;

	return json({
		users: allUsers.map(u => ({
			...u,
			hasByokKey: !!u.byokApiKeyEncrypted,
			byokApiKeyEncrypted: undefined // Never expose the key
		}))
	});
};
