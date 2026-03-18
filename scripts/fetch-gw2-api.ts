/**
 * Fetches weapon skill data for all professions from the GW2 API.
 * Run manually after balance patches or new expansions:
 *   npx tsx scripts/fetch-gw2-api.ts
 *
 * Output: data/weapon-skills.json
 *
 * Structure per profession per weapon:
 *   { slot: "Weapon_1"|..., name: "Skill Name", offhand?: "Dagger"|... }
 * Thief has dual-wield skills where Weapon_3 changes based on offhand.
 */
import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUTPUT = resolve(ROOT, 'data/weapon-skills.json');

const PROFESSIONS = [
	'Guardian',
	'Revenant',
	'Warrior',
	'Engineer',
	'Ranger',
	'Thief',
	'Elementalist',
	'Mesmer',
	'Necromancer'
];

// Slot label for display (Weapon_1 → "1", etc.)
const SLOT_NUM: Record<string, number> = {
	Weapon_1: 1,
	Weapon_2: 2,
	Weapon_3: 3,
	Weapon_4: 4,
	Weapon_5: 5
};

interface ApiWeaponSkill {
	id: number;
	slot: string;
	offhand?: string;
	attunement?: string;
	source?: string;
}

interface ApiWeapon {
	specialization?: number;
	flags: string[];
	skills: ApiWeaponSkill[];
}

interface ApiSkill {
	id: number;
	name: string;
	description?: string;
}

interface OutputSkill {
	slot: number;
	name: string;
	offhand?: string;
	attunement?: string;
}

interface OutputWeapon {
	type: 'mainhand' | 'offhand' | 'twohand';
	specialization?: number;
	skills: OutputSkill[];
}

// ─── Fetch helpers ──────────────────────────────────────────────────────────

async function fetchJson<T>(url: string): Promise<T> {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`GW2 API ${res.status}: ${url}`);
	return res.json() as Promise<T>;
}

async function fetchSkillNames(ids: number[]): Promise<Map<number, string>> {
	const names = new Map<number, string>();
	// API accepts up to 200 IDs per request
	for (let i = 0; i < ids.length; i += 200) {
		const chunk = ids.slice(i, i + 200);
		const skills = await fetchJson<ApiSkill[]>(
			`https://api.guildwars2.com/v2/skills?ids=${chunk.join(',')}&lang=en`
		);
		for (const s of skills) {
			names.set(s.id, s.name);
		}
	}
	return names;
}

async function fetchSpecNames(ids: number[]): Promise<Map<number, string>> {
	if (ids.length === 0) return new Map();
	const specs = await fetchJson<{ id: number; name: string }[]>(
		`https://api.guildwars2.com/v2/specializations?ids=${ids.join(',')}&lang=en`
	);
	return new Map(specs.map((s) => [s.id, s.name]));
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
	console.log('Fetching weapon skills from GW2 API...\n');

	const result: Record<string, Record<string, OutputWeapon>> = {};
	const allSkillIds = new Set<number>();
	const allSpecIds = new Set<number>();

	// Phase 1: Fetch all profession weapon data
	const professionWeapons: Record<string, Record<string, ApiWeapon>> = {};

	for (const prof of PROFESSIONS) {
		console.log(`  Fetching ${prof}...`);
		const data = await fetchJson<{ weapons: Record<string, ApiWeapon> }>(
			`https://api.guildwars2.com/v2/professions/${prof}?v=latest`
		);
		professionWeapons[prof] = data.weapons;

		for (const [, weapon] of Object.entries(data.weapons)) {
			if (weapon.specialization) allSpecIds.add(weapon.specialization);
			for (const skill of weapon.skills) {
				allSkillIds.add(skill.id);
			}
		}
	}

	// Phase 2: Batch-fetch all skill names and spec names
	console.log(`\n  Fetching ${allSkillIds.size} skill names...`);
	const skillNames = await fetchSkillNames([...allSkillIds]);

	console.log(`  Fetching ${allSpecIds.size} specialization names...`);
	const specNames = await fetchSpecNames([...allSpecIds]);

	// Phase 3: Build output structure
	for (const prof of PROFESSIONS) {
		const profKey = prof.toLowerCase();
		result[profKey] = {};

		for (const [weaponName, weapon] of Object.entries(professionWeapons[prof])) {
			// Skip aquatic weapons
			if (weapon.flags.includes('Aquatic')) continue;

			const type: OutputWeapon['type'] = weapon.flags.includes('TwoHand')
				? 'twohand'
				: weapon.flags.includes('Offhand') && !weapon.flags.includes('Mainhand')
					? 'offhand'
					: weapon.flags.includes('Mainhand') && !weapon.flags.includes('Offhand')
						? 'mainhand'
						: 'mainhand'; // both flags = we'll split below

			const skills: OutputSkill[] = [];
			for (const s of weapon.skills) {
				const slotNum = SLOT_NUM[s.slot];
				if (!slotNum) continue; // skip non-weapon slots
				// Skip attunement variants for elementalist (keep fire only? no — keep all)
				skills.push({
					slot: slotNum,
					name: skillNames.get(s.id) ?? `skill:${s.id}`,
					...(s.offhand ? { offhand: s.offhand } : {}),
					...(s.attunement ? { attunement: s.attunement } : {})
				});
			}

			const entry: OutputWeapon = { type, skills };
			if (weapon.specialization) {
				entry.specialization = weapon.specialization;
			}

			// If weapon has both Mainhand and Offhand flags, split into two entries
			if (weapon.flags.includes('Mainhand') && weapon.flags.includes('Offhand')) {
				const mhSkills = skills.filter((s) => s.slot <= 3);
				const ohSkills = skills.filter((s) => s.slot >= 4);

				result[profKey][`${weaponName} (mainhand)`] = {
					type: 'mainhand',
					skills: mhSkills,
					...(weapon.specialization ? { specialization: weapon.specialization } : {})
				};
				result[profKey][`${weaponName} (offhand)`] = {
					type: 'offhand',
					skills: ohSkills,
					...(weapon.specialization ? { specialization: weapon.specialization } : {})
				};
			} else {
				result[profKey][weaponName] = entry;
			}
		}
	}

	// Phase 4: Add spec name annotations as a top-level lookup
	const specLookup: Record<number, string> = {};
	for (const [id, name] of specNames) {
		specLookup[id] = name;
	}

	const output = {
		_meta: {
			fetchedAt: new Date().toISOString(),
			description: 'GW2 weapon skills per profession. Re-run scripts/fetch-gw2-api.ts to update.',
			specializationNames: specLookup
		},
		professions: result
	};

	writeFileSync(OUTPUT, JSON.stringify(output, null, 2) + '\n');

	// Stats
	let totalWeapons = 0;
	let totalSkills = 0;
	for (const prof of Object.values(result)) {
		for (const weapon of Object.values(prof)) {
			totalWeapons++;
			totalSkills += weapon.skills.length;
		}
	}
	console.log(`\nDone! ${PROFESSIONS.length} professions, ${totalWeapons} weapon entries, ${totalSkills} skills`);
	console.log(`Output: ${OUTPUT}`);
}

main().catch((err) => {
	console.error('Error:', err);
	process.exit(1);
});
