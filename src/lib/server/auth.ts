import { db } from './db/index.js';
import { users, sessions } from './db/schema.js';
import { eq, and, gt } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { encrypt } from './crypto.js';

const SESSION_COOKIE_NAME = 'gw2_session';
const SESSION_TTL_DAYS = 30;
const LAST_SEEN_THROTTLE_MS = 5 * 60 * 1000; // 5 minutes

export { SESSION_COOKIE_NAME };

/** Parse ADMIN_ACCOUNTS once at module load */
const ADMIN_ACCOUNTS = new Set(
	(process.env.ADMIN_ACCOUNTS ?? 'Korsvian.6794').split(',').map((a) => a.trim()).filter(Boolean)
);

/** Check if a GW2 account name should be admin */
export function isAdminAccount(accountName: string): boolean {
	return ADMIN_ACCOUNTS.has(accountName);
}

/** Find or create a user by GW2 account ID. Returns session token. */
export async function loginWithGw2(
	gw2AccountId: string,
	gw2AccountName: string,
	gw2ApiKey: string,
	deviceInfo?: Record<string, unknown>
): Promise<{ token: string; userId: number; username: string; role: string; isNewUser: boolean }> {
	const token = randomUUID();
	const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
	const role = isAdminAccount(gw2AccountName) ? 'admin' : 'user';
	const encryptedKey = encrypt(gw2ApiKey);

	// Try to find existing user
	const [existing] = await db
		.select({ id: users.id, username: users.username })
		.from(users)
		.where(eq(users.gw2AccountId, gw2AccountId));

	if (existing) {
		// Update account name (may change), role, and API key on every login
		await db
			.update(users)
			.set({
				username: gw2AccountName,
				gw2ApiKeyEncrypted: encryptedKey,
				role,
				lastSeenAt: new Date()
			})
			.where(eq(users.id, existing.id));

		await db.insert(sessions).values({ token, userId: existing.id, expiresAt });

		return { token, userId: existing.id, username: gw2AccountName, role, isNewUser: false };
	}

	// Create new user
	const result = await db.transaction(async (tx) => {
		const [user] = await tx
			.insert(users)
			.values({
				username: gw2AccountName,
				gw2AccountId,
				gw2ApiKeyEncrypted: encryptedKey,
				role,
				deviceInfo: deviceInfo ?? null,
				consentGivenAt: new Date()
			})
			.returning();

		await tx.insert(sessions).values({ token, userId: user.id, expiresAt });

		return { token, userId: user.id, username: gw2AccountName, role, isNewUser: true };
	});

	return result;
}

/** Resolve a session token to a user. Returns null if expired or not found. */
export async function resolveSession(
	token: string
): Promise<{ id: number; username: string; role: string; impersonatingUserId: number | null } | null> {
	const results = await db
		.select({
			userId: users.id,
			username: users.username,
			role: users.role,
			lastSeenAt: users.lastSeenAt,
			impersonatingUserId: sessions.impersonatingUserId
		})
		.from(sessions)
		.innerJoin(users, eq(sessions.userId, users.id))
		.where(and(eq(sessions.token, token), gt(sessions.expiresAt, new Date())));

	const result = results[0];
	if (!result) return null;

	// Throttle lastSeenAt update — only write if >5 minutes stale
	if (result.lastSeenAt.getTime() < Date.now() - LAST_SEEN_THROTTLE_MS) {
		db.update(users)
			.set({ lastSeenAt: new Date() })
			.where(eq(users.id, result.userId))
			.then(() => {})
			.catch((err) => { console.error('Failed to update lastSeenAt:', err); });
	}

	return {
		id: result.userId,
		username: result.username,
		role: result.role,
		impersonatingUserId: result.impersonatingUserId
	};
}

/** Set or clear impersonation on a session (admin only) */
export async function setImpersonation(token: string, targetUserId: number | null): Promise<void> {
	await db
		.update(sessions)
		.set({ impersonatingUserId: targetUserId })
		.where(eq(sessions.token, token));
}

/** Delete a session (logout) */
export async function deleteSession(token: string): Promise<void> {
	await db.delete(sessions).where(eq(sessions.token, token));
}

/** Delete a user and all associated data (GDPR) */
export async function deleteUser(userId: number): Promise<void> {
	await db.delete(users).where(eq(users.id, userId));
}

/** Build cookie options for the session cookie */
export function sessionCookieOptions(maxAge?: number) {
	return {
		path: '/',
		httpOnly: true,
		sameSite: 'lax' as const,
		secure: process.env.NODE_ENV === 'production',
		maxAge: maxAge ?? SESSION_TTL_DAYS * 24 * 60 * 60
	};
}
