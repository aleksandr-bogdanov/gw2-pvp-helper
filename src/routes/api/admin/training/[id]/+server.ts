import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/server/db/index.js';
import { trainingSamples } from '$lib/server/db/schema.js';
import { eq } from 'drizzle-orm';
import { logger } from '$lib/server/logger.js';

export const PATCH: RequestHandler = async ({ params }) => {
	const id = parseInt(params.id, 10);
	if (isNaN(id)) {
		throw error(400, 'Invalid training sample ID');
	}

	await db.update(trainingSamples)
		.set({ reviewedByAdmin: true })
		.where(eq(trainingSamples.id, id));

	logger.info({ event: 'training_reviewed', trainingId: id }, 'Training sample marked as reviewed');

	return json({ id, reviewed: true });
};
