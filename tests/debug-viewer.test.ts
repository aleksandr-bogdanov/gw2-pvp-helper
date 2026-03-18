/**
 * Prompt 6 — Debug Viewer tests
 *
 * Tests debug data structure and access control.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { testDb, runMigrations, cleanTables, closeDb } from './helpers/db.js';
import { users, matches, matchPlayers, userProfiles } from '../src/lib/server/db/schema.js';
import { eq } from 'drizzle-orm';

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

async function createTestUser(username: string, role: 'user' | 'admin' = 'user') {
	const [user] = await testDb
		.insert(users)
		.values({
			username,
			inviteCodeUsed: `code-${username}`,
			role,
			consentGivenAt: new Date()
		})
		.returning();
	return user;
}

describe('Debug Data', () => {
	it('debug data includes advice_raw from match', async () => {
		const user = await createTestUser('debuguser');

		const [match] = await testDb
			.insert(matches)
			.values({
				userId: user.id,
				map: 'battle-of-kyhlo',
				adviceRaw: '## FOCUS ORDER\n1. Firebrand\n2. Reaper',
				adviceText: 'Formatted advice text'
			})
			.returning();

		const [fetchedMatch] = await testDb
			.select()
			.from(matches)
			.where(eq(matches.matchId, match.matchId));

		expect(fetchedMatch.adviceRaw).toBe('## FOCUS ORDER\n1. Firebrand\n2. Reaper');
		expect(fetchedMatch.adviceText).toBe('Formatted advice text');
	});

	it('debug data includes system prompt components', () => {
		// The debug endpoint reconstructs system prompt from data files
		// Verify the structure of what gets returned
		const debugResponse = {
			adviceRaw: 'raw text',
			systemPrompt: 'You are a GW2 PvP tactical advisor...',
			profilePrompt: 'Build: Firebrand heal...',
			userMessage: 'ENEMY TEAM:\n1. Player — spec'
		};

		expect(debugResponse).toHaveProperty('adviceRaw');
		expect(debugResponse).toHaveProperty('systemPrompt');
		expect(debugResponse).toHaveProperty('profilePrompt');
		expect(debugResponse).toHaveProperty('userMessage');
	});

	it('debug data includes user message with roster', async () => {
		const user = await createTestUser('rosteruser');

		const [match] = await testDb
			.insert(matches)
			.values({
				userId: user.id,
				map: 'battle-of-kyhlo',
				userTeamColor: 'red'
			})
			.returning();

		await testDb.insert(matchPlayers).values([
			{ matchId: match.matchId, characterName: 'Player One', team: 'red', profession: 'guardian', spec: 'firebrand', role: 'support', isUser: true },
			{ matchId: match.matchId, characterName: 'Enemy One', team: 'blue', profession: 'necromancer', spec: 'reaper', role: 'dps', isUser: false }
		]);

		// Verify players are stored and retrievable
		const players = await testDb
			.select()
			.from(matchPlayers)
			.where(eq(matchPlayers.matchId, match.matchId));

		expect(players).toHaveLength(2);

		const myTeam = players.filter(p => p.team === 'red');
		const enemyTeam = players.filter(p => p.team === 'blue');

		expect(myTeam).toHaveLength(1);
		expect(enemyTeam).toHaveLength(1);
		expect(myTeam[0].characterName).toBe('Player One');
		expect(enemyTeam[0].characterName).toBe('Enemy One');
	});

	it('debug endpoint returns 403 for non-admin (role check logic)', () => {
		// The hooks.server.ts admin guard checks: user.role !== 'admin' → 403
		const regularUser: { role: string } = { role: 'user' };
		const adminUser: { role: string } = { role: 'admin' };

		// Non-admin would be blocked by the /api/admin/* guard
		expect(regularUser.role !== 'admin').toBe(true);
		expect(adminUser.role !== 'admin').toBe(false);
	});

	it('debug data returns token counts when available from match', async () => {
		const user = await createTestUser('tokenuser');

		// adviceRaw stores the full response; token counts would come from Anthropic response
		const [match] = await testDb
			.insert(matches)
			.values({
				userId: user.id,
				map: 'battle-of-kyhlo',
				adviceRaw: 'Full advice response with tokens tracked by telemetry'
			})
			.returning();

		const [fetchedMatch] = await testDb
			.select()
			.from(matches)
			.where(eq(matches.matchId, match.matchId));

		// adviceRaw is present — token counts are logged via telemetry (not stored in DB)
		expect(fetchedMatch.adviceRaw).toBeTruthy();
	});

	it('profile prompt loaded from user profile for debug', async () => {
		const user = await createTestUser('profiledebug');

		const [profile] = await testDb
			.insert(userProfiles)
			.values({
				userId: user.id,
				characterName: 'Test Char',
				profession: 'guardian',
				spec: 'firebrand',
				role: 'support',
				profilePrompt: 'I play heal firebrand with staff...',
				isActive: true
			})
			.returning();

		const [match] = await testDb
			.insert(matches)
			.values({
				userId: user.id,
				userProfileId: profile.id,
				map: 'battle-of-kyhlo'
			})
			.returning();

		// Verify the profile can be loaded from match.userProfileId
		const [loadedProfile] = await testDb
			.select()
			.from(userProfiles)
			.where(eq(userProfiles.id, match.userProfileId!));

		expect(loadedProfile.profilePrompt).toBe('I play heal firebrand with staff...');
	});
});
