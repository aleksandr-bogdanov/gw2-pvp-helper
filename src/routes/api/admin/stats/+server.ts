import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/server/db/index.js';
import { users, matches, trainingSamples } from '$lib/server/db/schema.js';
import { count, sql, desc, gt } from 'drizzle-orm';

export const GET: RequestHandler = async () => {
	const FREE_ADVICE_LIMIT = parseInt(process.env.FREE_ADVICE_LIMIT ?? '15');
	const FREE_PROFILE_LIMIT = parseInt(process.env.FREE_PROFILE_LIMIT ?? '3');

	const now = new Date();
	const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
	const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

	const [
		[userCount],
		[matchCount],
		[trainingCount],
		[usageStats],
		recentUsers,
		[activeToday],
		[activeWeek],
		[byokCount],
		[unreviewedCount]
	] = await Promise.all([
		db.select({ total: count() }).from(users),
		db.select({ total: count() }).from(matches),
		db.select({ total: count() }).from(trainingSamples),
		db.select({
			totalAdviceUsed: sql<number>`coalesce(sum(${FREE_ADVICE_LIMIT} - ${users.adviceCallsRemaining}), 0)`.as('total_advice_used'),
			totalProfilesUsed: sql<number>`coalesce(sum(${FREE_PROFILE_LIMIT} - ${users.profileGensRemaining}), 0)`.as('total_profiles_used')
		}).from(users),
		db.select({
			id: users.id,
			username: users.username,
			createdAt: users.createdAt
		}).from(users).orderBy(desc(users.createdAt)).limit(5),
		db.select({ total: count() }).from(users).where(gt(users.lastSeenAt, oneDayAgo)),
		db.select({ total: count() }).from(users).where(gt(users.lastSeenAt, sevenDaysAgo)),
		db.select({ total: count() }).from(users).where(sql`${users.byokApiKeyEncrypted} is not null`),
		db.select({ total: count() }).from(trainingSamples).where(sql`${trainingSamples.reviewedByAdmin} = false`)
	]);

	return json({
		totalUsers: userCount.total,
		totalMatches: matchCount.total,
		totalTrainingSamples: trainingCount.total,
		totalAdviceCalls: usageStats.totalAdviceUsed,
		totalProfileGens: usageStats.totalProfilesUsed,
		activeToday: activeToday.total,
		activeWeek: activeWeek.total,
		byokUsers: byokCount.total,
		unreviewedSamples: unreviewedCount.total,
		recentUsers: recentUsers.map(u => ({
			id: u.id,
			username: u.username,
			createdAt: u.createdAt
		})),
		freeAdviceLimit: FREE_ADVICE_LIMIT,
		freeProfileLimit: FREE_PROFILE_LIMIT
	});
};
