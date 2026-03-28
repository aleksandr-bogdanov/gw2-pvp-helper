import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/server/db/index.js';
import { trainingSamples } from '$lib/server/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { logger } from '$lib/server/logger.js';

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const id = parseInt(params.id, 10);
	if (isNaN(id)) {
		throw error(400, 'Invalid training sample ID');
	}

	const userId = locals.effectiveUserId;
	const { corrections } = await request.json();

	if (!Array.isArray(corrections)) {
		throw error(400, 'corrections must be an array');
	}

	// Only allow users to correct their own training samples (unless admin)
	const whereClause = locals.user?.role === 'admin'
		? eq(trainingSamples.id, id)
		: and(eq(trainingSamples.id, id), eq(trainingSamples.userId, userId!));

	const [existing] = await db.select().from(trainingSamples).where(whereClause);
	if (!existing) {
		throw error(404, 'Training sample not found');
	}

	await db.update(trainingSamples)
		.set({ userCorrections: corrections })
		.where(eq(trainingSamples.id, id));

	logger.info({ event: 'training_correction', trainingId: id, userId }, 'User correction saved');

	return json({ id, updated: true });
};

export const GET: RequestHandler = async ({ params, locals }) => {
	const id = parseInt(params.id, 10);
	if (isNaN(id)) {
		throw error(400, 'Invalid training sample ID');
	}

	const userId = locals.effectiveUserId;
	const whereClause = locals.user?.role === 'admin'
		? eq(trainingSamples.id, id)
		: and(eq(trainingSamples.id, id), eq(trainingSamples.userId, userId!));

	const [sample] = await db.select().from(trainingSamples).where(whereClause);
	if (!sample) {
		throw error(404, 'Training sample not found');
	}

	return json(sample);
};
