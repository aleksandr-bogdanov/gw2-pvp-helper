import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { anthropic } from '$lib/server/anthropic.js';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { checkProfileUsage, decrementProfileGens } from '$lib/server/usage.js';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '$lib/server/logger.js';

const profileGenPrompt = readFileSync(resolve('data', 'profile-generation-prompt.md'), 'utf-8');

// ─── Weapon skills ground truth (from GW2 API, fetched by scripts/fetch-gw2-api.ts) ───

interface WeaponSkillEntry {
	slot: number;
	name: string;
	offhand?: string;
	attunement?: string;
}

interface WeaponEntry {
	type: 'mainhand' | 'offhand' | 'twohand';
	specialization?: number;
	skills: WeaponSkillEntry[];
}

interface WeaponSkillsData {
	_meta: { fetchedAt: string; specializationNames: Record<string, string> };
	professions: Record<string, Record<string, WeaponEntry>>;
}

let weaponSkillsData: WeaponSkillsData | null = null;
try {
	weaponSkillsData = JSON.parse(readFileSync(resolve('data', 'weapon-skills.json'), 'utf-8'));
} catch {
	logger.warn({ event: 'weapon_skills_missing' }, 'weapon-skills.json not found — run: bun run fetch-api');
}

/**
 * Formats a list of skills into output lines.
 * For elementalist (skills with attunement), groups by attunement.
 * For other professions, produces a flat numbered list.
 */
function formatSkillLines(skills: WeaponSkillEntry[], indent: string = '  '): string[] {
	const hasAttunements = skills.some((s) => s.attunement);
	if (!hasAttunements) {
		return skills.map((s) => `${indent}${s.slot}. ${s.name}`);
	}

	// Group by attunement, preserving order of first appearance
	const attunementOrder: string[] = [];
	const grouped = new Map<string, WeaponSkillEntry[]>();
	for (const skill of skills) {
		const att = skill.attunement ?? 'Unknown';
		if (!grouped.has(att)) {
			attunementOrder.push(att);
			grouped.set(att, []);
		}
		grouped.get(att)!.push(skill);
	}

	const lines: string[] = [];
	for (const att of attunementOrder) {
		lines.push(`${indent}${att}:`);
		for (const skill of grouped.get(att)!) {
			lines.push(`${indent}  ${skill.slot}. ${skill.name}`);
		}
	}
	return lines;
}

/**
 * Resolves a weapon set string like "Sword/Dagger" into a formatted list of weapon skills.
 * Handles mainhand + offhand combos, two-hand weapons, thief dual-wield (slot 3 variants),
 * and elementalist attunement grouping.
 */
function resolveWeaponSkills(profession: string, weaponSet: string): string | null {
	if (!weaponSkillsData || !weaponSet || weaponSet === 'not specified') return null;

	const profData = weaponSkillsData.professions[profession.toLowerCase()];
	if (!profData) return null;

	const parts = weaponSet.split('/').map((w) => w.trim());
	const collected: WeaponSkillEntry[] = [];

	if (parts.length === 1) {
		// Two-hand weapon (e.g. "Shortbow", "Staff")
		const weapon = parts[0];
		const entry = profData[weapon];
		if (!entry) return null;

		for (const skill of entry.skills) {
			collected.push(skill);
		}
	} else if (parts.length === 2) {
		const [mhName, ohName] = parts;

		// Mainhand skills (slots 1-3)
		const mhEntry = profData[mhName] ?? profData[`${mhName} (mainhand)`];
		if (mhEntry) {
			for (const skill of mhEntry.skills) {
				if (skill.slot > 3) continue;
				// For thief dual-wield: only show the slot-3 skill matching our offhand
				if (skill.slot === 3 && skill.offhand) {
					if (skill.offhand !== ohName) continue;
				}
				collected.push(skill);
			}
		}

		// Offhand skills (slots 4-5)
		const ohEntry = profData[ohName] ?? profData[`${ohName} (offhand)`];
		if (ohEntry) {
			for (const skill of ohEntry.skills) {
				if (skill.slot < 4) continue;
				collected.push(skill);
			}
		}
	}

	const lines = formatSkillLines(collected);
	return lines.length > 0 ? lines.join('\n') : null;
}

// Extract the system prompt from the markdown (between the ``` fences)
function extractSystemPrompt(): string {
	const match = profileGenPrompt.match(/```\n([\s\S]*?)\n```/);
	return match ? match[1] : profileGenPrompt;
}

function parseProfileAndMatchups(fullText: string): {
	profilePrompt: string;
	matchups: Record<string, { threat: string; tip: string }> | null;
} {
	let matchups: Record<string, { threat: string; tip: string }> | null = null;
	const jsonMatch = fullText.match(/```json\s*(\{[\s\S]*?\})\s*```/);
	if (jsonMatch) {
		try {
			matchups = JSON.parse(jsonMatch[1]);
		} catch {
			// non-critical
		}
	}

	let profilePrompt = fullText;
	const matchupSectionIdx = fullText.indexOf('MATCHUP ASSESSMENTS:');
	if (matchupSectionIdx !== -1) {
		profilePrompt = fullText.slice(0, matchupSectionIdx).trim();
	} else if (jsonMatch) {
		profilePrompt = fullText.replace(/```json[\s\S]*?```/, '').trim();
	}

	return { profilePrompt, matchups };
}

export const POST: RequestHandler = async ({ request, locals }) => {
	const userId = locals.effectiveUserId;

	// --- Usage limit check ---
	let activeClient = anthropic;

	if (userId) {
		const usage = await checkProfileUsage(userId);
		if (!usage.allowed) {
			return json(
				{ error: 'Free profile generations exhausted', remaining: 0, byok_available: true },
				{ status: 429 }
			);
		}

		if (usage.isByok && usage.apiKey) {
			activeClient = new Anthropic({ apiKey: usage.apiKey });
		} else {
			// Atomic decrement — returns -1 if another request already consumed the last call
			const remaining = await decrementProfileGens(userId);
			if (remaining < 0) {
				return json(
					{ error: 'Free profile generations exhausted', remaining: 0, byok_available: true },
					{ status: 429 }
				);
			}
		}
	}

	const body = await request.json();
	const { profession, spec, role, weaponsMain, weaponsSwap, buildLabel, playstyle, weaknesses, decodedBuild, rune, relic, amulet, sigilsMain, sigilsSwap } = body;

	if (!profession || !spec || !role) {
		throw error(400, 'Missing required fields: profession, spec, role');
	}

	const systemPrompt = extractSystemPrompt();

	let userMessage = `Build Information:
- Profession: ${profession}
- Elite Spec: ${spec}
- Role: ${role}
- Weapons (main): ${weaponsMain || 'not specified'}
- Weapons (swap): ${weaponsSwap || 'not specified'}
- Rune: ${rune || 'not specified'}
- Relic: ${relic || 'not specified'}
- Amulet: ${amulet || 'not specified'}
- Sigils (main set): ${sigilsMain || 'not specified'}
- Sigils (swap set): ${sigilsSwap || 'not specified'}
- Build Label: ${buildLabel || 'unlabeled'}`;

	if (decodedBuild) {
		userMessage += `

EXACT BUILD (decoded from in-game build template code — this is authoritative, do NOT guess different skills or traits):
${decodedBuild}`;
	}

	// Add weapon skills ground truth from GW2 API data
	const mainSkills = resolveWeaponSkills(profession, weaponsMain);
	const swapSkills = resolveWeaponSkills(profession, weaponsSwap);
	if (mainSkills || swapSkills) {
		userMessage += `

WEAPON SKILLS (from GW2 API — these are the EXACT skills on each weapon bar, do NOT substitute or add skills from other weapons):`;
		if (mainSkills) {
			userMessage += `\nMain set (${weaponsMain}):\n${mainSkills}`;
		}
		if (swapSkills) {
			userMessage += `\nSwap set (${weaponsSwap}):\n${swapSkills}`;
		}
	}

	userMessage += `

Playstyle Description:
${playstyle || 'No description provided. Generate a basic profile for this spec and role.'}

${weaknesses ? `What gets them killed most often:\n${weaknesses}` : ''}`;

	const stream = await activeClient.messages.stream({
		model: 'claude-opus-4-6',
		max_tokens: 3000,
		system: systemPrompt,
		messages: [{ role: 'user', content: userMessage }]
	});

	const encoder = new TextEncoder();

	return new Response(
		new ReadableStream({
			async start(controller) {
				let fullText = '';
				try {
					for await (const event of stream) {
						if (
							event.type === 'content_block_delta' &&
							event.delta.type === 'text_delta'
						) {
							fullText += event.delta.text;
							controller.enqueue(
								encoder.encode(
									`data: ${JSON.stringify({ text: event.delta.text })}\n\n`
								)
							);
						}
					}

					// Parse the complete text into profile + matchups
					const { profilePrompt, matchups } = parseProfileAndMatchups(fullText);

					// Send the final parsed result
					controller.enqueue(
						encoder.encode(
							`data: ${JSON.stringify({ done: true, profilePrompt, matchups })}\n\n`
						)
					);
				} catch (err) {
					const message = err instanceof Error ? err.message : 'Generation error';
					controller.enqueue(
						encoder.encode(
							`data: ${JSON.stringify({ error: message })}\n\n`
						)
					);
				} finally {
					controller.close();
				}
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
