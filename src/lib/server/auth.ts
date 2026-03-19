import { db } from './db/index.js';
import { users, sessions, usedInviteCodes } from './db/schema.js';
import { eq, and, gt } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';

const SESSION_COOKIE_NAME = 'gw2_session';
const SESSION_TTL_DAYS = 30;
const LAST_SEEN_THROTTLE_MS = 5 * 60 * 1000; // 5 minutes

export { SESSION_COOKIE_NAME };

/** Parse INVITE_CODES once at module load */
const VALID_INVITE_CODES = new Set(
	(process.env.INVITE_CODES ?? '').split(',').map((c) => c.trim()).filter(Boolean)
);

/** Validate an invite code against INVITE_CODES env var and used_invite_codes table */
export async function validateInviteCode(code: string): Promise<{ valid: boolean; reason?: string }> {
	if (!VALID_INVITE_CODES.has(code)) {
		return { valid: false, reason: 'Invalid invite code' };
	}

	// Check if already used
	const [used] = await db
		.select()
		.from(usedInviteCodes)
		.where(eq(usedInviteCodes.code, code));

	if (used) {
		return { valid: false, reason: 'Invite code already used' };
	}

	return { valid: true };
}

const BCRYPT_ROUNDS = 12;

/** Hash a password with bcrypt */
export async function hashPassword(password: string): Promise<string> {
	return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/** Verify a password against a bcrypt hash */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
	return bcrypt.compare(password, hash);
}

/** Authenticate a user with username + password. Returns session token or null. */
export async function loginUser(
	username: string,
	password: string
): Promise<{ token: string; userId: number; username: string; role: string } | null> {
	const [user] = await db
		.select({
			id: users.id,
			username: users.username,
			passwordHash: users.passwordHash,
			role: users.role
		})
		.from(users)
		.where(eq(users.username, username));

	if (!user || !user.passwordHash) return null;

	const valid = await verifyPassword(password, user.passwordHash);
	if (!valid) return null;

	const token = randomUUID();
	const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

	await db.insert(sessions).values({
		token,
		userId: user.id,
		expiresAt
	});

	return { token, userId: user.id, username: user.username, role: user.role };
}

/** Create a user + session, mark invite code as used. Returns session token. */
export async function createUser(
	username: string,
	inviteCode: string,
	consentGiven: boolean,
	deviceInfo?: Record<string, unknown>,
	password?: string
): Promise<{ token: string; userId: number }> {
	const passwordHash = password ? await hashPassword(password) : null;

	const [user] = await db
		.insert(users)
		.values({
			username,
			passwordHash,
			inviteCodeUsed: inviteCode,
			deviceInfo: deviceInfo ?? null,
			consentGivenAt: consentGiven ? new Date() : null
		})
		.returning();

	// Mark invite code as used
	await db.insert(usedInviteCodes).values({
		code: inviteCode,
		userId: user.id
	});

	// Create session
	const token = randomUUID();
	const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

	await db.insert(sessions).values({
		token,
		userId: user.id,
		expiresAt
	});

	return { token, userId: user.id };
}

/** Resolve a session token to a user. Returns null if expired or not found. */
export async function resolveSession(
	token: string
): Promise<{ id: number; username: string; role: string; impersonatingUserId: number | null } | null> {
	// Single JOIN query instead of two sequential SELECTs
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
			.catch(() => {});
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
	// Cascade deletes handle sessions, used_invite_codes, user_profiles, matches
	// (all FKs have onDelete: 'cascade')
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
