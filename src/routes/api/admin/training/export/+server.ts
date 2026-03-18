import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/server/db/index.js';
import { trainingSamples, users } from '$lib/server/db/schema.js';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async () => {
	const samples = await db
		.select({
			id: trainingSamples.id,
			userId: trainingSamples.userId,
			username: users.username,
			screenshotHash: trainingSamples.screenshotHash,
			screenshotPath: trainingSamples.screenshotPath,
			resolution: trainingSamples.resolution,
			uiSize: trainingSamples.uiSize,
			deviceInfo: trainingSamples.deviceInfo,
			scanResult: trainingSamples.scanResult,
			userCorrections: trainingSamples.userCorrections,
			confidenceScores: trainingSamples.confidenceScores,
			anchorPosition: trainingSamples.anchorPosition,
			reviewedByAdmin: trainingSamples.reviewedByAdmin,
			createdAt: trainingSamples.createdAt
		})
		.from(trainingSamples)
		.leftJoin(users, eq(trainingSamples.userId, users.id));

	return json(
		samples.map(s => ({
			...s,
			screenshotUrl: `/api/screenshots/${s.screenshotHash}`
		}))
	);
};
