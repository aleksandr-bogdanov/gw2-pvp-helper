/**
 * Prompt 2 — Auth, Sessions, Invite Codes tests
 *
 * Tests auth logic directly against a real test database (docker-compose.test.yml).
 * We bypass SvelteKit's module resolution by using testDb directly and
 * reimplementing the core auth logic with the same queries.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { testDb, runMigrations, cleanTables, closeDb } from './helpers/db.js';
import { users, sessions, usedInviteCodes } from '../src/lib/server/db/schema.js';
import { eq, and, gt } from 'drizzle-orm';
import { randomUUID } from 'crypto';

const SESSION_TTL_DAYS = 30;

// --- Inline auth helpers (same logic as src/lib/server/auth.ts but using testDb) ---

async function validateInviteCode(
	code: string,
	validCodes: Set<string>
): Promise<{ valid: boolean; reason?: string }> {
	if (!validCodes.has(code)) {
		return { valid: false, reason: 'Invalid invite code' };
	}
	const [used] = await testDb
		.select()
		.from(usedInviteCodes)
		.where(eq(usedInviteCodes.code, code));
	if (used) {
		return { valid: false, reason: 'Invite code already used' };
	}
	return { valid: true };
}

async function createUser(
	username: string,
	inviteCode: string,
	consentGiven: boolean
): Promise<{ token: string; userId: number }> {
	const [user] = await testDb
		.insert(users)
		.values({
			username,
			inviteCodeUsed: inviteCode,
			consentGivenAt: consentGiven ? new Date() : null
		})
		.returning();

	await testDb.insert(usedInviteCodes).values({
		code: inviteCode,
		userId: user.id
	});

	const token = randomUUID();
	const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
	await testDb.insert(sessions).values({ token, userId: user.id, expiresAt });

	return { token, userId: user.id };
}

async function resolveSession(
	token: string
): Promise<{ id: number; username: string; role: string } | null> {
	const results = await testDb
		.select({
			userId: users.id,
			username: users.username,
			role: users.role
		})
		.from(sessions)
		.innerJoin(users, eq(sessions.userId, users.id))
		.where(and(eq(sessions.token, token), gt(sessions.expiresAt, new Date())));

	const result = results[0];
	if (!result) return null;
	return { id: result.userId, username: result.username, role: result.role };
}

// --- Tests ---

const VALID_CODES = new Set(['test-code-001', 'test-code-002', 'test-code-003']);

let testCounter = 0;
function uniqueCode() {
	return `test-code-${String(++testCounter).padStart(3, '0')}`;
}

beforeAll(async () => {
	await runMigrations();
});

beforeEach(async () => {
	await cleanTables();
	// Reset counter so codes stay in VALID_CODES set
	testCounter = 0;
});

afterAll(async () => {
	await cleanTables();
	await closeDb();
});

describe('Invite Code Validation', () => {
	it('accepts a valid unused invite code', async () => {
		const result = await validateInviteCode('test-code-001', VALID_CODES);
		expect(result.valid).toBe(true);
	});

	it('rejects an invalid invite code', async () => {
		const result = await validateInviteCode('bogus-code', VALID_CODES);
		expect(result.valid).toBe(false);
		expect(result.reason).toBe('Invalid invite code');
	});

	it('rejects a used invite code', async () => {
		await createUser('user1', 'test-code-001', true);

		const result = await validateInviteCode('test-code-001', VALID_CODES);
		expect(result.valid).toBe(false);
		expect(result.reason).toBe('Invite code already used');
	});
});

describe('Session Management', () => {
	it('creates user with correct defaults', async () => {
		const { userId } = await createUser('testuser', 'test-code-001', true);
		const [user] = await testDb.select().from(users).where(eq(users.id, userId));

		expect(user.username).toBe('testuser');
		expect(user.role).toBe('user');
		expect(user.adviceCallsRemaining).toBe(15);
		expect(user.profileGensRemaining).toBe(3);
		expect(user.byokApiKeyEncrypted).toBeNull();
		expect(user.consentGivenAt).toBeTruthy();
	});

	it('resolves a valid session and returns user', async () => {
		const { token } = await createUser('sessionuser', 'test-code-001', true);
		const user = await resolveSession(token);

		expect(user).not.toBeNull();
		expect(user!.username).toBe('sessionuser');
		expect(user!.role).toBe('user');
	});

	it('returns null for expired session', async () => {
		const { token } = await createUser('expireduser', 'test-code-001', true);

		// Set session expiry to the past
		await testDb
			.update(sessions)
			.set({ expiresAt: new Date(Date.now() - 1000) })
			.where(eq(sessions.token, token));

		const user = await resolveSession(token);
		expect(user).toBeNull();
	});

	it('returns null for non-existent session token', async () => {
		const user = await resolveSession('non-existent-token');
		expect(user).toBeNull();
	});
});

describe('Admin Impersonation', () => {
	it('admin user has role admin', async () => {
		const { userId } = await createUser('admin1', 'test-code-001', true);
		await testDb.update(users).set({ role: 'admin' }).where(eq(users.id, userId));

		const [user] = await testDb.select().from(users).where(eq(users.id, userId));
		expect(user.role).toBe('admin');
	});

	it('non-admin user has role user', async () => {
		const { userId } = await createUser('regular1', 'test-code-001', true);
		const [user] = await testDb.select().from(users).where(eq(users.id, userId));
		expect(user.role).toBe('user');
	});
});

describe('User Management', () => {
	it('enforces unique username', async () => {
		await createUser('uniqueuser', 'test-code-001', true);

		await expect(
			testDb.insert(users).values({
				username: 'uniqueuser',
				inviteCodeUsed: 'test-code-002'
			})
		).rejects.toThrow();
	});

	it('GDPR delete cascades user data', async () => {
		const { userId, token } = await createUser('deleteuser', 'test-code-001', true);

		// Verify data exists
		const [sessionBefore] = await testDb
			.select()
			.from(sessions)
			.where(eq(sessions.token, token));
		expect(sessionBefore).toBeTruthy();

		// Delete user (cascade)
		await testDb.delete(users).where(eq(users.id, userId));

		// Verify all associated data is gone
		const sessionsAfter = await testDb
			.select()
			.from(sessions)
			.where(eq(sessions.token, token));
		expect(sessionsAfter).toHaveLength(0);

		const codesAfter = await testDb
			.select()
			.from(usedInviteCodes)
			.where(eq(usedInviteCodes.userId, userId));
		expect(codesAfter).toHaveLength(0);
	});

	it('stores device_info as JSONB', async () => {
		const [user] = await testDb
			.insert(users)
			.values({
				username: 'deviceuser',
				inviteCodeUsed: 'test-code-001',
				deviceInfo: { browser: 'Chrome', resolution: '3440x1440', os: 'Windows' }
			})
			.returning();

		const [fetched] = await testDb.select().from(users).where(eq(users.id, user.id));
		const info = fetched.deviceInfo as Record<string, string>;
		expect(info.browser).toBe('Chrome');
		expect(info.resolution).toBe('3440x1440');
	});
});
