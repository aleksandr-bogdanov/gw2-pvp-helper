/**
 * Prompt 3 — BYOK encryption, key lifecycle tests
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { testDb, runMigrations, cleanTables, closeDb } from './helpers/db.js';
import { users } from '../src/lib/server/db/schema.js';
import { eq } from 'drizzle-orm';
import { randomBytes } from 'crypto';

// Set encryption key env var before importing crypto module
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

describe('AES-256-GCM Encryption', () => {
	it('encrypt/decrypt roundtrip produces original plaintext', () => {
		const original = 'sk-ant-api03-test-key-12345678';
		const encrypted = encrypt(original);
		const decrypted = decrypt(encrypted);
		expect(decrypted).toBe(original);
	});

	it('encrypted output is base64 and different from plaintext', () => {
		const original = 'sk-ant-api03-test-key';
		const encrypted = encrypt(original);
		expect(encrypted).not.toBe(original);
		expect(() => Buffer.from(encrypted, 'base64')).not.toThrow();
	});

	it('different encryptions produce different ciphertext (random IV)', () => {
		const original = 'sk-ant-api03-same-key';
		const enc1 = encrypt(original);
		const enc2 = encrypt(original);
		expect(enc1).not.toBe(enc2);
		expect(decrypt(enc1)).toBe(original);
		expect(decrypt(enc2)).toBe(original);
	});

	it('decryption with tampered ciphertext throws', () => {
		const encrypted = encrypt('test-data');
		const tampered = encrypted.slice(0, -2) + 'XX';
		expect(() => decrypt(tampered)).toThrow();
	});
});

describe('BYOK Key Lifecycle in DB', () => {
	it('stores encrypted key and retrieves it', async () => {
		const apiKey = 'sk-ant-api03-real-key-value';
		const encrypted = encrypt(apiKey);

		const [user] = await testDb
			.insert(users)
			.values({
				username: 'byokuser',
				inviteCodeUsed: 'test-code',
				byokApiKeyEncrypted: encrypted
			})
			.returning();

		const [fetched] = await testDb.select().from(users).where(eq(users.id, user.id));
		expect(fetched.byokApiKeyEncrypted).not.toBeNull();
		expect(decrypt(fetched.byokApiKeyEncrypted!)).toBe(apiKey);
	});

	it('key deletion reverts to free tier', async () => {
		const encrypted = encrypt('sk-ant-api03-temp-key');
		const [user] = await testDb
			.insert(users)
			.values({
				username: 'delkeyuser',
				inviteCodeUsed: 'test-code',
				byokApiKeyEncrypted: encrypted,
				byokModelPreference: 'claude-opus-4-6'
			})
			.returning();

		await testDb
			.update(users)
			.set({ byokApiKeyEncrypted: null, byokModelPreference: 'claude-sonnet-4-6' })
			.where(eq(users.id, user.id));

		const [fetched] = await testDb.select().from(users).where(eq(users.id, user.id));
		expect(fetched.byokApiKeyEncrypted).toBeNull();
		expect(fetched.byokModelPreference).toBe('claude-sonnet-4-6');
	});

	it('model selection only persists when BYOK key present', async () => {
		const [user] = await testDb
			.insert(users)
			.values({
				username: 'nobyokuser',
				inviteCodeUsed: 'test-code'
			})
			.returning();

		expect(user.byokApiKeyEncrypted).toBeNull();
		expect(user.byokModelPreference).toBe('claude-sonnet-4-6');
	});
});
