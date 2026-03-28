import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/server/db/index.js';
import { trainingSamples, users } from '$lib/server/db/schema.js';
import { desc, eq, and, asc, sql, count } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

export const GET: RequestHandler = async ({ url }) => {
	const sortBy = url.searchParams.get('sort') ?? 'date';
	const filterResolution = url.searchParams.get('resolution') ?? '';
	const filterReviewed = url.searchParams.get('reviewed'); // 'true', 'false', or null (all)

	// Build conditions using Drizzle's and() instead of SQL string concatenation
	const conditions: SQL[] = [];
	if (filterResolution) {
		conditions.push(eq(trainingSamples.resolution, filterResolution));
	}
	if (filterReviewed === 'true') {
		conditions.push(eq(trainingSamples.reviewedByAdmin, true));
	} else if (filterReviewed === 'false') {
		conditions.push(eq(trainingSamples.reviewedByAdmin, false));
	}

	const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

	const orderClause = sortBy === 'confidence'
		? asc(sql`(SELECT avg((elem->>'spec_confidence')::numeric) FROM jsonb_array_elements(${trainingSamples.confidenceScores}::jsonb) AS elem)`)
		: desc(trainingSamples.createdAt);

	// Run filtered samples query and stats query in parallel
	const [samples, resolutionStatsRows] = await Promise.all([
		db
			.select({
				id: trainingSamples.id,
				userId: trainingSamples.userId,
				username: users.username,
				screenshotHash: trainingSamples.screenshotHash,
				resolution: trainingSamples.resolution,
				uiSize: trainingSamples.uiSize,
				scanResult: trainingSamples.scanResult,
				userCorrections: trainingSamples.userCorrections,
				confidenceScores: trainingSamples.confidenceScores,
				anchorPosition: trainingSamples.anchorPosition,
				reviewedByAdmin: trainingSamples.reviewedByAdmin,
				createdAt: trainingSamples.createdAt
			})
			.from(trainingSamples)
			.leftJoin(users, eq(trainingSamples.userId, users.id))
			.where(whereClause)
			.orderBy(orderClause)
			.limit(200),
		// Compute stats in SQL with GROUP BY — no full table scan into JS
		db
			.select({
				resolution: trainingSamples.resolution,
				total: count(),
				corrected: sql<number>`count(*) filter (where ${trainingSamples.userCorrections} is not null)`.as('corrected'),
				avgConfidence: sql<number>`coalesce(avg((
					select avg(elem::numeric) from jsonb_array_elements_text(
						(select jsonb_agg(s->>'spec_confidence') from jsonb_array_elements(${trainingSamples.confidenceScores}) as s)
					) as elem
				)), 0)`.as('avg_confidence')
			})
			.from(trainingSamples)
			.groupBy(trainingSamples.resolution)
	]);

	const stats: Record<string, { total: number; corrected: number; avgConfidence: number }> = {};
	for (const row of resolutionStatsRows) {
		stats[row.resolution ?? 'unknown'] = {
			total: row.total,
			corrected: row.corrected,
			avgConfidence: row.avgConfidence
		};
	}

	return json({
		samples: samples.map(s => ({
			...s,
			screenshotUrl: `/api/screenshots/${s.screenshotHash}`
		})),
		stats
	});
};
