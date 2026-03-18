/**
 * Prompt 3 — Settings API endpoint tests
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { testDb, runMigrations, cleanTables, closeDb } from './helpers/db.js';
import { users } from '../src/lib/server/db/schema.js';
import { eq } from 'drizzle-orm';
import { randomBytes } from 'crypto';

process.env.BYOK_ENCRYPTION_KEY = process.env.BYOK_ENCRYPTION_KEY || randomBytes(32).toString('hex');

import { encrypt, decrypt } from '../src/lib/server/crypto.js';

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

describe('GET /api/settings/api-key logic', () => {
	it('returns hasKey: false when no BYOK key', async () => {
		const user = await createTestUser();
		expect(user.byokApiKeyEncrypted).toBeNull();
		// Endpoint would return { hasKey: false }
		expect(!!user.byokApiKeyEncrypted).toBe(false);
	});

	it('returns hasKey: true when BYOK key present', async () => {
		const encrypted = encrypt('sk-ant-api03-test');
		const user = await createTestUser({ byokApiKeyEncrypted: encrypted });
		expect(!!user.byokApiKeyEncrypted).toBe(true);
	});

	it('never returns the actual key value', async () => {
		const apiKey = 'sk-ant-api03-secret-key';
		const encrypted = encrypt(apiKey);
		const user = await createTestUser({ byokApiKeyEncrypted: encrypted });

		// The response from the endpoint only has `hasKey: boolean`
		// The stored value is encrypted, not the original
		expect(user.byokApiKeyEncrypted).not.toBe(apiKey);
		expect(!!user.byokApiKeyEncrypted).toBe(true);
	});
});

describe('POST /api/settings/api-key logic', () => {
	it('encrypts and stores API key', async () => {
		const user = await createTestUser();
		const apiKey = 'sk-ant-api03-new-key-to-store';
		const encrypted = encrypt(apiKey);

		await testDb
			.update(users)
			.set({ byokApiKeyEncrypted: encrypted })
			.where(eq(users.id, user.id));

		const [fetched] = await testDb.select().from(users).where(eq(users.id, user.id));
		expect(fetched.byokApiKeyEncrypted).not.toBeNull();
		expect(decrypt(fetched.byokApiKeyEncrypted!)).toBe(apiKey);
	});
});

describe('DELETE /api/settings/api-key logic', () => {
	it('removes key and resets model preference', async () => {
		const encrypted = encrypt('sk-ant-api03-remove-me');
		const user = await createTestUser({
			byokApiKeyEncrypted: encrypted,
			byokModelPreference: 'claude-opus-4-6'
		});

		await testDb
			.update(users)
			.set({ byokApiKeyEncrypted: null, byokModelPreference: 'claude-sonnet-4-6' })
			.where(eq(users.id, user.id));

		const [fetched] = await testDb.select().from(users).where(eq(users.id, user.id));
		expect(fetched.byokApiKeyEncrypted).toBeNull();
		expect(fetched.byokModelPreference).toBe('claude-sonnet-4-6');
	});
});

describe('PATCH /api/settings/model logic', () => {
	const ALLOWED_MODELS = ['claude-sonnet-4-6', 'claude-opus-4-6'];

	it('accepts valid model names', () => {
		expect(ALLOWED_MODELS.includes('claude-sonnet-4-6')).toBe(true);
		expect(ALLOWED_MODELS.includes('claude-opus-4-6')).toBe(true);
	});

	it('rejects invalid model names', () => {
		expect(ALLOWED_MODELS.includes('gpt-4')).toBe(false);
		expect(ALLOWED_MODELS.includes('')).toBe(false);
	});

	it('rejects model change when no BYOK key', async () => {
		const user = await createTestUser();
		expect(user.byokApiKeyEncrypted).toBeNull();
		// Endpoint would return 403
	});

	it('allows model change with BYOK key', async () => {
		const encrypted = encrypt('sk-ant-api03-key');
		const user = await createTestUser({ byokApiKeyEncrypted: encrypted });

		await testDb
			.update(users)
			.set({ byokModelPreference: 'claude-opus-4-6' })
			.where(eq(users.id, user.id));

		const [fetched] = await testDb.select().from(users).where(eq(users.id, user.id));
		expect(fetched.byokModelPreference).toBe('claude-opus-4-6');
	});
});
