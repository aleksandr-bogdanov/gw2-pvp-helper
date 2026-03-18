import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db/index.js';
import { users } from '$lib/server/db/schema.js';
import { eq } from 'drizzle-orm';

const ALLOWED_MODELS = ['claude-sonnet-4-6', 'claude-opus-4-6'];

/** PATCH — update model preference (BYOK only) */
export const PATCH: RequestHandler = async ({ request, locals }) => {
	const userId = locals.effectiveUserId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const { model } = await request.json();
	if (!ALLOWED_MODELS.includes(model)) {
		return json(
			{ error: `Invalid model. Allowed: ${ALLOWED_MODELS.join(', ')}` },
			{ status: 400 }
		);
	}

	// Check that user has a BYOK key
	const [user] = await db
		.select({ byokKey: users.byokApiKeyEncrypted })
		.from(users)
		.where(eq(users.id, userId));

	if (!user?.byokKey) {
		return json(
			{ error: 'Model selection requires a BYOK API key. Add your key first.' },
			{ status: 403 }
		);
	}

	await db
		.update(users)
		.set({ byokModelPreference: model })
		.where(eq(users.id, userId));

	return json({ success: true, model });
};
