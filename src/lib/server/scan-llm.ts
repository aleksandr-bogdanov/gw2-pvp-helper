import { anthropic } from './anthropic.js';
import type { ScanResult } from '$lib/types.js';
import { getDefaultRole, getProfessionForSpec } from '$lib/game-data.js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REFERENCE_IMAGE_PATH = resolve(__dirname, '../../../../data/profession-icons/reference.png');

let referenceImageBase64: string | null = null;
function getReferenceImage(): string {
	if (!referenceImageBase64) {
		referenceImageBase64 = readFileSync(REFERENCE_IMAGE_PATH).toString('base64');
	}
	return referenceImageBase64;
}

const SCAN_SYSTEM = `You are an expert OCR system for Guild Wars 2 PvP scoreboards. You analyze screenshots methodically. You always return raw JSON with no markdown formatting.`;

const SCAN_PROMPT = `You are given TWO images:
1. IMAGE 1: A REFERENCE CHART of all GW2 elite specialization overhead icons, labeled by spec name and grouped by profession.
2. IMAGE 2: A GW2 PvP scoreboard screenshot to analyze.

ONLY analyze the central scoreboard panel in Image 2 — ignore the party list, chat, minimap, and all other UI.

## Layout

- Header row: two TEAM NAMES — skip these, they are not players
- 5 player rows below the header. Each row has:
  LEFT = red team player: [icon] [Name]    ✓/✗  ✓/✗    [Name] [icon] = RIGHT = blue team player

## Step 1: Names

Row by row (1-5), read the red (left) and blue (right) player names exactly. Preserve accents.

## Step 2: Spec icons — VISUAL MATCHING

Each player has an ELITE SPECIALIZATION icon next to their name. This icon identifies their SPEC, not their base profession. Visually compare each icon's SHAPE against the reference chart (Image 1). Ignore color — on the red team background, all icons appear reddish. Focus ONLY on the silhouette shape.

For each icon, write your reasoning:
- Describe the shape you see (e.g., "butterfly wings", "gear with teeth", "skull face", "crossed daggers")
- Find the closest match in the reference chart by comparing silhouettes
- State which spec label it matches from the chart

Valid spec_id values (each has a unique icon in the reference chart):
willbender, firebrand, luminary, dragonhunter, conduit, herald, renegade, vindicator, paragon, berserker, spellbreaker, bladesworn, holosmith, scrapper, mechanist, amalgam, soulbeast, galeshot, druid, untamed, daredevil, specter, deadeye, antiquary, evoker, tempest, catalyst, weaver, virtuoso, mirage, chronomancer, troubadour, reaper, scourge, harbinger, ritualist

If the icon does not match any elite spec and looks like a plain profession emblem, use the base profession name as spec_id (e.g., "guardian", "warrior", "engineer", etc.).

## Step 3: Team color

Which side is the user's team? Look at the scoreboard's visual cues. Set is_user false for all players (app matches by name).

## Output

For each row, write: "Row N: [red name] (icon shape: [description] → [spec_id]) | [blue name] (icon shape: [description] → [spec_id])"
Then output JSON on a line starting with RESULT:

{"user_team_color":"red","red_team":[{"character_name":"...","spec_id":"...","is_user":false}],"blue_team":[...]}`;

async function preprocessImage(imageBase64: string): Promise<{ base64: string; mediaType: string }> {
	const inputBuffer = Buffer.from(imageBase64, 'base64');
	const processed = await sharp(inputBuffer)
		.jpeg({ quality: 95 })
		.toBuffer();
	return { base64: processed.toString('base64'), mediaType: 'image/jpeg' };
}

export async function scanScreenshot(imageBase64: string, mediaType: string): Promise<ScanResult> {
	const refImage = getReferenceImage();
	const { base64: processedImage, mediaType: processedMediaType } = await preprocessImage(imageBase64);

	const response = await anthropic.messages.create({
		model: 'claude-sonnet-4-6',
		max_tokens: 2048,
		temperature: 0,
		system: SCAN_SYSTEM,
		messages: [
			{
				role: 'user',
				content: [
					{
						type: 'image',
						source: {
							type: 'base64',
							media_type: 'image/png',
							data: refImage
						}
					},
					{
						type: 'image',
						source: {
							type: 'base64',
							media_type: processedMediaType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
							data: processedImage
						}
					},
					{ type: 'text', text: SCAN_PROMPT }
				]
			}
		]
	});

	const textBlock = response.content.find((b) => b.type === 'text');
	if (!textBlock || textBlock.type !== 'text') {
		throw new Error('No text response from scan');
	}

	const text = textBlock.text.trim();

	const resultIdx = text.lastIndexOf('RESULT:');
	let jsonText: string;
	if (resultIdx !== -1) {
		jsonText = text.slice(resultIdx + 7).trim();
	} else {
		jsonText = text;
	}

	const fenceMatch = jsonText.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
	if (fenceMatch) {
		jsonText = fenceMatch[1];
	}

	const parsed: ScanResult = JSON.parse(jsonText);

	for (const player of [...parsed.red_team, ...parsed.blue_team]) {
		player.spec_id = (player.spec_id || 'core').toLowerCase();

		// Derive profession_id from spec_id
		const derivedProfession = getProfessionForSpec(player.spec_id);
		if (derivedProfession) {
			player.profession_id = derivedProfession;
		} else {
			// spec_id is a base profession name (core spec) or model output a profession name
			player.profession_id = (player.profession_id || player.spec_id).toLowerCase();
			// Normalize: if spec_id is a profession name, treat as core
			if (player.spec_id === player.profession_id) {
				player.spec_id = 'core';
			}
		}

		(player as any).role = getDefaultRole(player.profession_id, player.spec_id);
		(player as any).spec_source = 'detected';
	}

	return parsed;
}
