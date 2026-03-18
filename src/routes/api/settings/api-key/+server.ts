import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db/index.js';
import { users } from '$lib/server/db/schema.js';
import { eq } from 'drizzle-orm';
import { encrypt } from '$lib/server/crypto.js';
import { validateAnthropicKey } from '$lib/server/usage.js';

/** GET — returns whether user has a BYOK key (never the actual key) */
export const GET: RequestHandler = async ({ locals }) => {
	const userId = locals.effectiveUserId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const [user] = await db
		.select({ hasKey: users.byokApiKeyEncrypted })
		.from(users)
		.where(eq(users.id, userId));

	return json({ hasKey: !!user?.hasKey });
};

/** POST — validate, encrypt, and store a BYOK API key */
export const POST: RequestHandler = async ({ request, locals }) => {
	const userId = locals.effectiveUserId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const { apiKey } = await request.json();
	if (!apiKey || typeof apiKey !== 'string' || !apiKey.startsWith('sk-ant-')) {
		return json({ error: 'Invalid API key format' }, { status: 400 });
	}

	// Validate key with a test call
	const validation = await validateAnthropicKey(apiKey);
	if (!validation.valid) {
		return json({ error: validation.error ?? 'Invalid API key' }, { status: 400 });
	}

	// Encrypt and store
	const encrypted = encrypt(apiKey);
	await db
		.update(users)
		.set({ byokApiKeyEncrypted: encrypted })
		.where(eq(users.id, userId));

	return json({ success: true });
};

/** DELETE — remove stored BYOK key, revert to free tier */
export const DELETE: RequestHandler = async ({ locals }) => {
	const userId = locals.effectiveUserId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	await db
		.update(users)
		.set({
			byokApiKeyEncrypted: null,
			byokModelPreference: 'claude-sonnet-4-6'
		})
		.where(eq(users.id, userId));

	return json({ success: true });
};
