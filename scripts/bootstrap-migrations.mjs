/**
 * Bootstrap drizzle-kit migrate for a DB previously managed by drizzle-kit push.
 *
 * Creates the __drizzle_migrations journal table and marks migrations 0000-0011
 * as already applied (they were applied via push). Idempotent — safe to run
 * multiple times; skips if the table already has entries.
 */
import postgres from 'postgres';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const sql = postgres(process.env.DATABASE_URL, { max: 1 });

try {
	// Create the journal table if it doesn't exist
	await sql`
		CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
			id serial PRIMARY KEY,
			hash text NOT NULL,
			created_at bigint
		)
	`;

	// Check if already bootstrapped
	const existing = await sql`SELECT count(*) as cnt FROM "__drizzle_migrations"`;
	if (Number(existing[0].cnt) > 0) {
		console.log('[bootstrap] Migrations journal already populated, skipping');
		await sql.end();
		process.exit(0);
	}

	// Read the journal to get migration hashes
	const journal = JSON.parse(readFileSync(resolve(ROOT, 'drizzle/meta/_journal.json'), 'utf-8'));

	// Mark migrations 0000-0011 as already applied
	for (const entry of journal.entries) {
		if (entry.idx > 11) continue; // Only bootstrap pre-existing migrations
		await sql`
			INSERT INTO "__drizzle_migrations" (hash, created_at)
			VALUES (${entry.tag}, ${entry.when})
		`;
		console.log(`[bootstrap] Marked ${entry.tag} as applied`);
	}

	console.log('[bootstrap] Done — drizzle-kit migrate will only run new migrations');
} catch (err) {
	console.error('[bootstrap] FAILED:', err);
	process.exit(1);
} finally {
	await sql.end();
}
