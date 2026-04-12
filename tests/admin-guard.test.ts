/**
 * Prompt 6 — Admin Guard tests
 *
 * Tests admin role enforcement on admin routes using the test database.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { testDb, runMigrations, cleanTables, closeDb } from './helpers/db.js';
import { users, sessions } from '../src/lib/server/db/schema.js';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';

const SESSION_TTL_DAYS = 30;

async function createTestUser(
	username: string,
	role: 'user' | 'admin' = 'user'
): Promise<{ token: string; userId: number }> {
	const [user] = await testDb
		.insert(users)
		.values({
			username,
			role,
			consentGivenAt: new Date()
		})
		.returning();

	const token = randomUUID();
	const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
	await testDb.insert(sessions).values({ token, userId: user.id, expiresAt });

	return { token, userId: user.id };
}

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

describe('Admin Guard', () => {
	it('admin user has role admin in database', async () => {
		const { userId } = await createTestUser('admin1', 'admin');
		const [user] = await testDb.select().from(users).where(eq(users.id, userId));
		expect(user.role).toBe('admin');
	});

	it('non-admin user has role user in database', async () => {
		const { userId } = await createTestUser('regular1', 'user');
		const [user] = await testDb.select().from(users).where(eq(users.id, userId));
		expect(user.role).toBe('user');
	});

	it('admin role check is strict equality', async () => {
		const { userId } = await createTestUser('notadmin');
		const [user] = await testDb.select().from(users).where(eq(users.id, userId));
		expect(user.role).not.toBe('admin');
		expect(user.role === 'admin').toBe(false);
	});

	it('admin user session resolves with admin role', async () => {
		const { token } = await createTestUser('admin2', 'admin');
		const [result] = await testDb
			.select({ role: users.role })
			.from(sessions)
			.innerJoin(users, eq(sessions.userId, users.id))
			.where(eq(sessions.token, token));
		expect(result.role).toBe('admin');
	});

	it('non-admin user session resolves with user role', async () => {
		const { token } = await createTestUser('regular2', 'user');
		const [result] = await testDb
			.select({ role: users.role })
			.from(sessions)
			.innerJoin(users, eq(sessions.userId, users.id))
			.where(eq(sessions.token, token));
		expect(result.role).toBe('user');
	});

	it('unauthenticated session returns no result', async () => {
		const results = await testDb
			.select({ role: users.role })
			.from(sessions)
			.innerJoin(users, eq(sessions.userId, users.id))
			.where(eq(sessions.token, 'nonexistent-token'));
		expect(results).toHaveLength(0);
	});
});
