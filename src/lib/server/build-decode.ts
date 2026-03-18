/**
 * GW2 Build Template Code Decoder
 *
 * Decodes chat codes like [&DQILGhYqSh55HacAsgBqALAAcQB+HbIA7gCcAAAAAAAAAAAAAAAAAAAAAAA=]
 * into structured build data (profession, specializations, traits, skills).
 *
 * Binary format: base64-encoded, little-endian, 44+ bytes.
 * Skills are palette IDs resolved via the GW2 API.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DecodedBuild {
	profession: string; // e.g. "thief"
	specializations: {
		id: number;
		name?: string;
		traits: { adept: number; master: number; grandmaster: number };
		traitNames?: { adept: string; master: string; grandmaster: string };
	}[];
	skills: {
		heal?: { paletteId: number; id?: number; name?: string };
		utilities: { paletteId: number; id?: number; name?: string }[];
		elite?: { paletteId: number; id?: number; name?: string };
	};
	/** Weapon types decoded from trailing bytes (SotO+) */
	weapons: string[];
	/** Ranger pets or Revenant legends */
	professionSpecific?: {
		type: 'ranger_pets' | 'revenant_legends';
		terrestrial: [number, number];
		aquatic: [number, number];
	};
}

export interface ResolvedBuild {
	profession: string;
	/** The elite specialization ID (lowercased, matching specs.json), or 'core' if none */
	eliteSpec: string;
	specializations: {
		name: string;
		isElite: boolean;
		traits: { adept: string; master: string; grandmaster: string };
	}[];
	heal: string;
	utilities: string[];
	elite: string;
	/** Weapon type names from build code (e.g. ["Sword", "Dagger", "Shortbow"]) */
	weapons: string[];
	/** Ranger pets or Revenant legends (names) */
	professionSpecific?: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const PROFESSION_BY_CODE: Record<number, string> = {
	1: 'guardian',
	2: 'warrior',
	3: 'engineer',
	4: 'ranger',
	5: 'thief',
	6: 'elementalist',
	7: 'mesmer',
	8: 'necromancer',
	9: 'revenant'
};

const PROFESSION_API_NAMES: Record<string, string> = {
	guardian: 'Guardian',
	warrior: 'Warrior',
	engineer: 'Engineer',
	ranger: 'Ranger',
	thief: 'Thief',
	elementalist: 'Elementalist',
	mesmer: 'Mesmer',
	necromancer: 'Necromancer',
	revenant: 'Revenant'
};

const WEAPON_BY_PALETTE: Record<number, string> = {
	0x0005: 'Axe',
	0x0023: 'Longbow',
	0x002f: 'Dagger',
	0x0031: 'Focus',
	0x0032: 'Greatsword',
	0x0033: 'Hammer',
	0x0035: 'Mace',
	0x0036: 'Pistol',
	0x0055: 'Rifle',
	0x0056: 'Scepter',
	0x0057: 'Shield',
	0x0059: 'Staff',
	0x005a: 'Sword',
	0x0066: 'Torch',
	0x0067: 'Warhorn',
	0x006b: 'Shortbow',
	0x0109: 'Spear'
};

// ─── In-memory caches (process lifetime) ────────────────────────────────────

const paletteCache = new Map<string, Map<number, number>>(); // profession → (paletteId → skillId)
const skillNameCache = new Map<number, string>(); // skillId → name
const specCache = new Map<number, { name: string; majorTraits: number[]; elite: boolean }>(); // specId → data
const traitNameCache = new Map<number, string>(); // traitId → name

// ─── Binary Decoder ─────────────────────────────────────────────────────────

export function decodeBuildCode(code: string): DecodedBuild {
	// Strip [& ... ] wrapper if present
	let raw = code.trim();
	if (raw.startsWith('[&') && raw.endsWith(']')) {
		raw = raw.slice(2, -1);
	}

	const bytes = Buffer.from(raw, 'base64');

	if (bytes.length < 28) {
		throw new Error(`Build code too short: ${bytes.length} bytes (need ≥28)`);
	}

	const type = bytes[0];
	if (type !== 0x0d) {
		throw new Error(`Not a build template code (type 0x${type.toString(16)}, expected 0x0d)`);
	}

	const profCode = bytes[1];
	const profession = PROFESSION_BY_CODE[profCode];
	if (!profession) {
		throw new Error(`Unknown profession code: ${profCode}`);
	}

	// 3 specialization lines
	const specializations = [];
	for (let i = 0; i < 3; i++) {
		const specId = bytes[2 + i * 2];
		const traitByte = bytes[3 + i * 2];
		specializations.push({
			id: specId,
			traits: {
				adept: traitByte & 0x03,
				master: (traitByte >> 2) & 0x03,
				grandmaster: (traitByte >> 4) & 0x03
			}
		});
	}

	// Skills (terrestrial only — aquatic is interleaved)
	const readU16 = (offset: number) => bytes[offset] | (bytes[offset + 1] << 8);

	const healPalette = readU16(8);
	const util1Palette = readU16(12);
	const util2Palette = readU16(16);
	const util3Palette = readU16(20);
	const elitePalette = readU16(24);

	const skills = {
		heal: healPalette ? { paletteId: healPalette } : undefined,
		utilities: [util1Palette, util2Palette, util3Palette]
			.filter((p) => p !== 0)
			.map((p) => ({ paletteId: p })),
		elite: elitePalette ? { paletteId: elitePalette } : undefined
	};

	// Profession-specific data (offset 28-31)
	let professionSpecific: DecodedBuild['professionSpecific'];
	if (bytes.length >= 32) {
		if (profession === 'ranger') {
			professionSpecific = {
				type: 'ranger_pets',
				terrestrial: [bytes[28], bytes[29]],
				aquatic: [bytes[30], bytes[31]]
			};
		} else if (profession === 'revenant') {
			professionSpecific = {
				type: 'revenant_legends',
				terrestrial: [bytes[28], bytes[29]],
				aquatic: [bytes[30], bytes[31]]
			};
		}
	}

	// Weapon palette IDs (SotO extension, offset 44+)
	const weapons: string[] = [];
	if (bytes.length > 44) {
		const weaponCount = bytes[44];
		for (let i = 0; i < weaponCount; i++) {
			const offset = 45 + i * 2;
			if (offset + 1 >= bytes.length) break;
			const paletteId = readU16(offset);
			const name = WEAPON_BY_PALETTE[paletteId];
			if (name) weapons.push(name);
		}
	}

	return { profession, specializations, skills, weapons, professionSpecific };
}

// ─── GW2 API Resolution ─────────────────────────────────────────────────────

async function fetchPaletteMap(profession: string): Promise<Map<number, number>> {
	if (paletteCache.has(profession)) {
		return paletteCache.get(profession)!;
	}

	const apiName = PROFESSION_API_NAMES[profession];
	const res = await fetch(`https://api.guildwars2.com/v2/professions/${apiName}?v=latest`);
	if (!res.ok) {
		throw new Error(`GW2 API error fetching profession ${apiName}: ${res.status}`);
	}

	const data = await res.json();
	const map = new Map<number, number>();
	for (const [paletteId, skillId] of data.skills_by_palette) {
		map.set(paletteId, skillId);
	}

	paletteCache.set(profession, map);
	return map;
}

async function fetchSkillNames(skillIds: number[]): Promise<void> {
	const missing = skillIds.filter((id) => id && !skillNameCache.has(id));
	if (missing.length === 0) return;

	// GW2 API accepts up to 200 IDs per request
	const chunks = [];
	for (let i = 0; i < missing.length; i += 200) {
		chunks.push(missing.slice(i, i + 200));
	}

	for (const chunk of chunks) {
		const res = await fetch(
			`https://api.guildwars2.com/v2/skills?ids=${chunk.join(',')}&lang=en`
		);
		if (!res.ok) continue;
		const skills = await res.json();
		for (const skill of skills) {
			skillNameCache.set(skill.id, skill.name);
		}
	}
}

async function fetchSpecializations(specIds: number[]): Promise<void> {
	const missing = specIds.filter((id) => id && !specCache.has(id));
	if (missing.length === 0) return;

	const res = await fetch(
		`https://api.guildwars2.com/v2/specializations?ids=${missing.join(',')}&lang=en`
	);
	if (!res.ok) return;

	const specializations = await res.json();
	for (const spec of specializations) {
		specCache.set(spec.id, {
			name: spec.name,
			majorTraits: spec.major_traits, // array of 9 trait IDs: [adept×3, master×3, grandmaster×3]
			elite: spec.elite ?? false
		});
	}
}

async function fetchTraitNames(traitIds: number[]): Promise<void> {
	const missing = traitIds.filter((id) => id && !traitNameCache.has(id));
	if (missing.length === 0) return;

	const chunks = [];
	for (let i = 0; i < missing.length; i += 200) {
		chunks.push(missing.slice(i, i + 200));
	}

	for (const chunk of chunks) {
		const res = await fetch(
			`https://api.guildwars2.com/v2/traits?ids=${chunk.join(',')}&lang=en`
		);
		if (!res.ok) continue;
		const traits = await res.json();
		for (const trait of traits) {
			traitNameCache.set(trait.id, trait.name);
		}
	}
}

// ─── Full Resolution ────────────────────────────────────────────────────────

export async function resolveBuild(decoded: DecodedBuild): Promise<ResolvedBuild> {
	// 1. Fetch palette → skill ID mapping
	const paletteMap = await fetchPaletteMap(decoded.profession);

	// 2. Resolve palette IDs to skill IDs
	const allSkillPaletteIds = [
		decoded.skills.heal?.paletteId,
		...decoded.skills.utilities.map((u) => u.paletteId),
		decoded.skills.elite?.paletteId
	].filter((id): id is number => !!id);

	const skillIds = allSkillPaletteIds
		.map((pid) => paletteMap.get(pid))
		.filter((id): id is number => !!id);

	// 3. Fetch all names in parallel
	const specIds = decoded.specializations.map((s) => s.id).filter((id) => id !== 0);

	await Promise.all([fetchSkillNames(skillIds), fetchSpecializations(specIds)]);

	// 4. Collect trait IDs we need to resolve
	const traitIds: number[] = [];
	for (const spec of decoded.specializations) {
		if (spec.id === 0) continue;
		const specData = specCache.get(spec.id);
		if (!specData) continue;
		const mt = specData.majorTraits;
		// Each tier has 3 traits; choice 1/2/3 maps to index 0/1/2
		if (spec.traits.adept > 0) traitIds.push(mt[(spec.traits.adept - 1)]);
		if (spec.traits.master > 0) traitIds.push(mt[3 + (spec.traits.master - 1)]);
		if (spec.traits.grandmaster > 0) traitIds.push(mt[6 + (spec.traits.grandmaster - 1)]);
	}

	await fetchTraitNames(traitIds);

	// 5. Build resolved output
	let eliteSpec = 'core';
	const resolvedSpecs = decoded.specializations
		.filter((s) => s.id !== 0)
		.map((spec) => {
			const specData = specCache.get(spec.id);
			const mt = specData?.majorTraits ?? [];
			const isElite = specData?.elite ?? false;

			if (isElite && specData?.name) {
				eliteSpec = specData.name.toLowerCase();
			}

			const getTraitName = (tier: number, choice: number): string => {
				if (choice === 0) return '(none)';
				const traitId = mt[tier * 3 + (choice - 1)];
				return traitNameCache.get(traitId) ?? `trait:${traitId}`;
			};

			return {
				name: specData?.name ?? `spec:${spec.id}`,
				isElite,
				traits: {
					adept: getTraitName(0, spec.traits.adept),
					master: getTraitName(1, spec.traits.master),
					grandmaster: getTraitName(2, spec.traits.grandmaster)
				}
			};
		});

	const resolveSkill = (paletteId: number | undefined): string => {
		if (!paletteId) return '(none)';
		const skillId = paletteMap.get(paletteId);
		if (!skillId) return `palette:${paletteId}`;
		return skillNameCache.get(skillId) ?? `skill:${skillId}`;
	};

	return {
		profession: decoded.profession,
		eliteSpec,
		specializations: resolvedSpecs,
		heal: resolveSkill(decoded.skills.heal?.paletteId),
		utilities: decoded.skills.utilities.map((u) => resolveSkill(u.paletteId)),
		elite: resolveSkill(decoded.skills.elite?.paletteId),
		weapons: decoded.weapons,
	};
}

// ─── Convenience: decode + resolve in one call ──────────────────────────────

export async function decodeBuildTemplate(code: string): Promise<ResolvedBuild> {
	const decoded = decodeBuildCode(code);
	return resolveBuild(decoded);
}

// ─── Format for prompt ──────────────────────────────────────────────────────

export function formatBuildForPrompt(build: ResolvedBuild): string {
	const lines: string[] = [];

	lines.push(`Profession: ${build.profession}`);
	lines.push('');
	lines.push('Trait Lines:');
	for (const spec of build.specializations) {
		lines.push(
			`  ${spec.name}: ${spec.traits.adept}, ${spec.traits.master}, ${spec.traits.grandmaster}`
		);
	}

	if (build.weapons.length > 0) {
		lines.push('');
		lines.push(`Weapons: ${build.weapons.join(', ')}`);
	}

	lines.push('');
	lines.push(`Heal Skill: ${build.heal}`);
	lines.push(`Utility Skills: ${build.utilities.join(', ')}`);
	lines.push(`Elite Skill: ${build.elite}`);

	return lines.join('\n');
}
