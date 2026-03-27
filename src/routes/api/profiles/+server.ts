import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/server/db/index.js';
import { userProfiles } from '$lib/server/db/schema.js';
import { eq, and, count as countFn } from 'drizzle-orm';

// GET all profiles (scoped to current user)
export const GET: RequestHandler = async ({ locals }) => {
	const userId = locals.effectiveUserId;
	if (!userId) {
		// Backward compat: return all if no auth (shouldn't happen with auth guard, but safe)
		const profiles = await db.select().from(userProfiles).orderBy(userProfiles.createdAt);
		return json(profiles);
	}

	const profiles = await db
		.select()
		.from(userProfiles)
		.where(eq(userProfiles.userId, userId))
		.orderBy(userProfiles.createdAt);
	return json(profiles);
};

// POST create new profile
export const POST: RequestHandler = async ({ request, locals }) => {
	const body = await request.json();
	const { characterName, profession, spec, buildLabel, role, weaponsMain, weaponsSwap, profilePrompt, rune, relic, amulet, sigilsMain, sigilsSwap, buildCode } = body;
	const userId = locals.effectiveUserId;

	if (!characterName || !profession || !spec || !role) {
		throw error(400, 'Missing required fields: characterName, profession, spec, role');
	}

	// If this is the first profile for this user, make it active
	const countQuery = userId
		? db.select({ total: countFn() }).from(userProfiles).where(eq(userProfiles.userId, userId))
		: db.select({ total: countFn() }).from(userProfiles);
	const [{ total }] = await countQuery;
	const isActive = total === 0;

	const [profile] = await db.insert(userProfiles).values({
		userId: userId ?? null,
		characterName,
		profession,
		spec,
		buildLabel: buildLabel || null,
		role,
		weaponsMain: weaponsMain || null,
		weaponsSwap: weaponsSwap || null,
		rune: rune || null,
		relic: relic || null,
		amulet: amulet || null,
		sigilsMain: sigilsMain || null,
		sigilsSwap: sigilsSwap || null,
		buildCode: buildCode || null,
		playstyle: body.playstyle || null,
		weaknesses: body.weaknesses || null,
		profilePrompt: profilePrompt || null,
		matchups: body.matchups || null,
		isActive
	}).returning();

	return json(profile, { status: 201 });
};

// PATCH update profile or set active
export const PATCH: RequestHandler = async ({ request, locals }) => {
	const body = await request.json();
	const { id, setActive, ...updates } = body;
	const userId = locals.effectiveUserId;

	if (!id) {
		throw error(400, 'Missing profile id');
	}

	if (setActive) {
		// Deactivate all user's profiles, then activate this one
		if (userId) {
			await db.update(userProfiles).set({ isActive: false }).where(eq(userProfiles.userId, userId));
			await db.update(userProfiles).set({ isActive: true }).where(and(eq(userProfiles.id, id), eq(userProfiles.userId, userId)));
		} else {
			await db.update(userProfiles).set({ isActive: false });
			await db.update(userProfiles).set({ isActive: true }).where(eq(userProfiles.id, id));
		}
		const readWhere = userId
			? and(eq(userProfiles.id, id), eq(userProfiles.userId, userId))
			: eq(userProfiles.id, id);
		const [profile] = await db.select().from(userProfiles).where(readWhere);
		return json(profile);
	}

	// General update
	const updateData: Record<string, unknown> = {};
	if (updates.characterName !== undefined) updateData.characterName = updates.characterName;
	if (updates.profession !== undefined) updateData.profession = updates.profession;
	if (updates.spec !== undefined) updateData.spec = updates.spec;
	if (updates.buildLabel !== undefined) updateData.buildLabel = updates.buildLabel;
	if (updates.role !== undefined) updateData.role = updates.role;
	if (updates.weaponsMain !== undefined) updateData.weaponsMain = updates.weaponsMain;
	if (updates.weaponsSwap !== undefined) updateData.weaponsSwap = updates.weaponsSwap;
	if (updates.rune !== undefined) updateData.rune = updates.rune;
	if (updates.relic !== undefined) updateData.relic = updates.relic;
	if (updates.amulet !== undefined) updateData.amulet = updates.amulet;
	if (updates.sigilsMain !== undefined) updateData.sigilsMain = updates.sigilsMain;
	if (updates.sigilsSwap !== undefined) updateData.sigilsSwap = updates.sigilsSwap;
	if (updates.buildCode !== undefined) updateData.buildCode = updates.buildCode;
	if (updates.playstyle !== undefined) updateData.playstyle = updates.playstyle;
	if (updates.weaknesses !== undefined) updateData.weaknesses = updates.weaknesses;
	if (updates.profilePrompt !== undefined) updateData.profilePrompt = updates.profilePrompt;
	if (updates.matchups !== undefined) updateData.matchups = updates.matchups;

	const whereClause = userId
		? and(eq(userProfiles.id, id), eq(userProfiles.userId, userId))
		: eq(userProfiles.id, id);
	const [profile] = await db.update(userProfiles).set(updateData).where(whereClause).returning();
	return json(profile);
};

// DELETE profile
export const DELETE: RequestHandler = async ({ request, locals }) => {
	const body = await request.json();
	const { id } = body;
	const userId = locals.effectiveUserId;

	if (!id) {
		throw error(400, 'Missing profile id');
	}

	const whereClause = userId
		? and(eq(userProfiles.id, id), eq(userProfiles.userId, userId))
		: eq(userProfiles.id, id);
	await db.delete(userProfiles).where(whereClause);
	return json({ success: true });
};
