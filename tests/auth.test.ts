/**
 * Auth & Session tests — GW2 API key login
 *
 * Tests auth logic directly against a real test database (docker-compose.test.yml).
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { testDb, runMigrations, cleanTables, closeDb } from './helpers/db.js';
import { users, sessions } from '../src/lib/server/db/schema.js';
import { eq, and, gt } from 'drizzle-orm';
import { randomUUID } from 'crypto';

const SESSION_TTL_DAYS = 30;

// --- Inline auth helpers (same logic as src/lib/server/auth.ts but using testDb) ---

async function createUser(
	username: string,
	gw2AccountId: string
): Promise<{ token: string; userId: number }> {
	const [user] = await testDb
		.insert(users)
		.values({
			username,
			gw2AccountId,
			consentGivenAt: new Date()
		})
		.returning();

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

describe('Session Management', () => {
	it('creates user with correct defaults', async () => {
		const { userId } = await createUser('TestUser.1234', 'gw2-uuid-1');
		const [user] = await testDb.select().from(users).where(eq(users.id, userId));

		expect(user.username).toBe('TestUser.1234');
		expect(user.gw2AccountId).toBe('gw2-uuid-1');
		expect(user.role).toBe('user');
		expect(user.adviceCallsRemaining).toBe(15);
		expect(user.profileGensRemaining).toBe(3);
		expect(user.byokApiKeyEncrypted).toBeNull();
		expect(user.consentGivenAt).toBeTruthy();
	});

	it('resolves a valid session and returns user', async () => {
		const { token } = await createUser('SessionUser.5678', 'gw2-uuid-2');
		const user = await resolveSession(token);

		expect(user).not.toBeNull();
		expect(user!.username).toBe('SessionUser.5678');
		expect(user!.role).toBe('user');
	});

	it('returns null for expired session', async () => {
		const { token } = await createUser('ExpiredUser.9999', 'gw2-uuid-3');

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

describe('Admin Role', () => {
	it('admin user has role admin', async () => {
		const { userId } = await createUser('Admin.1234', 'gw2-uuid-admin');
		await testDb.update(users).set({ role: 'admin' }).where(eq(users.id, userId));

		const [user] = await testDb.select().from(users).where(eq(users.id, userId));
		expect(user.role).toBe('admin');
	});

	it('non-admin user has role user', async () => {
		const { userId } = await createUser('Regular.5678', 'gw2-uuid-regular');
		const [user] = await testDb.select().from(users).where(eq(users.id, userId));
		expect(user.role).toBe('user');
	});
});

describe('User Management', () => {
	it('enforces unique username', async () => {
		await createUser('UniqueUser.1111', 'gw2-uuid-unique-1');

		await expect(
			testDb.insert(users).values({
				username: 'UniqueUser.1111',
				gw2AccountId: 'gw2-uuid-unique-2'
			})
		).rejects.toThrow();
	});

	it('enforces unique gw2AccountId', async () => {
		await createUser('User1.1111', 'gw2-uuid-same');

		await expect(
			testDb.insert(users).values({
				username: 'User2.2222',
				gw2AccountId: 'gw2-uuid-same'
			})
		).rejects.toThrow();
	});

	it('GDPR delete cascades user data', async () => {
		const { userId, token } = await createUser('DeleteUser.3333', 'gw2-uuid-delete');

		const [sessionBefore] = await testDb
			.select()
			.from(sessions)
			.where(eq(sessions.token, token));
		expect(sessionBefore).toBeTruthy();

		await testDb.delete(users).where(eq(users.id, userId));

		const sessionsAfter = await testDb
			.select()
			.from(sessions)
			.where(eq(sessions.token, token));
		expect(sessionsAfter).toHaveLength(0);
	});

	it('stores device_info as JSONB', async () => {
		const [user] = await testDb
			.insert(users)
			.values({
				username: 'DeviceUser.4444',
				gw2AccountId: 'gw2-uuid-device',
				deviceInfo: { browser: 'Chrome', resolution: '3440x1440', os: 'Windows' }
			})
			.returning();

		const [fetched] = await testDb.select().from(users).where(eq(users.id, user.id));
		const info = fetched.deviceInfo as Record<string, string>;
		expect(info.browser).toBe('Chrome');
		expect(info.resolution).toBe('3440x1440');
	});
});
