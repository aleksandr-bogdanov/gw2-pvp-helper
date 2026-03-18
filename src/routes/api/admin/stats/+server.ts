import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/server/db/index.js';
import { users, matches, trainingSamples } from '$lib/server/db/schema.js';
import { count, sql } from 'drizzle-orm';

export const GET: RequestHandler = async () => {
	const FREE_ADVICE_LIMIT = parseInt(process.env.FREE_ADVICE_LIMIT ?? '15');
	const FREE_PROFILE_LIMIT = parseInt(process.env.FREE_PROFILE_LIMIT ?? '3');

	// Run all 4 queries in parallel
	const [
		[userCount],
		[matchCount],
		[trainingCount],
		[usageStats]
	] = await Promise.all([
		db.select({ total: count() }).from(users),
		db.select({ total: count() }).from(matches),
		db.select({ total: count() }).from(trainingSamples),
		db.select({
			totalAdviceUsed: sql<number>`coalesce(sum(${FREE_ADVICE_LIMIT} - ${users.adviceCallsRemaining}), 0)`.as('total_advice_used'),
			totalProfilesUsed: sql<number>`coalesce(sum(${FREE_PROFILE_LIMIT} - ${users.profileGensRemaining}), 0)`.as('total_profiles_used')
		}).from(users)
	]);

	return json({
		totalUsers: userCount.total,
		totalMatches: matchCount.total,
		totalTrainingSamples: trainingCount.total,
		totalAdviceCalls: usageStats.totalAdviceUsed,
		totalProfileGens: usageStats.totalProfilesUsed
	});
};
