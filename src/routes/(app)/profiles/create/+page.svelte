<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { specs, weapons, getProfessionForSpec, getProfessionColor } from '$lib/game-data.js';
	import type { WeaponData } from '$lib/types.js';

	// --- State ---
	let step = $state(1);
	let loading = $state(false);
	let editId = $state<number | null>(null);

	// Step 1: Basic info
	let characterName = $state('');
	let profession = $state('');
	let spec = $state('');
	let role = $state('');
	let weaponMainhand = $state('');
	let weaponOffhand = $state('');
	let weaponSwapMainhand = $state('');
	let weaponSwapOffhand = $state('');
	let weaponTwohand = $state('');
	let weaponSwapTwohand = $state('');
	let mainSetType = $state<'dual' | 'twohand'>('dual');
	let swapSetType = $state<'dual' | 'twohand'>('dual');
	let buildLabel = $state('');

	// Build code
	let buildCode = $state('');
	let decodedBuild = $state<{ build: any; formatted: string } | null>(null);
	let buildDecodeError = $state('');
	let buildDecoding = $state(false);

	// Equipment (not in build code)
	let rune = $state('');
	let relic = $state('');
	let sigilMain1 = $state('');
	let sigilMain2 = $state('');
	let sigilSwap1 = $state('');
	let sigilSwap2 = $state('');
	let amulet = $state('');

	// Step 2: Playstyle
	let playstyle = $state('');
	let weaknesses = $state('');

	// Step 3: Generated profile
	let generatedProfile = $state('');
	let generatedMatchups = $state<Record<string, unknown> | null>(null);
	let generateError = $state('');
	let generateElapsed = $state(0);
	let generateTimer = $state<ReturnType<typeof setInterval> | null>(null);
	let saveError = $state('');

	/** Normalize matchups from any format into consistent {threat, tip} objects */
	function normalizeMatchups(raw: Record<string, unknown> | null): Record<string, { threat: string; tip: string }> {
		if (!raw) return {};
		// Unwrap nested "matchups" key if present
		const data: Record<string, unknown> = ('matchups' in raw && typeof raw.matchups === 'object' && raw.matchups !== null)
			? raw.matchups as Record<string, unknown>
			: raw;

		const result: Record<string, { threat: string; tip: string }> = {};
		for (const [rawKey, val] of Object.entries(data)) {
			const key = rawKey.toLowerCase();
			if (typeof val === 'string') {
				// Old format: "RESPECT — some tip text"
				const match = val.match(/^(HUNT|RESPECT|AVOID)\s*[—–-]\s*(.*)/i);
				if (match) {
					result[key] = { threat: match[1].toUpperCase(), tip: match[2].trim() };
				}
			} else if (val && typeof val === 'object') {
				const v = val as Record<string, unknown>;
				const threat = ((v.threat ?? v.threat_level ?? '') as string).toUpperCase();
				const tip = ((v.tip ?? v.note ?? v.notes ?? '') as string);
				if (threat) {
					result[key] = { threat, tip };
				}
			}
		}
		return result;
	}

	let normalizedMatchups = $derived(normalizeMatchups(generatedMatchups));

	// Step 4: Review/edit
	let editableProfile = $state('');
	let editingPrompt = $state(false);

	// --- Derived ---
	let professionList = $derived(
		Object.entries(specs.professions).map(([id, p]) => ({ id, label: p.label }))
	);

	let specList = $derived(
		profession ? specs.professions[profession]?.specs ?? [] : []
	);

	let profWeapons = $derived<WeaponData | null>(
		profession ? (weapons as Record<string, WeaponData>)[profession] ?? null : null
	);

	let weaponsMainDisplay = $derived(
		mainSetType === 'twohand'
			? weaponTwohand
			: [weaponMainhand, weaponOffhand].filter(Boolean).join('/')
	);

	let weaponsSwapDisplay = $derived(
		swapSetType === 'twohand'
			? weaponSwapTwohand
			: [weaponSwapMainhand, weaponSwapOffhand].filter(Boolean).join('/')
	);

	let canAdvanceStep1 = $derived(
		characterName.trim() && profession && spec && role
	);

	const roleDescriptions: Record<string, string> = {
		roamer: 'Fast rotation between points. +1 fights. Decap and leave.',
		duelist: 'Hold side nodes in 1v1. Win extended fights.',
		support: 'Stay with team. Heal and buff. Never chase.',
		teamfighter: 'Group fight specialist. Win mid brawls. Cleave downed.',
		heal: 'Dedicated healer. Keep teammates alive.',
		supp: 'Support/utility hybrid. Boons, heals, and control.',
		dps: 'Damage dealer. Kill targets, apply pressure.',
		bunker: 'Hold capture points. Nearly unkillable. Stall enemies.',
		pwr: 'Power damage. Direct burst damage.',
		condi: 'Condition damage. Damage over time pressure.',
		alac: 'Alacrity support. Quickness/alac + utility.'
	};

	// --- Init ---
	onMount(async () => {
		const editParam = page.url.searchParams.get('edit');
		if (editParam) {
			editId = parseInt(editParam);
			await loadProfile(editId);
		}
	});

	async function loadProfile(id: number) {
		loading = true;
		const res = await fetch('/api/profiles');
		if (res.ok) {
			const profiles = await res.json();
			const profile = profiles.find((p: { id: number }) => p.id === id);
			if (profile) {
				characterName = profile.characterName;
				profession = profile.profession;
				spec = profile.spec;
				role = profile.role;
				buildLabel = profile.buildLabel || '';
				buildCode = profile.buildCode || '';
				rune = profile.rune || '';
				relic = profile.relic || '';
				amulet = profile.amulet || '';

				// Restore sigils
				if (profile.sigilsMain) {
					const parts = profile.sigilsMain.split(', ');
					sigilMain1 = parts[0] || '';
					sigilMain2 = parts[1] || '';
				}
				if (profile.sigilsSwap) {
					const parts = profile.sigilsSwap.split(', ');
					sigilSwap1 = parts[0] || '';
					sigilSwap2 = parts[1] || '';
				}

				playstyle = profile.playstyle || '';
				weaknesses = profile.weaknesses || '';

				if (profile.profilePrompt) {
					generatedProfile = profile.profilePrompt;
					editableProfile = profile.profilePrompt;
				}
				if (profile.matchups) {
					generatedMatchups = profile.matchups;
				}

				// Parse weapons
				if (profile.weaponsMain) {
					const parts = profile.weaponsMain.split('/');
					if (parts.length === 1) {
						mainSetType = 'twohand';
						weaponTwohand = parts[0];
					} else {
						mainSetType = 'dual';
						weaponMainhand = parts[0];
						weaponOffhand = parts[1] || '';
					}
				}
				if (profile.weaponsSwap) {
					const parts = profile.weaponsSwap.split('/');
					if (parts.length === 1) {
						swapSetType = 'twohand';
						weaponSwapTwohand = parts[0];
					} else {
						swapSetType = 'dual';
						weaponSwapMainhand = parts[0];
						weaponSwapOffhand = parts[1] || '';
					}
				}

				// Jump straight to review/edit if profile already has a prompt
				if (profile.profilePrompt) {
					step = 4;
				}
			}
		}
		loading = false;
	}

	// When profession changes, reset spec
	$effect(() => {
		if (profession) {
			const profSpecs = specs.professions[profession]?.specs ?? [];
			if (!profSpecs.find(s => s.id === spec)) {
				spec = '';
				role = '';
			}
		}
	});

	// When spec changes, set default role
	$effect(() => {
		if (profession && spec) {
			const specInfo = specs.professions[profession]?.specs.find(s => s.id === spec);
			if (specInfo && !role) {
				role = specInfo.default_role;
			}
		}
	});

	// Default amulet based on role (user can override)
	const defaultAmulets: Record<string, string> = {
		dps: 'Berserker',
		pwr: 'Berserker',
		roamer: 'Berserker',
		duelist: 'Berserker',
		teamfighter: 'Berserker',
		condi: 'Carrion',
		heal: 'Minstrel',
		supp: 'Minstrel',
		support: 'Minstrel',
		alac: 'Minstrel',
		bunker: 'Minstrel'
	};

	$effect(() => {
		if (role && !amulet && !loading && !editId) {
			amulet = defaultAmulets[role] ?? '';
		}
	});

	let streamingText = $state('');
	let streamingContainer = $state<HTMLElement | null>(null);

	// Auto-scroll streaming output to bottom
	$effect(() => {
		if (streamingText && streamingContainer) {
			streamingContainer.scrollTop = streamingContainer.scrollHeight;
		}
	});

	/** Show profile text, and extract matchup entries from the JSON block as they stream */
	let streamingDisplay = $derived(() => {
		const matchupIdx = streamingText.indexOf('MATCHUP ASSESSMENTS:');
		const profileText = matchupIdx !== -1
			? streamingText.slice(0, matchupIdx).trim()
			: streamingText;

		// If matchup section hasn't started, show profile text as-is
		if (matchupIdx === -1) return profileText;

		// Extract individual matchup entries from the streaming JSON
		const afterMatchup = streamingText.slice(matchupIdx);
		const entryPattern = /"([^"]+)":\s*\{[^}]*"threat":\s*"(HUNT|RESPECT|AVOID)"[^}]*"(?:tip|note)":\s*"([^"]*)"/gi;
		const entries: string[] = [];
		let match;
		while ((match = entryPattern.exec(afterMatchup)) !== null) {
			const [, name, threat, tip] = match;
			const emoji = threat === 'HUNT' ? '🟢' : threat === 'AVOID' ? '🔴' : '🟡';
			entries.push(`  ${emoji} ${name} [${threat}] — ${tip}`);
		}

		if (entries.length === 0) {
			return profileText + '\n\n───── MATCHUP ASSESSMENTS ─────\n\nGenerating...';
		}
		return profileText + `\n\n───── MATCHUP ASSESSMENTS (${entries.length}) ─────\n\n` + entries.join('\n');
	});

	async function generateProfile() {
		loading = true;
		generateError = '';
		generateElapsed = 0;
		streamingText = '';
		generatedMatchups = null;
		generateTimer = setInterval(() => { generateElapsed++; }, 1000);
		step = 3;

		try {
			const res = await fetch('/api/generate-profile', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					profession,
					spec,
					role,
					weaponsMain: weaponsMainDisplay,
					weaponsSwap: weaponsSwapDisplay,
					buildLabel,
					playstyle,
					weaknesses,
					decodedBuild: decodedBuild?.formatted ?? null,
					rune: rune.trim() || null,
					relic: relic.trim() || null,
					amulet: amulet.trim() || null,
					sigilsMain: [sigilMain1, sigilMain2].filter(s => s.trim()).join(', ') || null,
					sigilsSwap: [sigilSwap1, sigilSwap2].filter(s => s.trim()).join(', ') || null
				})
			});

			if (!res.ok) {
				const err = await res.json().catch(() => ({ error: 'Generation failed' }));
				throw new Error(err.error ?? 'Generation failed');
			}

			const reader = res.body?.getReader();
			if (!reader) throw new Error('No response body');

			const decoder = new TextDecoder();
			let buffer = '';

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() ?? '';

				for (const line of lines) {
					if (!line.startsWith('data: ')) continue;
					const data = line.slice(6);
					try {
						const parsed = JSON.parse(data);
						if (parsed.error) {
							throw new Error(parsed.error);
						}
						if (parsed.text) {
							streamingText += parsed.text;
						}
						if (parsed.done) {
							generatedProfile = parsed.profilePrompt;
							generatedMatchups = parsed.matchups ?? null;
							editableProfile = parsed.profilePrompt;
							step = 4;
						}
					} catch (e) {
						if (e instanceof SyntaxError) continue;
						throw e;
					}
				}
			}

			// Fallback if no done event received
			if (step !== 4 && streamingText) {
				generatedProfile = streamingText;
				editableProfile = streamingText;
				step = 4;
			}
		} catch (err) {
			generateError = err instanceof Error ? err.message : 'Generation failed';
			if (step === 3) step = 2;
		} finally {
			if (generateTimer) clearInterval(generateTimer);
			generateTimer = null;
			loading = false;
		}
	}

	async function saveProfile() {
		loading = true;
		saveError = '';

		try {
			const body = {
				characterName: characterName.trim(),
				profession,
				spec,
				buildLabel: buildLabel.trim() || null,
				role,
				weaponsMain: weaponsMainDisplay || null,
				weaponsSwap: weaponsSwapDisplay || null,
				rune: rune.trim() || null,
				relic: relic.trim() || null,
				amulet: amulet.trim() || null,
				sigilsMain: [sigilMain1, sigilMain2].filter(s => s.trim()).join(', ') || null,
				sigilsSwap: [sigilSwap1, sigilSwap2].filter(s => s.trim()).join(', ') || null,
				buildCode: buildCode.trim() || null,
				playstyle: playstyle.trim() || null,
				weaknesses: weaknesses.trim() || null,
				profilePrompt: editableProfile || null,
				matchups: generatedMatchups
			};

			let res: Response;
			if (editId) {
				res = await fetch('/api/profiles', {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ id: editId, ...body })
				});
			} else {
				res = await fetch('/api/profiles', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(body)
				});
			}

			if (!res.ok) {
				const err = await res.json().catch(() => ({ message: 'Save failed' }));
				throw new Error(err.message ?? 'Save failed');
			}

			goto('/profiles');
		} catch (err) {
			saveError = err instanceof Error ? err.message : 'Save failed';
		} finally {
			loading = false;
		}
	}

	async function decodeBuildCode() {
		if (!buildCode.trim()) return;
		buildDecoding = true;
		buildDecodeError = '';
		decodedBuild = null;

		try {
			const res = await fetch('/api/decode-build', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ buildCode: buildCode.trim() })
			});

			if (!res.ok) {
				const err = await res.json().catch(() => ({ message: 'Decode failed' }));
				throw new Error(err.message ?? 'Decode failed');
			}

			const data = await res.json();
			decodedBuild = data;

			// Auto-fill profession and spec from decoded build
			if (data.build?.profession) {
				profession = data.build.profession;
			}
			if (data.build?.eliteSpec) {
				spec = data.build.eliteSpec;
				// Set default role for the detected spec
				const specInfo = specs.professions[data.build.profession]?.specs.find(
					(s: { id: string }) => s.id === data.build.eliteSpec
				);
				if (specInfo) {
					role = specInfo.default_role;
				}
			}

			// Auto-fill weapons from decoded build
			if (data.build?.weapons?.length) {
				const weps: string[] = data.build.weapons;
				const twoHanded = new Set(['Greatsword', 'Hammer', 'Longbow', 'Rifle', 'Staff', 'Shortbow', 'Spear']);

				// Figure out set 1 and set 2 from the flat weapon list
				let idx = 0;
				// Set 1
				if (idx < weps.length) {
					if (twoHanded.has(weps[idx])) {
						mainSetType = 'twohand';
						weaponTwohand = weps[idx];
						idx++;
					} else {
						mainSetType = 'dual';
						weaponMainhand = weps[idx] || '';
						idx++;
						if (idx < weps.length && !twoHanded.has(weps[idx])) {
							weaponOffhand = weps[idx] || '';
							idx++;
						}
					}
				}
				// Set 2
				if (idx < weps.length) {
					if (twoHanded.has(weps[idx])) {
						swapSetType = 'twohand';
						weaponSwapTwohand = weps[idx];
						idx++;
					} else {
						swapSetType = 'dual';
						weaponSwapMainhand = weps[idx] || '';
						idx++;
						if (idx < weps.length && !twoHanded.has(weps[idx])) {
							weaponSwapOffhand = weps[idx] || '';
							idx++;
						}
					}
				}
			}
		} catch (err) {
			buildDecodeError = err instanceof Error ? err.message : 'Decode failed';
		} finally {
			buildDecoding = false;
		}
	}

	function getSpecIcon(specId: string): string {
		const id = specId.toLowerCase();
		return `/icons/specs/${id === 'core' ? profession : id}.png`;
	}

	function getProfIcon(profId: string): string {
		return `/icons/specs/${profId}.png`;
	}
</script>

<div class="mx-auto max-w-3xl">
	<!-- Step back / cancel -->
	<div class="mb-4">
		<button
			class="text-sm text-(--color-text-secondary) hover:text-(--color-text) transition-colors cursor-pointer"
			onclick={() => {
				if (step > 1) step--;
				else goto('/profiles');
			}}
		>
			&#8592; {step > 1 ? 'Back' : 'Cancel'}
		</button>
	</div>

	<!-- Step indicator -->
	<div class="mb-8">
		<div class="flex items-center gap-2 mb-1.5">
			{#each [1, 2, 3, 4] as s}
				<div class="flex-1 h-1.5 rounded-full transition-colors
					{s <= step ? 'bg-(--color-accent)' : 'bg-(--color-border)'}"></div>
			{/each}
		</div>
		<div class="flex items-center gap-2">
			{#each ['Build Info', 'Playstyle', 'Generate', 'Review'] as label, i}
				<span class="flex-1 text-center text-[10px] font-medium
					{i + 1 <= step ? 'text-(--color-accent)' : 'text-(--color-text-tertiary)'}">
					{label}
				</span>
			{/each}
		</div>
	</div>

	<!-- Step 1: Basic Info -->
	{#if step === 1}
		<div class="flex flex-col gap-6">
			<!-- Character Name -->
			<div>
				<label for="char-name" class="block text-sm font-medium text-(--color-text-secondary) mb-1.5">Character Name</label>
				<input
					id="char-name"
					type="text"
					bind:value={characterName}
					placeholder="Your in-game character name"
					class="w-full rounded-lg bg-(--color-bg) px-4 py-2.5 text-base text-(--color-text) border border-(--color-border) focus:border-(--color-accent) focus:outline-none font-mono"
				/>
			</div>

			<!-- Build Template Code (right after name — auto-fills profession/spec) -->
			<div>
				<label for="build-code" class="block text-sm font-medium text-(--color-text-secondary) mb-1.5">
					Build Template Code <span class="text-(--color-text-tertiary)">(paste from in-game build panel)</span>
				</label>
				<div class="flex gap-2">
					<input
						id="build-code"
						type="text"
						bind:value={buildCode}
						placeholder="[&DQILGhYq...]"
						class="flex-1 rounded-lg bg-(--color-bg) px-4 py-2.5 text-sm font-mono text-(--color-text) border border-(--color-border) focus:border-(--color-accent) focus:outline-none"
					/>
					<button
						class="rounded-lg px-4 py-2.5 text-sm font-medium transition-all cursor-pointer
							{buildCode.trim()
								? 'bg-(--color-accent)/15 text-(--color-accent) border border-(--color-accent)/30 hover:bg-(--color-accent)/25'
								: 'bg-(--color-surface) text-(--color-text-tertiary) border border-(--color-border) cursor-not-allowed'}"
						disabled={!buildCode.trim() || buildDecoding}
						onclick={decodeBuildCode}
					>
						{buildDecoding ? 'Decoding...' : 'Decode'}
					</button>
				</div>
				{#if buildDecodeError}
					<p class="mt-1.5 text-xs text-(--color-red)">{buildDecodeError}</p>
				{/if}
				{#if decodedBuild}
					<div class="mt-2 rounded-lg bg-(--color-bg) border border-(--color-green)/30 p-3">
						<p class="text-xs font-medium text-(--color-green) mb-1.5">Build decoded — profession &amp; spec auto-filled</p>
						<pre class="text-[11px] font-mono text-(--color-text-secondary) whitespace-pre-wrap leading-relaxed">{decodedBuild.formatted}</pre>
					</div>
				{/if}
				<p class="mt-1 text-xs text-(--color-text-tertiary)">
					In-game: Build panel &rarr; copy icon. Auto-fills profession, spec, traits &amp; skills.
				</p>
			</div>

			<!-- Profession (icon grid) -->
			<div>
				<p class="text-sm font-medium text-(--color-text-secondary) mb-2">
					Profession
					{#if decodedBuild}<span class="text-(--color-green) text-xs font-normal ml-1">(from build code)</span>{/if}
				</p>
				<div class="grid grid-cols-9 gap-1.5">
					{#each professionList as prof}
						<button
							class="flex flex-col items-center gap-1 rounded-lg p-1.5 transition-all cursor-pointer
								{profession === prof.id
									? 'bg-(--color-accent)/15 ring-1 ring-(--color-accent)/50'
									: 'bg-(--color-surface) border border-(--color-border) hover:border-(--color-border-strong)'}"
							onclick={() => { profession = prof.id; }}
							title={prof.label}
						>
							<img
								src={getProfIcon(prof.id)}
								alt={prof.label}
								class="h-10 w-10 spec-icon"
							/>
							<span class="text-[11px] text-(--color-text-secondary) leading-tight text-center truncate w-full">
								{prof.label}
							</span>
						</button>
					{/each}
				</div>
			</div>

			<!-- Elite Spec (icon grid) -->
			{#if profession}
				<div>
					<p class="text-sm font-medium text-(--color-text-secondary) mb-2">
						Elite Spec
						{#if decodedBuild}<span class="text-(--color-green) text-xs font-normal ml-1">(from build code)</span>{/if}
					</p>
					<div class="flex flex-wrap gap-2">
						{#each specList as s}
							<button
								class="flex flex-col items-center gap-1 rounded-lg p-2 transition-all cursor-pointer
									{spec === s.id
										? 'bg-(--color-accent)/15 ring-1 ring-(--color-accent)/50'
										: 'bg-(--color-surface) border border-(--color-border) hover:border-(--color-border-strong)'}"
								onclick={() => { spec = s.id; role = s.default_role; }}
							>
								<img
									src={getSpecIcon(s.id)}
									alt={s.label}
									class="h-12 w-12 spec-icon"
								/>
								<span class="text-xs text-(--color-text-secondary) leading-tight text-center">
									{s.id === 'core' ? 'Core' : s.label}
								</span>
							</button>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Role (pill buttons) -->
			{#if spec}
				{@const specInfo = specList.find(s => s.id === spec)}
				{@const roles = specInfo?.roles ?? [specInfo?.default_role ?? 'dps']}
				<div>
					<p class="text-sm font-medium text-(--color-text-secondary) mb-2">Role</p>
					<div class="flex flex-wrap gap-2">
						{#each roles as r}
							<button
								class="rounded-lg px-4 py-2 text-base transition-all cursor-pointer
									{role === r
										? 'bg-(--color-accent)/15 text-(--color-accent) ring-1 ring-(--color-accent)/50'
										: 'bg-(--color-surface) text-(--color-text-secondary) border border-(--color-border) hover:border-(--color-border-strong)'}"
								onclick={() => (role = r)}
								title={roleDescriptions[r] ?? ''}
							>
								{r}
							</button>
						{/each}
					</div>
					{#if role && roleDescriptions[role]}
						<p class="mt-2 text-sm text-(--color-text-tertiary)">{roleDescriptions[role]}</p>
					{/if}
				</div>
			{/if}

			<!-- Weapons -->
			{#if profWeapons}
				<!-- Main weapon set -->
				<div>
					<div class="flex items-center gap-2 mb-2">
						<p class="text-sm font-medium text-(--color-text-secondary)">Main Weapons</p>
						<div class="flex rounded-md overflow-hidden border border-(--color-border)">
							<button
								class="text-xs px-2.5 py-1 transition-colors cursor-pointer
									{mainSetType === 'dual' ? 'bg-(--color-accent)/15 text-(--color-accent)' : 'text-(--color-text-tertiary) hover:bg-(--color-surface-hover)'}"
								onclick={() => (mainSetType = 'dual')}
							>1H + 1H</button>
							<button
								class="text-xs px-2.5 py-1 transition-colors cursor-pointer border-l border-(--color-border)
									{mainSetType === 'twohand' ? 'bg-(--color-accent)/15 text-(--color-accent)' : 'text-(--color-text-tertiary) hover:bg-(--color-surface-hover)'}"
								onclick={() => (mainSetType = 'twohand')}
							>Two-Hand</button>
						</div>
					</div>
					{#if mainSetType === 'dual'}
						<div class="flex gap-3">
							<div class="flex-1">
								<p class="text-xs text-(--color-text-tertiary) mb-1.5">Mainhand</p>
								<div class="flex flex-wrap gap-1.5">
									{#each profWeapons.mainhand as w}
										<button
											class="rounded-md px-3 py-1.5 text-sm transition-all cursor-pointer
												{weaponMainhand === w
													? 'bg-(--color-accent)/15 text-(--color-accent) ring-1 ring-(--color-accent)/50'
													: 'bg-(--color-surface) text-(--color-text-secondary) border border-(--color-border) hover:border-(--color-border-strong)'}"
											onclick={() => (weaponMainhand = weaponMainhand === w ? '' : w)}
										>{w}</button>
									{/each}
								</div>
							</div>
							<div class="flex-1">
								<p class="text-xs text-(--color-text-tertiary) mb-1.5">Offhand</p>
								<div class="flex flex-wrap gap-1.5">
									{#each profWeapons.offhand as w}
										<button
											class="rounded-md px-3 py-1.5 text-sm transition-all cursor-pointer
												{weaponOffhand === w
													? 'bg-(--color-accent)/15 text-(--color-accent) ring-1 ring-(--color-accent)/50'
													: 'bg-(--color-surface) text-(--color-text-secondary) border border-(--color-border) hover:border-(--color-border-strong)'}"
											onclick={() => (weaponOffhand = weaponOffhand === w ? '' : w)}
										>{w}</button>
									{/each}
								</div>
							</div>
						</div>
					{:else}
						<div class="flex flex-wrap gap-1.5">
							{#each profWeapons.twohand as w}
								<button
									class="rounded-md px-3 py-1.5 text-sm transition-all cursor-pointer
										{weaponTwohand === w
											? 'bg-(--color-accent)/15 text-(--color-accent) ring-1 ring-(--color-accent)/50'
											: 'bg-(--color-surface) text-(--color-text-secondary) border border-(--color-border) hover:border-(--color-border-strong)'}"
									onclick={() => (weaponTwohand = weaponTwohand === w ? '' : w)}
								>{w}</button>
							{/each}
						</div>
					{/if}
				</div>

				<!-- Swap weapon set -->
				<div>
					<div class="flex items-center gap-2 mb-2">
						<p class="text-sm font-medium text-(--color-text-secondary)">Swap Weapons</p>
						<div class="flex rounded-md overflow-hidden border border-(--color-border)">
							<button
								class="text-xs px-2.5 py-1 transition-colors cursor-pointer
									{swapSetType === 'dual' ? 'bg-(--color-accent)/15 text-(--color-accent)' : 'text-(--color-text-tertiary) hover:bg-(--color-surface-hover)'}"
								onclick={() => (swapSetType = 'dual')}
							>1H + 1H</button>
							<button
								class="text-xs px-2.5 py-1 transition-colors cursor-pointer border-l border-(--color-border)
									{swapSetType === 'twohand' ? 'bg-(--color-accent)/15 text-(--color-accent)' : 'text-(--color-text-tertiary) hover:bg-(--color-surface-hover)'}"
								onclick={() => (swapSetType = 'twohand')}
							>Two-Hand</button>
						</div>
					</div>
					{#if swapSetType === 'dual'}
						<div class="flex gap-3">
							<div class="flex-1">
								<p class="text-xs text-(--color-text-tertiary) mb-1.5">Mainhand</p>
								<div class="flex flex-wrap gap-1.5">
									{#each profWeapons.mainhand as w}
										<button
											class="rounded-md px-3 py-1.5 text-sm transition-all cursor-pointer
												{weaponSwapMainhand === w
													? 'bg-(--color-accent)/15 text-(--color-accent) ring-1 ring-(--color-accent)/50'
													: 'bg-(--color-surface) text-(--color-text-secondary) border border-(--color-border) hover:border-(--color-border-strong)'}"
											onclick={() => (weaponSwapMainhand = weaponSwapMainhand === w ? '' : w)}
										>{w}</button>
									{/each}
								</div>
							</div>
							<div class="flex-1">
								<p class="text-xs text-(--color-text-tertiary) mb-1.5">Offhand</p>
								<div class="flex flex-wrap gap-1.5">
									{#each profWeapons.offhand as w}
										<button
											class="rounded-md px-3 py-1.5 text-sm transition-all cursor-pointer
												{weaponSwapOffhand === w
													? 'bg-(--color-accent)/15 text-(--color-accent) ring-1 ring-(--color-accent)/50'
													: 'bg-(--color-surface) text-(--color-text-secondary) border border-(--color-border) hover:border-(--color-border-strong)'}"
											onclick={() => (weaponSwapOffhand = weaponSwapOffhand === w ? '' : w)}
										>{w}</button>
									{/each}
								</div>
							</div>
						</div>
					{:else}
						<div class="flex flex-wrap gap-1.5">
							{#each profWeapons.twohand as w}
								<button
									class="rounded-md px-3 py-1.5 text-sm transition-all cursor-pointer
										{weaponSwapTwohand === w
											? 'bg-(--color-accent)/15 text-(--color-accent) ring-1 ring-(--color-accent)/50'
											: 'bg-(--color-surface) text-(--color-text-secondary) border border-(--color-border) hover:border-(--color-border-strong)'}"
									onclick={() => (weaponSwapTwohand = weaponSwapTwohand === w ? '' : w)}
								>{w}</button>
							{/each}
						</div>
					{/if}
				</div>

				<!-- Sigils -->
				<div>
					<p class="text-sm font-medium text-(--color-text-secondary) mb-2">Sigils</p>
					<div class="grid grid-cols-2 gap-3">
						<div>
							<p class="text-xs text-(--color-text-tertiary) mb-1.5">Main Set</p>
							<div class="flex gap-2">
								<input
									type="text"
									bind:value={sigilMain1}
									placeholder="Sigil 1"
									class="flex-1 rounded-lg bg-(--color-bg) px-3 py-2 text-sm text-(--color-text) border border-(--color-border) focus:border-(--color-accent) focus:outline-none"
								/>
								<input
									type="text"
									bind:value={sigilMain2}
									placeholder="Sigil 2"
									class="flex-1 rounded-lg bg-(--color-bg) px-3 py-2 text-sm text-(--color-text) border border-(--color-border) focus:border-(--color-accent) focus:outline-none"
								/>
							</div>
						</div>
						<div>
							<p class="text-xs text-(--color-text-tertiary) mb-1.5">Swap Set</p>
							<div class="flex gap-2">
								<input
									type="text"
									bind:value={sigilSwap1}
									placeholder="Sigil 1"
									class="flex-1 rounded-lg bg-(--color-bg) px-3 py-2 text-sm text-(--color-text) border border-(--color-border) focus:border-(--color-accent) focus:outline-none"
								/>
								<input
									type="text"
									bind:value={sigilSwap2}
									placeholder="Sigil 2"
									class="flex-1 rounded-lg bg-(--color-bg) px-3 py-2 text-sm text-(--color-text) border border-(--color-border) focus:border-(--color-accent) focus:outline-none"
								/>
							</div>
						</div>
					</div>
				</div>
			{/if}

			<!-- Rune, Relic & Amulet -->
			<div class="grid grid-cols-3 gap-3">
				<div>
					<label for="rune" class="block text-sm font-medium text-(--color-text-secondary) mb-1.5">Rune</label>
					<input
						id="rune"
						type="text"
						bind:value={rune}
						placeholder="e.g. Scholar"
						class="w-full rounded-lg bg-(--color-bg) px-3 py-2 text-sm text-(--color-text) border border-(--color-border) focus:border-(--color-accent) focus:outline-none"
					/>
				</div>
				<div>
					<label for="relic" class="block text-sm font-medium text-(--color-text-secondary) mb-1.5">Relic</label>
					<input
						id="relic"
						type="text"
						bind:value={relic}
						placeholder="e.g. Thief"
						class="w-full rounded-lg bg-(--color-bg) px-3 py-2 text-sm text-(--color-text) border border-(--color-border) focus:border-(--color-accent) focus:outline-none"
					/>
				</div>
				<div>
					<label for="amulet" class="block text-sm font-medium text-(--color-text-secondary) mb-1.5">Amulet</label>
					<input
						id="amulet"
						type="text"
						bind:value={amulet}
						placeholder="e.g. Berserker"
						class="w-full rounded-lg bg-(--color-bg) px-3 py-2 text-sm text-(--color-text) border border-(--color-border) focus:border-(--color-accent) focus:outline-none"
					/>
				</div>
			</div>

			<!-- Build Label -->
			<div>
				<label for="build-label" class="block text-sm font-medium text-(--color-text-secondary) mb-1.5">Build Name <span class="text-(--color-text-tertiary)">(optional)</span></label>
				<input
					id="build-label"
					type="text"
					bind:value={buildLabel}
					placeholder="e.g. S/D Power Daredevil"
					class="w-full rounded-lg bg-(--color-bg) px-4 py-2.5 text-base text-(--color-text) border border-(--color-border) focus:border-(--color-accent) focus:outline-none"
				/>
			</div>

			<button
				class="mt-2 w-full rounded-xl py-3 text-base font-bold transition-all cursor-pointer
					{canAdvanceStep1
						? 'bg-(--color-accent) text-white hover:bg-(--color-accent-hover)'
						: 'bg-(--color-surface) text-(--color-text-tertiary) cursor-not-allowed'}"
				disabled={!canAdvanceStep1}
				onclick={() => (step = 2)}
			>
				Next &#8594;
			</button>
		</div>
	{/if}

	<!-- Step 2: Playstyle Description -->
	{#if step === 2}
		<div class="flex flex-col gap-4">
			<!-- Build summary card -->
			<div class="rounded-lg border border-l-3 p-3 flex items-center gap-3"
				style="border-color: var(--color-border); border-left-color: {getProfessionColor(profession)}; background-color: color-mix(in srgb, {getProfessionColor(profession)} 6%, transparent);">
				{#if spec}
					<img src={getSpecIcon(spec)} alt="" class="h-10 w-10 spec-icon" />
				{/if}
				<div>
					<p class="text-sm font-medium text-(--color-text)">
						{buildLabel || `${spec === 'core' ? 'Core' : specList.find(s => s.id === spec)?.label ?? spec} ${professionList.find(p => p.id === profession)?.label ?? profession}`}
					</p>
					<p class="text-xs text-(--color-text-tertiary)">
						{characterName} &middot; {role}
						{#if weaponsMainDisplay}
							&middot; {weaponsMainDisplay}{weaponsSwapDisplay ? ` + ${weaponsSwapDisplay}` : ''}
						{/if}
					</p>
				</div>
			</div>

			<h2 class="text-sm font-bold text-(--color-text-secondary) uppercase tracking-wider">Describe Your Build</h2>

			<div>
				<label for="playstyle" class="block text-sm font-medium text-(--color-text-secondary) mb-1">
					How do you play this build? What's your gameplan?
				</label>
				<textarea
					id="playstyle"
					bind:value={playstyle}
					placeholder="I rotate fast between points, arrive at fights to turn 1v1s into 2v1s. I burst with Sword 2 into Flanking Strike..."
					rows={5}
					class="w-full rounded-lg bg-(--color-bg) px-3 py-2 text-sm text-(--color-text) border border-(--color-border) focus:border-(--color-accent) focus:outline-none resize-none"
				></textarea>
				<p class="mt-1 text-xs text-(--color-text-tertiary)">
					Can be brief ("I just started, I don't know yet") or detailed with skill names.
				</p>
			</div>

			<div>
				<label for="weaknesses" class="block text-sm font-medium text-(--color-text-secondary) mb-1">
					What gets you killed most often? <span class="text-(--color-text-tertiary)">(optional)</span>
				</label>
				<textarea
					id="weaknesses"
					bind:value={weaknesses}
					placeholder="Condition pressure, getting CC chained, staying in melee too long..."
					rows={3}
					class="w-full rounded-lg bg-(--color-bg) px-3 py-2 text-sm text-(--color-text) border border-(--color-border) focus:border-(--color-accent) focus:outline-none resize-none"
				></textarea>
			</div>

			{#if generateError}
				<p class="text-xs text-(--color-red)">{generateError}</p>
			{/if}

			<button
				class="mt-2 w-full rounded-xl bg-(--color-accent) py-2.5 text-sm font-bold text-white hover:bg-(--color-accent-hover) transition-all cursor-pointer disabled:opacity-50"
				disabled={loading}
				onclick={generateProfile}
			>
				Generate Profile &#8594;
			</button>

			<!-- Skip generation option -->
			<button
				class="text-xs text-(--color-text-tertiary) hover:text-(--color-text-secondary) transition-colors cursor-pointer"
				onclick={() => { editableProfile = ''; step = 4; }}
			>
				Skip generation — save without profile prompt
			</button>
		</div>
	{/if}

	<!-- Step 3: Streaming generation output -->
	{#if step === 3}
		<div class="flex flex-col gap-4">
			<!-- Build summary card -->
			<div class="rounded-lg border border-l-3 p-3 flex items-center gap-3"
				style="border-color: var(--color-border); border-left-color: {getProfessionColor(profession)}; background-color: color-mix(in srgb, {getProfessionColor(profession)} 6%, transparent);">
				{#if spec}
					<img src={getSpecIcon(spec)} alt="" class="h-10 w-10 spec-icon" />
				{/if}
				<div>
					<p class="text-sm font-medium text-(--color-text)">
						{buildLabel || `${spec === 'core' ? 'Core' : specList.find(s => s.id === spec)?.label ?? spec}`}
					</p>
					<p class="text-xs text-(--color-text-tertiary)">{characterName} &middot; {role}</p>
				</div>
				<div class="ml-auto flex items-center gap-2 text-sm text-(--color-text-tertiary)">
					<span class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-(--color-accent) border-t-transparent"></span>
					<span>{generateElapsed}s</span>
				</div>
			</div>

			{#if streamingText}
				<div class="rounded-lg bg-(--color-bg) border border-(--color-border) p-4 max-h-[28rem] overflow-y-auto" bind:this={streamingContainer}>
					<pre class="text-xs font-mono text-(--color-text-secondary) whitespace-pre-wrap leading-relaxed">{streamingDisplay()}</pre>
				</div>
				{#if streamingText.includes('MATCHUP ASSESSMENTS:')}
					<div class="flex items-center gap-2 text-xs text-(--color-text-tertiary)">
						<span class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-(--color-accent) border-t-transparent"></span>
						Generating matchup assessments...
					</div>
				{/if}
			{/if}

			{#if generateError}
				<p class="text-xs text-(--color-red)">{generateError}</p>
			{/if}
		</div>
	{/if}

	<!-- Step 4: Review and Save -->
	{#if step === 4}
		<div class="flex flex-col gap-4">
			<h2 class="text-sm font-bold text-(--color-text-secondary) uppercase tracking-wider">
				{editableProfile ? 'Review Profile' : 'Save Profile'}
			</h2>

			<!-- Summary -->
			<div class="rounded-lg border border-l-3 bg-(--color-surface) p-3"
				style="border-color: var(--color-border); border-left-color: {getProfessionColor(profession)}; background-color: color-mix(in srgb, {getProfessionColor(profession)} 6%, transparent);">
				<div class="flex items-center gap-2 mb-1">
					{#if spec}
						<img src={getSpecIcon(spec)} alt="" class="h-6 w-6 spec-icon" />
					{/if}
					<span class="font-mono text-sm font-medium text-(--color-text)">
						{buildLabel || `${spec === 'core' ? 'Core' : specList.find(s => s.id === spec)?.label ?? spec} ${professionList.find(p => p.id === profession)?.label ?? profession}`}
					</span>
				</div>
				<div class="text-xs text-(--color-text-secondary)">
					{characterName} &middot; {role}
					{#if weaponsMainDisplay}
						 &middot; {weaponsMainDisplay}{weaponsSwapDisplay ? ` + ${weaponsSwapDisplay}` : ''}
					{/if}
				</div>
			</div>

			<!-- Profile prompt -->
			{#if editableProfile}
				<div>
					<div class="flex items-center justify-between mb-1">
						<label class="text-sm font-medium text-(--color-text-secondary)">
							Profile Prompt <span class="text-(--color-text-tertiary)">(what Claude reads during matches)</span>
						</label>
						<button
							class="text-xs text-(--color-accent) hover:text-(--color-accent-hover) transition-colors cursor-pointer"
							onclick={() => (editingPrompt = !editingPrompt)}
						>
							{editingPrompt ? 'Done' : 'Edit'}
						</button>
					</div>
					{#if editingPrompt}
						<textarea
							id="profile-prompt"
							bind:value={editableProfile}
							rows={16}
							class="w-full rounded-lg bg-(--color-bg) px-3 py-2 text-xs font-mono text-(--color-text) border border-(--color-border) focus:border-(--color-accent) focus:outline-none resize-y leading-relaxed"
						></textarea>
					{:else}
						<div class="rounded-lg bg-(--color-bg) border border-(--color-border) p-4 max-h-80 overflow-y-auto">
							<pre class="text-xs font-mono text-(--color-text-secondary) whitespace-pre-wrap leading-relaxed">{editableProfile}</pre>
						</div>
					{/if}
				</div>
			{/if}

			<!-- Matchup & Threat Assessment — always visible -->
			{#if Object.keys(normalizedMatchups).length > 0}
				{@const hunt = Object.entries(normalizedMatchups).filter(([_, m]) => m.threat === 'HUNT')}
				{@const respect = Object.entries(normalizedMatchups).filter(([_, m]) => m.threat === 'RESPECT')}
				{@const avoid = Object.entries(normalizedMatchups).filter(([_, m]) => m.threat === 'AVOID')}
				<div class="rounded-xl border border-(--color-border) bg-(--color-surface) overflow-hidden">
					<!-- Header -->
					<div class="flex items-center justify-between px-4 py-2.5 border-b border-(--color-border)">
						<span class="text-sm font-bold text-(--color-text)">
							Matchup Assessment
						</span>
						<div class="flex items-center gap-2">
							{#if hunt.length > 0}
								<span class="rounded-full bg-(--color-green)/10 text-(--color-green) px-2 py-0.5 text-[10px] font-bold">
									{hunt.length} HUNT
								</span>
							{/if}
							{#if respect.length > 0}
								<span class="rounded-full bg-(--color-amber)/10 text-(--color-amber) px-2 py-0.5 text-[10px] font-bold">
									{respect.length} RESPECT
								</span>
							{/if}
							{#if avoid.length > 0}
								<span class="rounded-full bg-(--color-red)/10 text-(--color-red) px-2 py-0.5 text-[10px] font-bold">
									{avoid.length} AVOID
								</span>
							{/if}
						</div>
					</div>

					<div class="max-h-[28rem] overflow-y-auto">
						<!-- HUNT section -->
						{#if hunt.length > 0}
							<div class="px-4 pt-3 pb-2">
								<div class="sticky top-0 z-10 flex items-center gap-2 mb-2 -mx-4 px-4 py-1.5 bg-(--color-surface)">
									<div class="w-1 h-4 rounded-full bg-(--color-green)"></div>
									<span class="text-xs font-bold uppercase tracking-wider text-(--color-green)">Hunt</span>
									<span class="text-[10px] text-(--color-text-tertiary)">— you win these 1v1. Seek them out.</span>
								</div>
								<div class="grid gap-1.5">
									{#each hunt as [specId, m]}
										{@const profId = getProfessionForSpec(specId)}
										<div class="rounded-lg border-l-3 px-3 py-2 flex items-center gap-2.5"
											style="border-left-color: {profId ? getProfessionColor(profId) : 'var(--color-green)'}; background-color: color-mix(in srgb, {profId ? getProfessionColor(profId) : 'var(--color-green)'} 6%, transparent);">
											<img src={getSpecIcon(specId)} alt="" class="size-8 spec-icon shrink-0" />
											<div class="min-w-0">
												<span class="font-mono text-sm font-medium text-(--color-text) leading-tight">{specId}</span>
												<p class="text-xs text-(--color-text-secondary) leading-relaxed mt-0.5">{m.tip}</p>
											</div>
										</div>
									{/each}
								</div>
							</div>
						{/if}

						<!-- RESPECT section -->
						{#if respect.length > 0}
							<div class="px-4 pt-3 pb-2 {hunt.length > 0 ? 'border-t border-(--color-border)/50' : ''}">
								<div class="sticky top-0 z-10 flex items-center gap-2 mb-2 -mx-4 px-4 py-1.5 bg-(--color-surface)">
									<div class="w-1 h-4 rounded-full bg-(--color-amber)"></div>
									<span class="text-xs font-bold uppercase tracking-wider text-(--color-amber)">Respect</span>
									<span class="text-[10px] text-(--color-text-tertiary)">— skill matchup. Can win but dangerous.</span>
								</div>
								<div class="grid gap-1.5">
									{#each respect as [specId, m]}
										{@const profId = getProfessionForSpec(specId)}
										<div class="rounded-lg border-l-3 px-3 py-2 flex items-center gap-2.5"
											style="border-left-color: {profId ? getProfessionColor(profId) : 'var(--color-amber)'}; background-color: color-mix(in srgb, {profId ? getProfessionColor(profId) : 'var(--color-amber)'} 6%, transparent);">
											<img src={getSpecIcon(specId)} alt="" class="size-8 spec-icon shrink-0" />
											<div class="min-w-0">
												<span class="font-mono text-sm font-medium text-(--color-text) leading-tight">{specId}</span>
												<p class="text-xs text-(--color-text-secondary) leading-relaxed mt-0.5">{m.tip}</p>
											</div>
										</div>
									{/each}
								</div>
							</div>
						{/if}

						<!-- AVOID section -->
						{#if avoid.length > 0}
							<div class="px-4 pt-3 pb-3 {(hunt.length > 0 || respect.length > 0) ? 'border-t border-(--color-border)/50' : ''}">
								<div class="sticky top-0 z-10 flex items-center gap-2 mb-2 -mx-4 px-4 py-1.5 bg-(--color-surface)">
									<div class="w-1 h-4 rounded-full bg-(--color-red)"></div>
									<span class="text-xs font-bold uppercase tracking-wider text-(--color-red)">Avoid</span>
									<span class="text-[10px] text-(--color-text-tertiary)">— hard counter. Don't 1v1, only +1.</span>
								</div>
								<div class="grid gap-1.5">
									{#each avoid as [specId, m]}
										{@const profId = getProfessionForSpec(specId)}
										<div class="rounded-lg border-l-3 px-3 py-2 flex items-center gap-2.5"
											style="border-left-color: {profId ? getProfessionColor(profId) : 'var(--color-red)'}; background-color: color-mix(in srgb, {profId ? getProfessionColor(profId) : 'var(--color-red)'} 6%, transparent);">
											<img src={getSpecIcon(specId)} alt="" class="size-8 spec-icon shrink-0" />
											<div class="min-w-0">
												<span class="font-mono text-sm font-medium text-(--color-text) leading-tight">{specId}</span>
												<p class="text-xs text-(--color-text-secondary) leading-relaxed mt-0.5">{m.tip}</p>
											</div>
										</div>
									{/each}
								</div>
							</div>
						{/if}
					</div>
				</div>
			{/if}

			{#if saveError}
				<p class="text-xs text-(--color-red)">{saveError}</p>
			{/if}

			<!-- Actions -->
			<div class="flex gap-2">
				<button
					class="rounded-xl border border-(--color-border) px-4 py-2.5 text-sm text-(--color-text-secondary) hover:text-(--color-text) hover:border-(--color-border-strong) transition-colors cursor-pointer"
					onclick={() => (step = 1)}
				>
					&#8592; Build Info
				</button>
				<button
					class="rounded-xl border border-(--color-border) px-4 py-2.5 text-sm text-(--color-text-secondary) hover:text-(--color-text) hover:border-(--color-border-strong) transition-colors cursor-pointer"
					onclick={() => (step = 2)}
				>
					Regenerate
				</button>
				<button
					class="flex-1 rounded-xl bg-(--color-accent) py-2.5 text-sm font-bold text-white hover:bg-(--color-accent-hover) transition-all cursor-pointer disabled:opacity-50"
					disabled={loading}
					onclick={saveProfile}
				>
					{#if loading}
						Saving...
					{:else}
						Save &#10003;
					{/if}
				</button>
			</div>
		</div>
	{/if}
</div>
