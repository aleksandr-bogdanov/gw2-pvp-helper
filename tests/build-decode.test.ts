import { describe, it, expect } from 'vitest';
import { decodeBuildCode, formatBuildForPrompt } from '../src/lib/server/build-decode.js';
import type { ResolvedBuild } from '../src/lib/server/build-decode.js';

describe('decodeBuildCode', () => {
	// Real GW2 build code: Warrior (profession byte 0x02)
	const WARRIOR_CODE = '[&DQILGhYqSh55HacAsgBqALAAcQB+HbIA7gCcAAAAAAAAAAAAAAAAAAAAAAA=]';

	it('decodes a valid build code with [& ] wrapper', () => {
		const build = decodeBuildCode(WARRIOR_CODE);
		expect(build.profession).toBe('warrior');
		expect(build.specializations).toHaveLength(3);
		expect(build.skills.heal).toBeDefined();
		expect(build.skills.utilities).toHaveLength(3);
		expect(build.skills.elite).toBeDefined();
	});

	it('decodes a valid build code without wrapper', () => {
		const raw = WARRIOR_CODE.slice(2, -1); // strip [& and ]
		const build = decodeBuildCode(raw);
		expect(build.profession).toBe('warrior');
	});

	it('parses specialization traits correctly', () => {
		const build = decodeBuildCode(WARRIOR_CODE);
		for (const spec of build.specializations) {
			expect(spec.traits.adept).toBeGreaterThanOrEqual(0);
			expect(spec.traits.adept).toBeLessThanOrEqual(3);
			expect(spec.traits.master).toBeGreaterThanOrEqual(0);
			expect(spec.traits.master).toBeLessThanOrEqual(3);
			expect(spec.traits.grandmaster).toBeGreaterThanOrEqual(0);
			expect(spec.traits.grandmaster).toBeLessThanOrEqual(3);
		}
	});

	it('extracts skill palette IDs as positive numbers', () => {
		const build = decodeBuildCode(WARRIOR_CODE);
		if (build.skills.heal) {
			expect(build.skills.heal.paletteId).toBeGreaterThan(0);
		}
		for (const util of build.skills.utilities) {
			expect(util.paletteId).toBeGreaterThan(0);
		}
		if (build.skills.elite) {
			expect(build.skills.elite.paletteId).toBeGreaterThan(0);
		}
	});

	it('throws on empty string', () => {
		expect(() => decodeBuildCode('')).toThrow('Build code too short');
	});

	it('throws on invalid base64 that produces short buffer', () => {
		expect(() => decodeBuildCode('AAAA')).toThrow('Build code too short');
	});

	it('throws on wrong type byte', () => {
		// Create a valid-length buffer with wrong type byte (0x01 instead of 0x0d)
		const buf = Buffer.alloc(44);
		buf[0] = 0x01;
		const code = buf.toString('base64');
		expect(() => decodeBuildCode(code)).toThrow('Not a build template code');
	});

	it('throws on unknown profession code', () => {
		const buf = Buffer.alloc(44);
		buf[0] = 0x0d; // correct type
		buf[1] = 99; // invalid profession
		const code = buf.toString('base64');
		expect(() => decodeBuildCode(code)).toThrow('Unknown profession code');
	});

	it('handles build codes with profession-specific data (ranger/revenant)', () => {
		// Build a minimal valid ranger build code
		const buf = Buffer.alloc(44);
		buf[0] = 0x0d; // type
		buf[1] = 4; // ranger
		// Spec IDs and traits at bytes 2-7 (leave as 0)
		// Skills at bytes 8-25 (leave as 0)
		// Profession specific at bytes 28-31
		buf[28] = 1; // pet 1
		buf[29] = 2; // pet 2
		buf[30] = 3; // aquatic pet 1
		buf[31] = 4; // aquatic pet 2
		const code = buf.toString('base64');
		const build = decodeBuildCode(code);
		expect(build.profession).toBe('ranger');
		expect(build.professionSpecific).toBeDefined();
		expect(build.professionSpecific!.type).toBe('ranger_pets');
		expect(build.professionSpecific!.terrestrial).toEqual([1, 2]);
		expect(build.professionSpecific!.aquatic).toEqual([3, 4]);
	});

	it('decodes weapon palette IDs from SotO extension bytes', () => {
		// Build a valid code with weapon data at offset 44+
		const buf = Buffer.alloc(49);
		buf[0] = 0x0d; // type
		buf[1] = 5; // thief
		buf[44] = 2; // 2 weapons
		// Sword = 0x005a
		buf[45] = 0x5a;
		buf[46] = 0x00;
		// Dagger = 0x002f
		buf[47] = 0x2f;
		buf[48] = 0x00;
		const code = buf.toString('base64');
		const build = decodeBuildCode(code);
		expect(build.weapons).toEqual(['Sword', 'Dagger']);
	});

	it('handles zero-skill palette IDs (empty skill slots)', () => {
		const buf = Buffer.alloc(28);
		buf[0] = 0x0d;
		buf[1] = 1; // guardian
		// All skill bytes are 0
		const code = buf.toString('base64');
		const build = decodeBuildCode(code);
		expect(build.skills.heal).toBeUndefined();
		expect(build.skills.utilities).toHaveLength(0);
		expect(build.skills.elite).toBeUndefined();
	});

	it('handles all 9 professions', () => {
		for (let profCode = 1; profCode <= 9; profCode++) {
			const buf = Buffer.alloc(28);
			buf[0] = 0x0d;
			buf[1] = profCode;
			const code = buf.toString('base64');
			const build = decodeBuildCode(code);
			expect(build.profession).toBeTruthy();
		}
	});
});

describe('formatBuildForPrompt', () => {
	it('formats a resolved build into readable text', () => {
		const build: ResolvedBuild = {
			profession: 'thief',
			eliteSpec: 'daredevil',
			specializations: [
				{
					name: 'Deadly Arts',
					isElite: false,
					traits: { adept: 'Mug', master: 'Revealed Training', grandmaster: 'Executioner' }
				},
				{
					name: 'Critical Strikes',
					isElite: false,
					traits: { adept: 'Twin Fangs', master: 'Practiced Tolerance', grandmaster: 'Invigorating Precision' }
				},
				{
					name: 'Daredevil',
					isElite: true,
					traits: { adept: 'Havoc Specialist', master: 'Staff Master', grandmaster: 'Bounding Dodger' }
				}
			],
			heal: 'Channeled Vigor',
			utilities: ['Fist Flurry', 'Shadowstep', 'Signet of Agility'],
			elite: 'Impact Strike',
			weapons: ['Staff', 'Sword', 'Dagger']
		};

		const text = formatBuildForPrompt(build);
		expect(text).toContain('Profession: thief');
		expect(text).toContain('Trait Lines:');
		expect(text).toContain('Deadly Arts: Mug, Revealed Training, Executioner');
		expect(text).toContain('Daredevil: Havoc Specialist, Staff Master, Bounding Dodger');
		expect(text).toContain('Heal Skill: Channeled Vigor');
		expect(text).toContain('Utility Skills: Fist Flurry, Shadowstep, Signet of Agility');
		expect(text).toContain('Elite Skill: Impact Strike');
		expect(text).toContain('Weapons: Staff, Sword, Dagger');
	});

	it('omits weapons section when no weapons present', () => {
		const build: ResolvedBuild = {
			profession: 'guardian',
			eliteSpec: 'core',
			specializations: [],
			heal: 'Shelter',
			utilities: [],
			elite: 'Renewed Focus',
			weapons: []
		};

		const text = formatBuildForPrompt(build);
		expect(text).not.toContain('Weapons:');
	});
});
