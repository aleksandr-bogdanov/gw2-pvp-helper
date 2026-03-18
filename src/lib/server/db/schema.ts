import { pgTable, serial, text, boolean, integer, timestamp, uuid, jsonb } from 'drizzle-orm/pg-core';

export const userProfiles = pgTable('user_profiles', {
	id: serial('id').primaryKey(),
	characterName: text('character_name').notNull(),
	profession: text('profession').notNull(),
	spec: text('spec').notNull(),
	buildLabel: text('build_label'),
	role: text('role').notNull(),
	weaponsMain: text('weapons_main'),
	weaponsSwap: text('weapons_swap'),
	rune: text('rune'),
	relic: text('relic'),
	amulet: text('amulet'),
	sigilsMain: text('sigils_main'),
	sigilsSwap: text('sigils_swap'),
	buildCode: text('build_code'),
	playstyle: text('playstyle'),
	weaknesses: text('weaknesses'),
	profilePrompt: text('profile_prompt'),
	matchups: jsonb('matchups'),
	isActive: boolean('is_active').default(false),
	createdAt: timestamp('created_at').defaultNow()
});

export const players = pgTable('players', {
	characterName: text('character_name').primaryKey(),
	nickname: text('nickname'),
	profession: text('profession'),
	spec: text('spec'),
	role: text('role'),
	specSource: text('spec_source'),
	tag: text('tag'),
	comment: text('comment'),
	timesSeen: integer('times_seen').default(0),
	winsAgainst: integer('wins_against').default(0),
	lossesAgainst: integer('losses_against').default(0),
	lastSeenAt: timestamp('last_seen_at').defaultNow()
});

export const matches = pgTable('matches', {
	matchId: uuid('match_id').primaryKey().defaultRandom(),
	userProfileId: integer('user_profile_id').references(() => userProfiles.id),
	userTeamColor: text('user_team_color'),
	map: text('map'),
	result: text('result'),
	notes: text('notes'),
	screenshotHash: text('screenshot_hash'),
	adviceText: text('advice_text'),
	timestamp: timestamp('timestamp').defaultNow()
});

export const matchPlayers = pgTable('match_players', {
	id: serial('id').primaryKey(),
	matchId: uuid('match_id').references(() => matches.matchId),
	characterName: text('character_name'),
	team: text('team'),
	profession: text('profession'),
	spec: text('spec'),
	role: text('role'),
	isUser: boolean('is_user').default(false),
	ratingSkill: integer('rating_skill'),
	ratingFriendly: integer('rating_friendly')
});
