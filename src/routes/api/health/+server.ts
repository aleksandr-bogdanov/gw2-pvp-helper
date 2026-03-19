import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/server/db/index.js';
import { sql } from 'drizzle-orm';
import { logger } from '$lib/server/logger.js';

export const GET: RequestHandler = async () => {
	try {
		await db.execute(sql`SELECT 1`);
		return json({
			status: 'ok',
			uptime: process.uptime()
		});
	} catch (err) {
		logger.error(
			{ event: 'health_check_failed', error: err instanceof Error ? err.message : String(err) },
			'Database connectivity check failed'
		);
		return json(
			{ status: 'error', error: 'Database unavailable' },
			{ status: 503 }
		);
	}
};
