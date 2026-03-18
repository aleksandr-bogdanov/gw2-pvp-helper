import specsData from './specs.json';
import weaponsData from './weapons.json';
import mapsData from './maps.json';
import type { GameSpecs, WeaponData, MapInfo } from './types.js';

export const specs: GameSpecs = specsData as GameSpecs;
export const weapons: Record<string, WeaponData> = weaponsData;
export const maps: MapInfo[] = mapsData as MapInfo[];

export function getSpecsForProfession(professionId: string) {
	return specs.professions[professionId]?.specs ?? [];
}

export function getDefaultRole(professionId: string, specId: string): string {
	const spec = getSpecsForProfession(professionId).find((s) => s.id === specId);
	return spec?.default_role ?? 'dps';
}

export function getSpecLabel(professionId: string, specId: string): string {
	const profLabel = specs.professions[professionId]?.label ?? professionId;
	if (specId === 'core') return `${profLabel} · Core`;
	const spec = getSpecsForProfession(professionId).find((s) => s.id === specId);
	const specLabel = spec?.label ?? specId;
	return `${profLabel} · ${specLabel}`;
}

export function getProfessionLabel(professionId: string): string {
	return specs.professions[professionId]?.label ?? professionId;
}

// Reverse lookup: spec_id → profession_id
const _specToProfession: Record<string, string> = {};
for (const [profId, prof] of Object.entries(specs.professions)) {
	for (const spec of prof.specs) {
		if (spec.id !== 'core') {
			_specToProfession[spec.id] = profId;
		}
	}
}

export function getProfessionForSpec(specId: string): string | null {
	return _specToProfession[specId] ?? null;
}

/** Stolen skill per enemy profession (Thief F1) — includes GW2 API data */
export const stolenSkills: Record<string, {
	name: string;
	tip: string;
	apiId: number;
	icon: string;
	description: string;
}> = {
	guardian: {
		name: 'Mace Head Crack',
		tip: 'daze (interrupt)',
		apiId: 1131,
		icon: 'https://render.guildwars2.com/file/EA28344BCD136298D5011EF553763C097C0A09E0/102955.png',
		description: 'Daze your foe.'
	},
	revenant: {
		name: 'Essence Sap',
		tip: 'slow',
		apiId: 31438,
		icon: 'https://render.guildwars2.com/file/6DB27A68383B91A6E34ABA04BDF2402342B95EF8/961414.png',
		description: 'Throw energy at your target, slowing them.'
	},
	warrior: {
		name: 'Whirling Axe',
		tip: 'spin AoE',
		apiId: 1162,
		icon: 'https://render.guildwars2.com/file/ACBF2C0EE9B64FCF12BBA443D16A08256C07B7E0/102941.png',
		description: 'Spin and attack nearby foes. You can move while spinning.'
	},
	engineer: {
		name: 'Throw Gunk',
		tip: 'random condi AoE',
		apiId: 1110,
		icon: 'https://render.guildwars2.com/file/3A487770D4A0E006D0A0E57C68A639BF7003A5BC/102940.png',
		description: 'Throw gunk at target area to inflict a random condition.'
	},
	ranger: {
		name: 'Healing Seed',
		tip: 'regen + cleanse',
		apiId: 1139,
		icon: 'https://render.guildwars2.com/file/C9052DC9C2AF805EC14C903D5EA0536E0A1A243F/102961.png',
		description: 'Periodically grants regeneration and removes conditions from you and your allies.'
	},
	thief: {
		name: 'Blinding Tuft',
		tip: 'stealth + blind',
		apiId: 1148,
		icon: 'https://render.guildwars2.com/file/08956AFCA1FECE4E5F28A17CA068A2A134A697E5/102970.png',
		description: 'Throw a handful of hair, vanishing in stealth and blinding nearby foes.'
	},
	elementalist: {
		name: 'Ice Shard Stab',
		tip: 'damage + chill',
		apiId: 1129,
		icon: 'https://render.guildwars2.com/file/53CFF0A54AD6FC3C6959722DCF2B9AB2C1ADF754/102953.png',
		description: 'Stab and chill your foe.'
	},
	mesmer: {
		name: 'Consume Plasma',
		tip: 'ALL boons',
		apiId: 1123,
		icon: 'https://render.guildwars2.com/file/BED8F4C37CA1D040CEA5381E082E155DB5D295F7/102949.png',
		description: 'Gain all boons.'
	},
	necromancer: {
		name: 'Skull Fear',
		tip: 'AoE fear',
		apiId: 1141,
		icon: 'https://render.guildwars2.com/file/44B30CD10A3AA30A80A7A64CE2EF0B942CFF9BFF/102963.png',
		description: 'Strike fear into nearby foes.'
	}
};

export function getStolenSkill(professionId: string) {
	return stolenSkills[professionId] ?? null;
}

/** Official GW2 Wiki profession colors — CSS variable names for theme-awareness */
const professionColorVars: Record<string, string> = {
	guardian: 'var(--prof-guardian)',
	warrior: 'var(--prof-warrior)',
	revenant: 'var(--prof-revenant)',
	ranger: 'var(--prof-ranger)',
	thief: 'var(--prof-thief)',
	engineer: 'var(--prof-engineer)',
	necromancer: 'var(--prof-necromancer)',
	mesmer: 'var(--prof-mesmer)',
	elementalist: 'var(--prof-elementalist)'
};

/** Hardcoded fallbacks (dark-theme values) for contexts where CSS vars don't work */
export const professionColors: Record<string, string> = {
	guardian: '#72C1D9',
	warrior: '#FFD166',
	revenant: '#D16E5A',
	ranger: '#8CDC82',
	thief: '#C08F95',
	engineer: '#D09C59',
	necromancer: '#52A76F',
	mesmer: '#B679D5',
	elementalist: '#F68A87'
};

export function getProfessionColor(professionId: string): string {
	return professionColorVars[professionId] ?? '#888888';
}

export function cycleSpec(professionId: string, currentSpecId: string): string {
	const profSpecs = getSpecsForProfession(professionId);
	if (profSpecs.length === 0) return currentSpecId;
	const idx = profSpecs.findIndex((s) => s.id === currentSpecId);
	const nextIdx = (idx + 1) % profSpecs.length;
	return profSpecs[nextIdx].id;
}
