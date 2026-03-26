import { db } from './db/index.js';
import { users } from './db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { decrypt } from './crypto.js';
import Anthropic from '@anthropic-ai/sdk';

interface UsageCheckResult {
	allowed: boolean;
	isByok: boolean;
	remaining?: number;
	apiKey?: string;
	model?: string;
}

/** Check if user can make an advice call. Returns the API key to use and whether to decrement. */
export async function checkAdviceUsage(userId: number): Promise<UsageCheckResult> {
	const [user] = await db.select().from(users).where(eq(users.id, userId));
	if (!user) return { allowed: false, isByok: false };

	// BYOK users get unlimited access with their own key
	if (user.byokApiKeyEncrypted) {
		try {
			const apiKey = decrypt(user.byokApiKeyEncrypted);
			return {
				allowed: true,
				isByok: true,
				apiKey,
				model: user.byokModelPreference ?? 'claude-sonnet-4-6'
			};
		} catch {
			// If decryption fails, fall through to free tier
		}
	}

	// Free tier: check remaining calls
	if (user.adviceCallsRemaining > 0) {
		return {
			allowed: true,
			isByok: false,
			remaining: user.adviceCallsRemaining - 1
		};
	}

	return { allowed: false, isByok: false, remaining: 0 };
}

/** Decrement advice call counter for free-tier users */
export async function decrementAdviceCalls(userId: number): Promise<number> {
	const [updated] = await db
		.update(users)
		.set({ adviceCallsRemaining: sql`${users.adviceCallsRemaining} - 1` })
		.where(eq(users.id, userId))
		.returning({ remaining: users.adviceCallsRemaining });
	return updated?.remaining ?? 0;
}

/** Check if user can generate a profile */
export async function checkProfileUsage(userId: number): Promise<UsageCheckResult> {
	const [user] = await db.select().from(users).where(eq(users.id, userId));
	if (!user) return { allowed: false, isByok: false };

	if (user.byokApiKeyEncrypted) {
		try {
			const apiKey = decrypt(user.byokApiKeyEncrypted);
			return {
				allowed: true,
				isByok: true,
				apiKey,
				model: user.byokModelPreference ?? 'claude-sonnet-4-6'
			};
		} catch {
			// Fall through to free tier
		}
	}

	if (user.profileGensRemaining > 0) {
		return {
			allowed: true,
			isByok: false,
			remaining: user.profileGensRemaining - 1
		};
	}

	return { allowed: false, isByok: false, remaining: 0 };
}

/** Decrement profile gen counter for free-tier users */
export async function decrementProfileGens(userId: number): Promise<number> {
	const [updated] = await db
		.update(users)
		.set({ profileGensRemaining: sql`${users.profileGensRemaining} - 1` })
		.where(eq(users.id, userId))
		.returning({ remaining: users.profileGensRemaining });
	return updated?.remaining ?? 0;
}

/** Restore a profile gen (rollback on API failure) */
export async function restoreProfileGen(userId: number): Promise<void> {
	await db
		.update(users)
		.set({ profileGensRemaining: sql`${users.profileGensRemaining} + 1` })
		.where(eq(users.id, userId));
}

/** Validate an Anthropic API key by making a minimal test call */
export async function validateAnthropicKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
	try {
		const client = new Anthropic({ apiKey });
		await client.messages.create({
			model: 'claude-sonnet-4-6',
			max_tokens: 1,
			messages: [{ role: 'user', content: 'hi' }]
		});
		return { valid: true };
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		if (message.includes('authentication') || message.includes('401') || message.includes('invalid')) {
			return { valid: false, error: 'Invalid API key' };
		}
		// Other errors (rate limit, etc.) mean the key is probably valid
		return { valid: true };
	}
}
