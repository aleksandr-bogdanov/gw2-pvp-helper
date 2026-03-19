import { pgTable, serial, text, boolean, integer, timestamp, uuid, jsonb } from 'drizzle-orm/pg-core';

// --- Users & Auth ---

export const users = pgTable('users', {
	id: serial('id').primaryKey(),
	username: text('username').unique().notNull(),
	passwordHash: text('password_hash'),
	inviteCodeUsed: text('invite_code_used').notNull(),
	role: text('role').default('user').notNull(),
	deviceInfo: jsonb('device_info'),
	adviceCallsRemaining: integer('advice_calls_remaining').default(15).notNull(),
	profileGensRemaining: integer('profile_gens_remaining').default(3).notNull(),
	byokApiKeyEncrypted: text('byok_api_key_encrypted'),
	byokModelPreference: text('byok_model_preference').default('claude-sonnet-4-6'),
	consentGivenAt: timestamp('consent_given_at'),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	lastSeenAt: timestamp('last_seen_at').defaultNow().notNull()
});

export const sessions = pgTable('sessions', {
	token: text('token').primaryKey(),
	userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
	expiresAt: timestamp('expires_at').notNull(),
	impersonatingUserId: integer('impersonating_user_id').references(() => users.id, { onDelete: 'set null' })
});

export const usedInviteCodes = pgTable('used_invite_codes', {
	code: text('code').primaryKey(),
	userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
	usedAt: timestamp('used_at').defaultNow().notNull()
});

// --- Game Data ---

export const userProfiles = pgTable('user_profiles', {
	id: serial('id').primaryKey(),
	userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
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
	id: serial('id').primaryKey(),
	characterName: text('character_name').notNull(),
	userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
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
	userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
	userProfileId: integer('user_profile_id').references(() => userProfiles.id),
	userTeamColor: text('user_team_color'),
	map: text('map'),
	result: text('result'),
	notes: text('notes'),
	screenshotHash: text('screenshot_hash'),
	adviceText: text('advice_text'),
	adviceRaw: text('advice_raw'),
	timestamp: timestamp('timestamp').defaultNow()
});

// --- Training Data ---

export const trainingSamples = pgTable('training_samples', {
	id: serial('id').primaryKey(),
	userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
	screenshotHash: text('screenshot_hash').unique().notNull(),
	screenshotPath: text('screenshot_path').notNull(),
	resolution: text('resolution'),
	uiSize: text('ui_size'),
	deviceInfo: jsonb('device_info'),
	scanResult: jsonb('scan_result'),
	userCorrections: jsonb('user_corrections'),
	confidenceScores: jsonb('confidence_scores'),
	anchorPosition: jsonb('anchor_position'),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	reviewedByAdmin: boolean('reviewed_by_admin').default(false).notNull()
});

// --- Minimap References ---

export const minimapReferences = pgTable('minimap_references', {
	id: serial('id').primaryKey(),
	mapId: text('map_id').notNull(),
	source: text('source').notNull().default('static'),
	screenshotHash: text('screenshot_hash'),
	thumbnailData: text('thumbnail_data').notNull(),
	createdAt: timestamp('created_at').defaultNow().notNull()
});

export const matchPlayers = pgTable('match_players', {
	id: serial('id').primaryKey(),
	matchId: uuid('match_id').references(() => matches.matchId, { onDelete: 'cascade' }),
	characterName: text('character_name'),
	team: text('team'),
	profession: text('profession'),
	spec: text('spec'),
	role: text('role'),
	isUser: boolean('is_user').default(false),
	ratingSkill: integer('rating_skill'),
	ratingFriendly: integer('rating_friendly')
});
