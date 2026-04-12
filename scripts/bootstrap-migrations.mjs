/**
 * Bootstrap drizzle-kit migrate for a DB previously managed by drizzle-kit push.
 *
 * Creates the __drizzle_migrations journal table and marks migrations 0000-0011
 * as already applied (they were applied via push). Idempotent — safe to run
 * multiple times; skips if the table already has entries.
 *
 * drizzle-orm uses SHA256(sql_content) as the hash, NOT the tag name.
 */
import postgres from 'postgres';
import crypto from 'crypto';
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

	// Check if already bootstrapped — but verify hashes are correct format (sha256 = 64 hex chars)
	const existing = await sql`SELECT hash FROM "__drizzle_migrations" LIMIT 1`;
	if (existing.length > 0 && existing[0].hash.length === 64) {
		console.log('[bootstrap] Migrations journal already populated with correct hashes, skipping');
		await sql.end();
		process.exit(0);
	}

	// If entries exist with wrong hash format (tag names from previous bootstrap), clear them
	if (existing.length > 0) {
		console.log('[bootstrap] Clearing stale entries with wrong hash format');
		await sql`DELETE FROM "__drizzle_migrations"`;
	}

	// Read the journal
	const journal = JSON.parse(readFileSync(resolve(ROOT, 'drizzle/meta/_journal.json'), 'utf-8'));

	// Mark migrations 0000-0011 as already applied using SHA256 of SQL content
	for (const entry of journal.entries) {
		if (entry.idx > 11) continue; // Only bootstrap pre-existing migrations
		const sqlPath = resolve(ROOT, 'drizzle', `${entry.tag}.sql`);
		const sqlContent = readFileSync(sqlPath).toString();
		const hash = crypto.createHash('sha256').update(sqlContent).digest('hex');
		await sql`
			INSERT INTO "__drizzle_migrations" (hash, created_at)
			VALUES (${hash}, ${entry.when})
		`;
		console.log(`[bootstrap] Marked ${entry.tag} as applied (${hash.slice(0, 8)}...)`);
	}

	console.log('[bootstrap] Done — drizzle-kit migrate will only run new migrations');
} catch (err) {
	console.error('[bootstrap] FAILED:', err);
	process.exit(1);
} finally {
	await sql.end();
}
