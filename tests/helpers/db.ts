/**
 * Test database helper — provides a direct postgres connection
 * that bypasses SvelteKit's $env/static/private imports.
 */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../../src/lib/server/db/schema.js';
import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';

const TEST_DATABASE_URL = process.env.DATABASE_URL || 'postgresql://gw2test:gw2test@localhost:5499/gw2test';

const client = postgres(TEST_DATABASE_URL);
export const testDb = drizzle(client, { schema });

/** Run all migrations against the test database */
export async function runMigrations() {
	const migrationsDir = resolve(process.cwd(), 'drizzle');
	const files = readdirSync(migrationsDir)
		.filter((f) => f.endsWith('.sql'))
		.sort();

	for (const file of files) {
		const sql = readFileSync(resolve(migrationsDir, file), 'utf-8');
		// Drizzle migrations use '--> statement-breakpoint' as a separator
		const statements = sql
			.split('--> statement-breakpoint')
			.map((s) => s.trim())
			.filter(Boolean);

		for (const stmt of statements) {
			try {
				await client.unsafe(stmt);
			} catch {
				// Silently skip migration errors for idempotency
			}
		}
	}
}

/** Clean all tables using TRUNCATE CASCADE for clean state + reset sequences */
export async function cleanTables() {
	await client.unsafe(`
		TRUNCATE TABLE match_players, matches, user_profiles, training_samples, minimap_references, sessions, users, players
		RESTART IDENTITY CASCADE
	`);
}

/** Close the connection pool */
export async function closeDb() {
	await client.end();
}
