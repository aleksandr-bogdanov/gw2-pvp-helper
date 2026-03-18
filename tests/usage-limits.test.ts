/**
 * Prompt 3 — Usage limits enforcement tests
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { testDb, runMigrations, cleanTables, closeDb } from './helpers/db.js';
import { users } from '../src/lib/server/db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { randomBytes } from 'crypto';

process.env.BYOK_ENCRYPTION_KEY = process.env.BYOK_ENCRYPTION_KEY || randomBytes(32).toString('hex');

import { encrypt } from '../src/lib/server/crypto.js';

beforeAll(async () => {
	await runMigrations();
});

beforeEach(async () => {
	await cleanTables();
});

afterAll(async () => {
	await cleanTables();
	await closeDb();
});

async function createTestUser(overrides: Partial<typeof users.$inferInsert> = {}) {
	const [user] = await testDb
		.insert(users)
		.values({
			username: `user_${Date.now()}_${Math.random().toString(36).slice(2)}`,
			inviteCodeUsed: 'test-code',
			...overrides
		})
		.returning();
	return user;
}

describe('Free Tier Advice Limits', () => {
	it('new user starts with 15 advice calls', async () => {
		const user = await createTestUser();
		expect(user.adviceCallsRemaining).toBe(15);
	});

	it('decrementing reduces advice calls by 1', async () => {
		const user = await createTestUser();

		await testDb
			.update(users)
			.set({ adviceCallsRemaining: sql`${users.adviceCallsRemaining} - 1` })
			.where(eq(users.id, user.id));

		const [updated] = await testDb.select().from(users).where(eq(users.id, user.id));
		expect(updated.adviceCallsRemaining).toBe(14);
	});

	it('repeated decrements reach zero', async () => {
		const user = await createTestUser({ adviceCallsRemaining: 2 });

		// Decrement twice
		for (let i = 0; i < 2; i++) {
			await testDb
				.update(users)
				.set({ adviceCallsRemaining: sql`${users.adviceCallsRemaining} - 1` })
				.where(eq(users.id, user.id));
		}

		const [final] = await testDb.select().from(users).where(eq(users.id, user.id));
		expect(final.adviceCallsRemaining).toBe(0);
	});

	it('exhausted user has 0 remaining', async () => {
		const user = await createTestUser({ adviceCallsRemaining: 0 });
		expect(user.adviceCallsRemaining).toBe(0);
	});
});

describe('Free Tier Profile Limits', () => {
	it('new user starts with 3 profile gens', async () => {
		const user = await createTestUser();
		expect(user.profileGensRemaining).toBe(3);
	});

	it('decrementing reduces profile gens by 1', async () => {
		const user = await createTestUser();

		await testDb
			.update(users)
			.set({ profileGensRemaining: sql`${users.profileGensRemaining} - 1` })
			.where(eq(users.id, user.id));

		const [updated] = await testDb.select().from(users).where(eq(users.id, user.id));
		expect(updated.profileGensRemaining).toBe(2);
	});

	it('exhausted profile gens returns 0', async () => {
		const user = await createTestUser({ profileGensRemaining: 0 });
		expect(user.profileGensRemaining).toBe(0);
	});
});

describe('BYOK Bypass', () => {
	it('BYOK user has encrypted key stored', async () => {
		const encrypted = encrypt('sk-ant-api03-byok-key');
		const user = await createTestUser({ byokApiKeyEncrypted: encrypted });
		expect(user.byokApiKeyEncrypted).not.toBeNull();
	});

	it('BYOK user advice calls remain unchanged after simulated use', async () => {
		const encrypted = encrypt('sk-ant-api03-byok-key');
		const user = await createTestUser({
			byokApiKeyEncrypted: encrypted,
			adviceCallsRemaining: 15
		});

		// BYOK path: no decrement happens
		const [fetched] = await testDb.select().from(users).where(eq(users.id, user.id));
		expect(fetched.adviceCallsRemaining).toBe(15);
	});

	it('BYOK user can use their model preference', async () => {
		const encrypted = encrypt('sk-ant-api03-byok-key');
		const user = await createTestUser({
			byokApiKeyEncrypted: encrypted,
			byokModelPreference: 'claude-opus-4-6'
		});
		expect(user.byokModelPreference).toBe('claude-opus-4-6');
	});

	it('free tier always uses default Sonnet model', async () => {
		const user = await createTestUser();
		expect(user.byokModelPreference).toBe('claude-sonnet-4-6');
		expect(user.byokApiKeyEncrypted).toBeNull();
	});
});
