/**
 * Migration runner — replaces drizzle-kit push AND drizzle-kit migrate.
 *
 * Reads drizzle/meta/_journal.json, computes SHA256 hashes of each SQL file,
 * checks which have been applied, and runs the pending ones in order.
 *
 * Matches drizzle-orm's migrate() behavior exactly:
 * - Uses "drizzle" schema for the migrations table
 * - SHA256(sql_content) as the hash
 * - Runs statements split by '--> statement-breakpoint'
 *
 * Idempotent — safe to run on every deploy.
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
	// Create schema and migrations table (matching drizzle-orm exactly)
	await sql`CREATE SCHEMA IF NOT EXISTS "drizzle"`;
	await sql`
		CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
			id SERIAL PRIMARY KEY,
			hash text NOT NULL,
			created_at bigint
		)
	`;

	// Get already-applied hashes
	const applied = await sql`SELECT hash FROM "drizzle"."__drizzle_migrations"`;
	const appliedHashes = new Set(applied.map(r => r.hash));

	// Also clean up any public-schema table from previous bootstrap attempts
	await sql`DROP TABLE IF EXISTS "public"."__drizzle_migrations"`;

	// Bootstrap: if migrations table is empty but DB has tables from push era,
	// seed hashes for migrations 0000-0011 so we don't re-run them
	if (appliedHashes.size === 0) {
		const tables = await sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
		const tableNames = new Set(tables.map(r => r.tablename));
		if (tableNames.has('users') && tableNames.has('matches')) {
			console.log('[migrate] Detected existing DB from push era — seeding migration journal');
			const journal = JSON.parse(readFileSync(resolve(ROOT, 'drizzle/meta/_journal.json'), 'utf-8'));
			for (const entry of journal.entries) {
				if (entry.idx > 11) continue;
				const sqlPath = resolve(ROOT, 'drizzle', `${entry.tag}.sql`);
				const content = readFileSync(sqlPath).toString();
				const hash = crypto.createHash('sha256').update(content).digest('hex');
				await sql`INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at) VALUES (${hash}, ${entry.when})`;
				appliedHashes.add(hash);
			}
			console.log('[migrate] Seeded 12 existing migrations');
		}
	}

	// Read journal
	const journal = JSON.parse(readFileSync(resolve(ROOT, 'drizzle/meta/_journal.json'), 'utf-8'));

	let applied_count = 0;
	let skipped_count = 0;

	for (const entry of journal.entries) {
		const sqlPath = resolve(ROOT, 'drizzle', `${entry.tag}.sql`);
		const sqlContent = readFileSync(sqlPath).toString();
		const hash = crypto.createHash('sha256').update(sqlContent).digest('hex');

		if (appliedHashes.has(hash)) {
			skipped_count++;
			continue;
		}

		// Run migration — split by statement breakpoints
		console.log(`[migrate] Running ${entry.tag}...`);
		const statements = sqlContent.split('--> statement-breakpoint')
			.map(s => s.trim())
			.filter(s => s.length > 0);

		for (const stmt of statements) {
			await sql.unsafe(stmt);
		}

		// Record as applied
		await sql`
			INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at)
			VALUES (${hash}, ${entry.when})
		`;
		applied_count++;
		console.log(`[migrate] Applied ${entry.tag}`);
	}

	if (applied_count === 0) {
		console.log(`[migrate] All ${skipped_count} migrations already applied`);
	} else {
		console.log(`[migrate] Done — ${applied_count} applied, ${skipped_count} skipped`);
	}
} catch (err) {
	console.error('[migrate] FAILED:', err);
	process.exit(1);
} finally {
	await sql.end();
}
