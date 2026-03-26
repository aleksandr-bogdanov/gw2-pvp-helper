import type { RequestHandler } from '@sveltejs/kit';
import { anthropic } from '$lib/server/anthropic.js';
import { db } from '$lib/server/db/index.js';
import { userProfiles, matches } from '$lib/server/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { json } from '@sveltejs/kit';
import type { PlayerInfo, MapInfo, ProfileMatchups } from '$lib/types.js';
import { checkAdviceUsage, decrementAdviceCalls } from '$lib/server/usage.js';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '$lib/server/logger.js';
import { getTracer } from '$lib/server/telemetry.js';
import { SpanStatusCode } from '@opentelemetry/api';

// --- Normalize matchups from DB (handles old {threat_level, notes} and new {threat, tip} formats) ---

function normalizeMatchups(raw: unknown): ProfileMatchups | null {
	if (!raw || typeof raw !== 'object') return null;
	// Old format may nest under a "matchups" key
	const data = ('matchups' in (raw as Record<string, unknown>))
		? (raw as Record<string, unknown>).matchups as Record<string, unknown>
		: raw as Record<string, unknown>;
	if (!data || typeof data !== 'object') return null;

	const result: ProfileMatchups = {};
	for (const [key, val] of Object.entries(data)) {
		if (typeof val === 'string') {
			// Old format: "RESPECT — some tip text"
			const match = val.match(/^(HUNT|RESPECT|AVOID)\s*[—–-]\s*(.*)/i);
			if (match) {
				result[key.toLowerCase()] = { threat: match[1].toUpperCase() as 'HUNT' | 'RESPECT' | 'AVOID', tip: match[2].trim() };
			}
		} else if (val && typeof val === 'object') {
			const threat = ((val as any).threat ?? (val as any).threat_level ?? '').toUpperCase();
			const tip = (val as any).tip ?? (val as any).notes ?? '';
			if (threat) {
				result[key.toLowerCase()] = { threat: threat as 'HUNT' | 'RESPECT' | 'AVOID', tip };
			}
		}
	}
	return Object.keys(result).length > 0 ? result : null;
}

// --- Data loading (cached at module level) ---

function loadDataFile(filename: string): string {
	return readFileSync(resolve('data', filename), 'utf-8');
}

interface MetaProfile {
	spec_id: string;
	profession_id: string;
	label: string;
	meta_role: string;
	kill_window: string;
	key_threats: string[];
	dont_hit: { skill: string; response: string }[];
	notes: string;
}

const metaProfiles: Record<string, MetaProfile> = JSON.parse(
	readFileSync(resolve('data', 'meta-profiles.json'), 'utf-8')
);

// --- Meta profile lookup ---

function lookupMetaProfile(specId: string, role: string): MetaProfile | null {
	// Try variant key first (e.g. "firebrand_heal"), then bare spec_id
	return metaProfiles[`${specId}_${role}`] ?? metaProfiles[specId] ?? null;
}

// --- Dynamic context assembly ---

function buildMatchContext(
	enemyTeam: PlayerInfo[],
	myTeam: PlayerInfo[],
	matchups: ProfileMatchups | null
): string {
	const sections: string[] = [];

	// Inject meta profiles for all 10 players in the match
	const seen = new Set<string>();
	const allPlayers = [...enemyTeam, ...myTeam];
	const profileLines: string[] = [];

	for (const player of allPlayers) {
		const profile = lookupMetaProfile(player.spec_id, player.role);
		if (!profile) continue;

		// Deduplicate by label (e.g. two Reapers only get one profile block)
		if (seen.has(profile.label)) continue;
		seen.add(profile.label);

		let line = `**${profile.label}** (${profile.meta_role}): ${profile.notes}`;
		if (profile.kill_window) {
			line += ` Window: ${profile.kill_window}.`;
		}
		for (const dh of profile.dont_hit) {
			line += ` DON'T HIT: ${dh.skill} — ${dh.response}.`;
		}
		profileLines.push(line);
	}

	if (profileLines.length > 0) {
		sections.push(
			'## MATCH-SPECIFIC BUILD PROFILES\n\n' + profileLines.join('\n\n')
		);
	}

	// Inject per-enemy matchup assessments from the player's profile
	if (matchups) {
		const matchupLines: string[] = [];
		for (const enemy of enemyTeam) {
			const assessment = matchups[enemy.spec_id];
			if (assessment) {
				matchupLines.push(
					`- **${enemy.character_name}** (${enemy.spec_id}): **${assessment.threat}** — ${assessment.tip}`
				);
			}
		}
		if (matchupLines.length > 0) {
			sections.push(
				'## YOUR MATCHUP ASSESSMENTS\n\nThese are YOUR build-specific threat ratings for each enemy. Use these as the default threat level in the PER-ENEMY BREAKDOWN unless you have a strong reason to override.\n\n' +
					matchupLines.join('\n')
			);
		}
	}

	return sections.length > 0 ? '\n\n' + sections.join('\n\n') : '';
}

// --- Prompt assembly ---

interface SystemBlock {
	type: 'text';
	text: string;
	cache_control?: { type: 'ephemeral' };
}

function buildSystemPrompt(
	profilePrompt: string | null,
	role: string,
	enemyTeam: PlayerInfo[],
	myTeam: PlayerInfo[],
	matchups: ProfileMatchups | null
): SystemBlock[] {
	// Layer 1: Universal game knowledge (slim — no meta profiles)
	const layer1 = loadDataFile('universal-game-knowledge.md');

	// Layer 3: Output format (based on role — only 2 variants, both static)
	const isSupport =
		role === 'support' || role === 'heal' || role === 'supp' || role === 'alac';
	const layer3 = isSupport
		? loadDataFile('output-format-support.md')
		: loadDataFile('output-format-dps.md');

	// Static prefix: game knowledge + output format (~3500 tokens, identical across calls per role)
	// Cached via Anthropic prompt caching — saves ~35% on input token costs
	const staticPrefix = `You are a GW2 PvP tactical advisor.\n\n${layer1}\n\n${layer3}`;

	// Dynamic: match-specific profiles + matchup assessments + player build
	const matchContext = buildMatchContext(enemyTeam, myTeam, matchups);
	const layer2 = profilePrompt
		? `\n\nTHE PLAYER'S BUILD:\n${profilePrompt}`
		: '';
	const dynamicSuffix = `${matchContext}${layer2}`;

	const blocks: SystemBlock[] = [
		{ type: 'text', text: staticPrefix, cache_control: { type: 'ephemeral' } }
	];
	if (dynamicSuffix.trim()) {
		blocks.push({ type: 'text', text: dynamicSuffix });
	}
	return blocks;
}

function buildUserPrompt(
	myTeam: PlayerInfo[],
	enemyTeam: PlayerInfo[],
	map: MapInfo | null,
	buildLabel: string | null,
	role: string
): string {
	const formatTeam = (team: PlayerInfo[]) =>
		team
			.map(
				(p, i) =>
					`${i + 1}. ${p.character_name} — ${p.spec_id} (${p.profession_id}) — ${p.role}${p.is_user ? ' ← ME' : ''}`
			)
			.join('\n');

	const mapLine = map
		? `Map: ${map.name} (${map.mode}) — ${map.mechanic}`
		: 'Map: Unknown';

	return `CHARACTER: ${buildLabel || 'Unknown'}
ROLE: ${role}
${mapLine}

ENEMY TEAM (these are the opponents — your kill targets):
${formatTeam(enemyTeam)}

MY TEAM (these are your allies — do NOT list them as kill targets):
${formatTeam(myTeam)}

Follow the output format from your system prompt EXACTLY. Sections must appear in the specified order. 2-3 lines per enemy MAX — cheat card, not essay.
REMINDER: Focus order must contain ONLY enemies. Per-enemy sections must each be self-contained — no shared notes between enemy blocks.`;
}

// --- Handler ---

export const POST: RequestHandler = async ({ request, locals }) => {
	const { myTeam, enemyTeam, map, profileId, matchId } = await request.json();
	const userId = locals.effectiveUserId;

	// --- Usage limit check ---
	let activeClient = anthropic;
	let activeModel = 'claude-sonnet-4-6';

	if (userId) {
		const usage = await checkAdviceUsage(userId);
		if (!usage.allowed) {
			logger.warn({ event: 'rate_limited', userId, type: 'advice' }, 'Free advice calls exhausted');
			return json(
				{ error: 'Free advice calls exhausted', remaining: 0, byok_available: true },
				{ status: 429 }
			);
		}

		if (usage.isByok && usage.apiKey) {
			activeClient = new Anthropic({ apiKey: usage.apiKey });
			activeModel = usage.model ?? 'claude-sonnet-4-6';
		} else {
			// Decrement counter for free-tier users (before streaming, to prevent races)
			await decrementAdviceCalls(userId);
		}
	}

	// Load active profile (by explicit ID or find the active one)
	let profile: {
		profilePrompt: string | null;
		buildLabel: string | null;
		role: string;
		matchups: unknown;
	} | null = null;

	if (profileId) {
		const conditions = userId
			? and(eq(userProfiles.id, profileId), eq(userProfiles.userId, userId))
			: eq(userProfiles.id, profileId);
		const [found] = await db.select().from(userProfiles).where(conditions);
		if (found) profile = found;
	} else {
		const conditions = userId
			? and(eq(userProfiles.isActive, true), eq(userProfiles.userId, userId))
			: eq(userProfiles.isActive, true);
		const [active] = await db.select().from(userProfiles).where(conditions);
		if (active) profile = active;
	}

	const profilePrompt = profile?.profilePrompt ?? null;
	const buildLabel = profile?.buildLabel ?? null;
	const role = profile?.role ?? 'dps';
	const matchups = normalizeMatchups(profile?.matchups) ?? null;

	const systemBlocks = buildSystemPrompt(
		profilePrompt,
		role,
		enemyTeam,
		myTeam,
		matchups
	);
	const userMessage = buildUserPrompt(myTeam, enemyTeam, map, buildLabel, role);

	logger.info({ event: 'advice_requested', userId, model: activeModel, map: map?.name ?? 'unknown' }, 'Advice generation started');

	const tracer = getTracer();
	const adviceSpan = tracer.startSpan('advice.generate', {
		attributes: {
			'advice.model': activeModel,
			'advice.user_id': userId ?? 0,
			'advice.map': map?.name ?? 'unknown'
		}
	});

	const stream = await activeClient.messages.stream({
		model: activeModel,
		max_tokens: 1500,
		system: systemBlocks,
		messages: [{ role: 'user', content: userMessage }]
	});

	const encoder = new TextEncoder();
	let aborted = false;

	return new Response(
		new ReadableStream({
			async start(controller) {
				let totalChars = 0;
				const rawChunks: string[] = [];
				try {
					for await (const event of stream) {
						if (aborted) break;
						if (
							event.type === 'content_block_delta' &&
							event.delta.type === 'text_delta'
						) {
							totalChars += event.delta.text.length;
							rawChunks.push(event.delta.text);
							controller.enqueue(
								encoder.encode(
									`data: ${JSON.stringify({ text: event.delta.text })}\n\n`
								)
							);
						}
					}

					// Capture token usage from the final message
					const finalMessage = await stream.finalMessage();
					const tokensIn = finalMessage.usage?.input_tokens ?? 0;
					const tokensOut = finalMessage.usage?.output_tokens ?? 0;

					adviceSpan.setAttribute('advice.tokens_in', tokensIn);
					adviceSpan.setAttribute('advice.tokens_out', tokensOut);
					adviceSpan.setAttribute('advice.chars_out', totalChars);
					adviceSpan.setStatus({ code: SpanStatusCode.OK });

					// Save advice_raw to match record
					const adviceRaw = rawChunks.join('');
					if (matchId && adviceRaw) {
						db.update(matches)
							.set({ adviceRaw })
							.where(eq(matches.matchId, matchId))
							.catch((e) => {
								logger.warn({ event: 'advice_raw_save_failed', matchId, error: e instanceof Error ? e.message : String(e) }, 'Failed to save advice_raw');
							});
					}

					logger.info({
						event: 'advice_complete',
						userId,
						model: activeModel,
						tokensIn,
						tokensOut,
						totalChars
					}, 'Advice generation completed');

					controller.enqueue(encoder.encode('data: [DONE]\n\n'));
				} catch (err) {
					const message =
						err instanceof Error ? err.message : 'Stream error';
					adviceSpan.setStatus({ code: SpanStatusCode.ERROR, message });
					logger.error({ event: 'advice_error', userId, error: message }, 'Advice stream error');
					controller.enqueue(
						encoder.encode(
							`data: ${JSON.stringify({ error: message })}\n\n`
						)
					);
				} finally {
					adviceSpan.end();
					controller.close();
				}
			},
			cancel() {
				aborted = true;
				stream.abort();
				logger.info({ event: 'advice_client_disconnected', userId }, 'Client disconnected, Anthropic stream aborted');
			}
		}),
		{
			headers: {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
				Connection: 'keep-alive'
			}
		}
	);
};
