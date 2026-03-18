<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { maps, getSpecLabel, getProfessionColor } from '$lib/game-data.js';

	interface MatchPlayer {
		characterName: string;
		team: string;
		profession: string;
		spec: string;
		role: string;
		isUser: boolean;
		ratingSkill: number | null;
		ratingFriendly: number | null;
		tag: string | null;
	}

	interface MatchRecord {
		matchId: string;
		userTeamColor: string | null;
		map: string | null;
		result: string | null;
		screenshotHash: string | null;
		screenshotUrl: string | null;
		adviceText: string | null;
		timestamp: string;
		players: MatchPlayer[];
	}

	interface ParsedAdvice {
		focusOrder: string;
		babysit: string;
		mapAdvice: string;
		gameplan: string;
		positioning: string;
		enemyAdvice: { threat: string; advice: string; dont_hit?: string }[];
		allyAdvice: { advice?: string }[];
	}

	let match = $state<MatchRecord | null>(null);
	let loading = $state(true);
	let screenshotZoomed = $state(false);
	let editingMap = $state(false);
	let isAdmin = $state(false);
	let showDebug = $state(false);
	let debugData = $state<{
		adviceRaw: string | null;
		systemPrompt: string | null;
		profilePrompt: string | null;
		userMessage: string | null;
	} | null>(null);
	let debugLoading = $state(false);

	async function setMap(mapId: string) {
		if (!match) return;
		try {
			await fetch('/api/match', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ matchId: match.matchId, map: mapId })
			});
			match = { ...match, map: mapId };
		} finally {
			editingMap = false;
		}
	}

	async function updateMatchPlayer(characterName: string, updates: Record<string, unknown>) {
		if (!match) return;
		try {
			await fetch('/api/match/ratings', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ matchId: match.matchId, ratings: [{ characterName, ...updates }] })
			});
		} catch { /* non-critical */ }
	}

	function setPlayerRating(characterName: string, type: 'ratingSkill' | 'ratingFriendly', value: number) {
		if (!match) return;
		const idx = match.players.findIndex(p => p.characterName === characterName);
		if (idx < 0) return;
		const p = match.players[idx];
		const newVal = p[type] === value ? null : value;
		match = { ...match, players: match.players.map((pl, i) => i === idx ? { ...pl, [type]: newVal } : pl) };
		updateMatchPlayer(characterName, { [type]: newVal });
	}

	function toggleTag(characterName: string, tag: 'friend' | 'avoid') {
		if (!match) return;
		const idx = match.players.findIndex(p => p.characterName === characterName);
		if (idx < 0) return;
		const newTag = match.players[idx].tag === tag ? null : tag;
		match = { ...match, players: match.players.map((pl, i) => i === idx ? { ...pl, tag: newTag } : pl) };
		updateMatchPlayer(characterName, { tag: newTag });
	}

	onMount(async () => {
		try {
			const [matchRes, meRes] = await Promise.all([
				fetch('/api/match?limit=1'),
				fetch('/api/auth/me')
			]);
			if (matchRes.ok) {
				const data = await matchRes.json();
				const matches = data.matches ?? data;
				if (matches.length > 0) match = matches[0];
			}
			if (meRes.ok) {
				const meData = await meRes.json();
				isAdmin = meData.user?.role === 'admin';
			}
		} finally {
			loading = false;
		}
	});

	async function loadDebugData() {
		if (!match) return;
		debugLoading = true;
		try {
			const res = await fetch(`/api/admin/debug/${match.matchId}`);
			if (res.ok) {
				debugData = await res.json();
				showDebug = true;
			}
		} finally {
			debugLoading = false;
		}
	}

	function getMapName(mapId: string | null): string {
		if (!mapId) return 'Unknown';
		return maps.find((m) => m.id === mapId)?.name ?? mapId;
	}

	function getSpecIconUrl(specId: string, professionId?: string): string {
		const id = specId === 'core' && professionId ? professionId : specId;
		return `/icons/specs/${id}.png`;
	}

	function specIconStyle(specId: string, professionId: string): string {
		const url = getSpecIconUrl(specId, professionId);
		const color = getProfessionColor(professionId);
		return `background-color: ${color}; -webkit-mask-image: url(${url}); mask-image: url(${url}); -webkit-mask-size: contain; mask-size: contain; -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;`;
	}

	function getTeams(m: MatchRecord) {
		return {
			redTeam: m.players.filter((p) => p.team === 'red'),
			blueTeam: m.players.filter((p) => p.team === 'blue')
		};
	}

	function getEnemyAllyTeams(m: MatchRecord) {
		const myColor = m.userTeamColor ?? 'red';
		const enemyColor = myColor === 'red' ? 'blue' : 'red';
		return {
			myTeam: m.players.filter((p) => p.team === myColor),
			enemyTeam: m.players.filter((p) => p.team === enemyColor)
		};
	}

	function parseAdvice(m: MatchRecord): ParsedAdvice | null {
		if (!m.adviceText) return null;
		const { myTeam, enemyTeam } = getEnemyAllyTeams(m);
		const result: ParsedAdvice = {
			focusOrder: '', babysit: '', mapAdvice: '', gameplan: '', positioning: '',
			enemyAdvice: enemyTeam.map(() => ({ threat: '', advice: '' })),
			allyAdvice: myTeam.map(() => ({ advice: undefined }))
		};

		const lines = m.adviceText.split('\n');
		let section = '';
		let playerIdx = -1;
		let currentBlock = '';

		for (const line of lines) {
			const trimmed = line.trim();
			if (/^-{3,}$|^\*{3,}$|^_{3,}$/.test(trimmed)) continue;

			if (/^(?:#+|\d+\.|\*\*)\s*(TEAM COMP|PER-ENEMY|PER.ALLY|FOCUS ORDER|MAP STRATEGY|GENERAL GAMEPLAN|WHO TO BABYSIT|ENEMY THREATS|TEAMFIGHT POSITION|KEY COOLDOWN)/i.test(trimmed)) {
				flush(result, section, playerIdx, currentBlock, enemyTeam, myTeam);
				currentBlock = '';
				playerIdx = -1;

				if (/PER-ENEMY|ENEMY THREATS/i.test(trimmed)) section = 'per_enemy';
				else if (/PER.ALLY/i.test(trimmed)) section = 'per_ally';
				else if (/FOCUS ORDER/i.test(trimmed)) section = 'focus';
				else if (/MAP STRATEGY/i.test(trimmed)) section = 'map';
				else if (/GENERAL GAMEPLAN/i.test(trimmed)) section = 'gameplan';
				else if (/WHO TO BABYSIT/i.test(trimmed)) section = 'babysit';
				else if (/TEAMFIGHT POSITION/i.test(trimmed)) section = 'positioning';
				else if (/KEY COOLDOWN/i.test(trimmed)) section = 'gameplan';
				else section = 'team_comp';
				continue;
			}

			const playerMatch = trimmed.match(/^(?:#+\s*|\*\*)?(\d+)\.[\s*]*(.+)/);
			if (playerMatch && (section === 'per_enemy' || section === 'per_ally')) {
				flush(result, section, playerIdx, currentBlock, enemyTeam, myTeam);
				currentBlock = '';
				const headerText = playerMatch[2].toLowerCase();
				const team = section === 'per_enemy' ? enemyTeam : myTeam;
				const nameMatchIdx = team.findIndex(p =>
					p.characterName && headerText.includes(p.characterName.toLowerCase())
				);
				playerIdx = nameMatchIdx >= 0 ? nameMatchIdx : parseInt(playerMatch[1]) - 1;

				if (section === 'per_enemy') {
					const threatMatch = headerText.match(/\b(HUNT|RESPECT|AVOID)\b/i);
					if (threatMatch && playerIdx >= 0 && playerIdx < result.enemyAdvice.length) {
						result.enemyAdvice[playerIdx] = { ...result.enemyAdvice[playerIdx], threat: threatMatch[1].toLowerCase() };
					}
				}
				continue;
			}
			currentBlock += line + '\n';
		}

		flush(result, section, playerIdx, currentBlock, enemyTeam, myTeam);
		return result;
	}

	function flush(result: ParsedAdvice, section: string, playerIdx: number, block: string, enemyTeam: MatchPlayer[], myTeam: MatchPlayer[]) {
		const text = block.trim();
		if (!text) return;
		if (section === 'per_enemy' && playerIdx >= 0 && playerIdx < result.enemyAdvice.length) {
			const dontHitMatch = text.match(/(?:DON'?T\s+HIT|DO NOT HIT)[:\s]*(.*)/is);
			const mainAdvice = dontHitMatch ? text.replace(dontHitMatch[0], '').trim() : text;
			const dontHit = dontHitMatch ? dontHitMatch[1].trim() : undefined;
			result.enemyAdvice[playerIdx] = { ...result.enemyAdvice[playerIdx], advice: mainAdvice, dont_hit: dontHit || result.enemyAdvice[playerIdx].dont_hit };
		} else if (section === 'per_ally' && playerIdx >= 0 && playerIdx < result.allyAdvice.length) {
			result.allyAdvice[playerIdx] = { advice: text };
		} else if (section === 'focus') result.focusOrder = text;
		else if (section === 'map') result.mapAdvice = text;
		else if (section === 'gameplan') result.gameplan = text;
		else if (section === 'babysit') result.babysit = text;
		else if (section === 'positioning') result.positioning = text;
	}

	function buildNameFragments(m: MatchRecord): Set<string> {
		const fragments = new Set<string>();
		for (const p of m.players) {
			const name = p.characterName;
			if (!name || name.startsWith('Unknown Player')) continue;
			fragments.add(name);
			const words = name.split(/\s+/);
			if (words.length > 1) {
				for (const word of words) {
					if (word.length >= 3) fragments.add(word);
				}
			}
		}
		return fragments;
	}

	function splitSentences(text: string): string {
		const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z"'"(])/).map(s => s.trim()).filter(Boolean);
		if (sentences.length <= 1) return `• ${text}`;
		return '<ul class="list-disc list-inside space-y-0.5">' + sentences.map(s => `<li>${s}</li>`).join('') + '</ul>';
	}

	function highlightNames(text: string, fragments: Set<string>): string {
		let result = splitSentences(text);
		result = result.replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold text-(--color-text)">$1</strong>');
		if (fragments.size === 0) return result;
		const sorted = [...fragments].sort((a, b) => b.length - a.length);
		const escaped = sorted.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
		const pattern = new RegExp(`(?<![<\\w])\\b(${escaped.join('|')})\\b(?![\\w>])`, 'gi');
		return result.replace(pattern, '<strong class="font-semibold text-(--color-text)">$1</strong>');
	}

	function getThreatColor(threat: string): string {
		switch (threat) {
			case 'hunt': return 'text-(--color-red) bg-(--color-red)/10';
			case 'respect': return 'text-(--color-amber) bg-(--color-amber)/10';
			case 'avoid': return 'text-(--color-text-tertiary) bg-(--color-surface-raised)';
			default: return 'text-(--color-text-tertiary)';
		}
	}

	// Helpers for inline advice lookup
	function getEnemyAdviceForIdx(advice: ParsedAdvice | null, idx: number) {
		if (!advice) return null;
		const a = advice.enemyAdvice[idx];
		return a?.advice ? a : null;
	}

	function getAllyAdviceForIdx(advice: ParsedAdvice | null, idx: number) {
		if (!advice) return null;
		const a = advice.allyAdvice[idx];
		return a?.advice ? a : null;
	}
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') screenshotZoomed = false; }} />

{#snippet playerRow(p: MatchPlayer, side: 'my' | 'enemy', playerIdx: number, advice: ParsedAdvice | null, nameFrags: Set<string>)}
	{@const eAdvice = side === 'enemy' ? getEnemyAdviceForIdx(advice, playerIdx) : null}
	{@const aAdvice = side === 'my' ? getAllyAdviceForIdx(advice, playerIdx) : null}
	<div class="group relative rounded-lg border-l-3 px-3 py-2
		{p.isUser ? 'border-l-(--color-amber)/30' : ''}"
		style="{!p.isUser ? `border-left-color: ${getProfessionColor(p.profession)};` : ''} background-color: color-mix(in srgb, {getProfessionColor(p.profession)} 6%, transparent);"
	>
		<div class="flex items-center gap-2.5">
			<span
				class="inline-block h-8 w-8 flex-shrink-0"
				style={specIconStyle(p.spec, p.profession)}
				title={getSpecLabel(p.profession, p.spec)}
			></span>
			<div class="min-w-0 flex-1">
				<div class="flex items-center gap-2">
					<span class="truncate font-mono text-sm font-bold" style="color: {getProfessionColor(p.profession)};">{p.characterName}</span>
					{#if p.isUser}
						<span class="shrink-0 text-[10px] font-medium text-(--color-amber)/70">you</span>
					{/if}
					<!-- Threat badge inline -->
					{#if eAdvice?.threat}
						<span class="ml-auto shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider {getThreatColor(eAdvice.threat)}">
							{eAdvice.threat}
						</span>
					{/if}
				</div>
				<div class="flex items-center gap-1.5 mt-0.5">
					<span class="text-xs" style="color: {getProfessionColor(p.profession)}; opacity: 0.7;">
						{getSpecLabel(p.profession, p.spec)}
					</span>
					<span class="text-xs text-(--color-text-tertiary)">&middot;</span>
					<span class="text-xs text-(--color-text-tertiary)">{p.role}</span>
				</div>
			</div>

			<!-- Right side: 3-row ratings + tags block -->
			{#if !p.isUser}
				<div class="shrink-0 flex flex-col opacity-60 group-hover:opacity-100 transition-opacity">
					<!-- Row 1: Skill -->
					<div class="flex items-center justify-between h-4">
						<span class="text-[8px] font-bold uppercase tracking-wider text-(--color-amber)/50 mr-2">Skill</span>
						<div class="flex items-center gap-px">
							{#each [1, 2, 3, 4, 5] as star}
								<button
									class="text-[11px] leading-none cursor-pointer transition-colors {p.ratingSkill !== null && star <= (p.ratingSkill ?? 0) ? 'text-(--color-amber)' : 'text-(--color-text-tertiary)/20 hover:text-(--color-amber)/50'}"
									onclick={() => setPlayerRating(p.characterName, 'ratingSkill', star)}
								>&#9733;</button>
							{/each}
						</div>
					</div>
					<!-- Row 2: Vibe -->
					<div class="flex items-center justify-between h-4">
						<span class="text-[8px] font-bold uppercase tracking-wider text-(--color-green)/50 mr-2">Vibe</span>
						<div class="flex items-center gap-px">
							{#each [1, 2, 3, 4, 5] as star}
								<button
									class="text-[11px] leading-none cursor-pointer transition-colors {p.ratingFriendly !== null && star <= (p.ratingFriendly ?? 0) ? 'text-(--color-green)' : 'text-(--color-text-tertiary)/20 hover:text-(--color-green)/50'}"
									onclick={() => setPlayerRating(p.characterName, 'ratingFriendly', star)}
								>&#9733;</button>
							{/each}
						</div>
					</div>
					<!-- Row 3: Friend | Avoid -->
					<div class="flex items-center gap-0.5 h-4">
						<button
							class="flex-1 rounded-full px-1.5 text-[8px] font-bold uppercase tracking-wider cursor-pointer transition-colors border leading-none text-center
								{p.tag === 'friend'
									? 'text-(--color-green) bg-(--color-green)/15 border-(--color-green)/30'
									: 'text-(--color-text-tertiary)/30 border-transparent hover:text-(--color-green)/60 hover:border-(--color-green)/20'}"
							onclick={() => toggleTag(p.characterName, 'friend')}
						>Friend</button>
						<button
							class="flex-1 rounded-full px-1.5 text-[8px] font-bold uppercase tracking-wider cursor-pointer transition-colors border leading-none text-center
								{p.tag === 'avoid'
									? 'text-(--color-red) bg-(--color-red)/15 border-(--color-red)/30'
									: 'text-(--color-text-tertiary)/30 border-transparent hover:text-(--color-red)/60 hover:border-(--color-red)/20'}"
							onclick={() => toggleTag(p.characterName, 'avoid')}
						>Avoid</button>
					</div>
				</div>
			{/if}
		</div>

		<!-- Inline advice (collapsible, open by default) -->
		{#if eAdvice?.advice}
			<details open class="mt-2">
				<summary class="text-[9px] font-bold uppercase tracking-wider text-(--color-text-tertiary)/50 cursor-pointer hover:text-(--color-text-tertiary) select-none">Advice</summary>
				<div class="mt-1 pl-1 border-l-2 border-(--color-border)/50 ml-1">
					<p class="text-xs leading-relaxed text-(--color-text-secondary) whitespace-pre-line">{@html highlightNames(eAdvice.advice, nameFrags)}</p>
					{#if eAdvice.dont_hit}
						<p class="mt-1 text-xs font-medium text-(--color-amber)">&#9888; DON'T HIT: {@html highlightNames(eAdvice.dont_hit, nameFrags)}</p>
					{/if}
				</div>
			</details>
		{/if}
		{#if aAdvice?.advice}
			<details open class="mt-2">
				<summary class="text-[9px] font-bold uppercase tracking-wider text-(--color-text-tertiary)/50 cursor-pointer hover:text-(--color-text-tertiary) select-none">Ally Note</summary>
				<div class="mt-1 pl-1 border-l-2 border-(--color-border)/50 ml-1">
					<p class="text-xs leading-relaxed text-(--color-text-secondary) whitespace-pre-line">{@html highlightNames(aAdvice.advice, nameFrags)}</p>
				</div>
			</details>
		{/if}
	</div>
{/snippet}

{#if loading}
	<div class="flex items-center justify-center py-20">
		<span class="inline-block h-5 w-5 animate-spin rounded-full border-2 border-(--color-accent) border-t-transparent"></span>
	</div>
{:else if !match}
	<div class="flex flex-col items-center justify-center py-20 text-(--color-text-tertiary)">
		<p class="text-base">No matches in history</p>
		<p class="text-sm mt-1">Scan a match first, then visit this page</p>
	</div>
{:else}
	{@const { redTeam, blueTeam } = getTeams(match)}
	{@const { myTeam, enemyTeam } = getEnemyAllyTeams(match)}
	{@const advice = parseAdvice(match)}
	{@const nameFrags = buildNameFragments(match)}

	<div>
		<!-- Top bar: screenshot + metadata -->
		<div class="mb-4 flex items-center gap-4 rounded-xl border border-(--color-border) bg-(--color-surface) p-3">
			{#if match.screenshotUrl}
				<button class="shrink-0 cursor-pointer rounded-lg overflow-hidden border border-(--color-border) hover:border-(--color-accent)/50 transition-colors w-32"
					onclick={() => (screenshotZoomed = true)}>
					<img src={match.screenshotUrl} alt="Match screenshot" class="w-full h-auto" />
				</button>
			{/if}
			<div class="flex-1">
				<div class="flex items-center gap-2">
					<span class="text-[10px] font-bold uppercase tracking-wider text-(--color-text-tertiary)">Map</span>
					{#if isAdmin}
						<button
							onclick={loadDebugData}
							disabled={debugLoading}
							class="ml-auto shrink-0 rounded border border-(--color-accent)/30 bg-(--color-accent)/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-(--color-accent) hover:bg-(--color-accent)/20 transition-colors cursor-pointer"
							title="View debug data (admin)"
						>
							{debugLoading ? '...' : 'Debug'}
						</button>
					{/if}
					{#if editingMap}
						<select
							class="rounded-lg bg-(--color-surface) border border-(--color-border) px-2 py-1 text-sm text-(--color-text) outline-none"
							value={match.map ?? ''}
							onchange={(e) => setMap((e.currentTarget as HTMLSelectElement).value)}
							onblur={() => (editingMap = false)}
						>
							<optgroup label="Conquest">
								{#each maps.filter(m => m.mode === 'conquest' && !m.is_default) as m}
									<option value={m.id}>{m.name}</option>
								{/each}
							</optgroup>
							<optgroup label="Push">
								{#each maps.filter(m => m.mode === 'push') as m}
									<option value={m.id}>{m.name}</option>
								{/each}
							</optgroup>
							<optgroup label="Stronghold">
								{#each maps.filter(m => m.mode === 'stronghold') as m}
									<option value={m.id}>{m.name}</option>
								{/each}
							</optgroup>
						</select>
					{:else}
						<button
							class="text-sm font-medium text-(--color-text) hover:text-(--color-accent) transition-colors cursor-pointer border-b border-dashed border-(--color-text-tertiary)/40 hover:border-(--color-accent)"
							onclick={() => (editingMap = true)}
							title="Click to change map"
						>
							{maps.find(m => m.id === match?.map)?.name ?? 'Unknown Map'}
						</button>
					{/if}
				</div>
				<p class="text-xs text-(--color-text-tertiary) mt-0.5">{match.players.length} players</p>
			</div>
		</div>

		<!-- Screenshot zoom modal -->
		{#if screenshotZoomed && match.screenshotUrl}
			<div
				class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm cursor-pointer animate-fade-in"
				onclick={() => (screenshotZoomed = false)}
				role="dialog"
				tabindex="-1"
			>
				<img
					src={match.screenshotUrl}
					alt="Match screenshot (zoomed)"
					class="max-w-[95vw] max-h-[95vh] object-contain rounded-lg shadow-2xl animate-modal-in"
				/>
			</div>
		{/if}

		<!-- Strategy sections as individual colored cards -->
		{#if advice && (advice.focusOrder || advice.mapAdvice || advice.gameplan || advice.babysit || advice.positioning)}
			<div class="mb-4 flex flex-col gap-2">
				{#if advice.focusOrder}
					<div class="rounded-lg border border-(--color-border) bg-(--color-surface) p-3 border-l-3 border-l-(--color-red)/60">
						<p class="text-[10px] font-bold uppercase tracking-wider text-(--color-red)/70 mb-1">Focus Order</p>
						<p class="text-sm text-(--color-text) leading-relaxed">{@html highlightNames(advice.focusOrder, nameFrags)}</p>
					</div>
				{/if}
				{#if advice.babysit}
					<div class="rounded-lg border border-(--color-border) bg-(--color-surface) p-3 border-l-3 border-l-(--color-accent)/50">
						<p class="text-[10px] font-bold uppercase tracking-wider text-(--color-accent)/70 mb-1">Babysit</p>
						<p class="text-xs leading-relaxed text-(--color-text-secondary) whitespace-pre-line">{@html highlightNames(advice.babysit, nameFrags)}</p>
					</div>
				{/if}
				{#if advice.mapAdvice}
					<div class="rounded-lg border border-(--color-border) bg-(--color-surface) p-3 border-l-3 border-l-(--color-amber)/60">
						<p class="text-[10px] font-bold uppercase tracking-wider text-(--color-amber)/70 mb-1">Map Opening</p>
						<p class="text-xs leading-relaxed text-(--color-text-secondary) whitespace-pre-line">{@html highlightNames(advice.mapAdvice, nameFrags)}</p>
					</div>
				{/if}
				{#if advice.gameplan}
					<div class="rounded-lg border border-(--color-border) bg-(--color-surface) p-3 border-l-3 border-l-(--color-green)/60">
						<p class="text-[10px] font-bold uppercase tracking-wider text-(--color-green)/70 mb-1">Gameplan</p>
						<p class="text-xs leading-relaxed text-(--color-text-secondary) whitespace-pre-line">{@html highlightNames(advice.gameplan, nameFrags)}</p>
					</div>
				{/if}
				{#if advice.positioning}
					<div class="rounded-lg border border-(--color-border) bg-(--color-surface) p-3 border-l-3 border-l-(--color-text-tertiary)/50">
						<p class="text-[10px] font-bold uppercase tracking-wider text-(--color-text-tertiary)/70 mb-1">Positioning</p>
						<p class="text-xs leading-relaxed text-(--color-text-secondary) whitespace-pre-line">{@html highlightNames(advice.positioning, nameFrags)}</p>
					</div>
				{/if}
			</div>
		{/if}

		<!-- Teams: Red left, Blue right — with inline advice -->
		<div class="grid grid-cols-2 gap-4">
			<div>
				<div class="mb-2 flex items-center gap-2">
					<div class="h-2 w-2 rounded-full bg-(--color-team-red)"></div>
					<h2 class="text-xs font-bold uppercase tracking-widest text-(--color-text-secondary)">
						Red Team
						{#if match.userTeamColor === 'red'}
							<span class="font-normal text-(--color-amber)/60 ml-1">(you)</span>
						{/if}
					</h2>
				</div>
				<div class="flex flex-col gap-1.5">
					{#each redTeam as p, i}
						{@const side = match.userTeamColor === 'red' ? 'my' : 'enemy'}
						{@const teamPlayers = side === 'my' ? myTeam : enemyTeam}
						{@const pIdx = teamPlayers.findIndex(tp => tp.characterName === p.characterName)}
						{@render playerRow(p, side, pIdx >= 0 ? pIdx : i, advice, nameFrags)}
					{/each}
				</div>
			</div>

			<div>
				<div class="mb-2 flex items-center gap-2">
					<div class="h-2 w-2 rounded-full bg-(--color-team-blue)"></div>
					<h2 class="text-xs font-bold uppercase tracking-widest text-(--color-text-secondary)">
						Blue Team
						{#if match.userTeamColor === 'blue'}
							<span class="font-normal text-(--color-amber)/60 ml-1">(you)</span>
						{/if}
					</h2>
				</div>
				<div class="flex flex-col gap-1.5">
					{#each blueTeam as p, i}
						{@const side = match.userTeamColor === 'blue' ? 'my' : 'enemy'}
						{@const teamPlayers = side === 'my' ? myTeam : enemyTeam}
						{@const pIdx = teamPlayers.findIndex(tp => tp.characterName === p.characterName)}
						{@render playerRow(p, side, pIdx >= 0 ? pIdx : i, advice, nameFrags)}
					{/each}
				</div>
			</div>
		</div>
	</div>

	<!-- Debug modal (admin only) -->
	{#if showDebug && debugData}
		<div
			class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
			onclick={(e) => { if (e.target === e.currentTarget) showDebug = false; }}
			role="dialog"
			tabindex="-1"
		>
			<div class="glass max-w-4xl w-full max-h-[90vh] overflow-y-auto rounded-xl p-6 border border-(--color-border) shadow-xl animate-modal-in m-4">
				<div class="flex items-center justify-between mb-4">
					<h2 class="text-lg font-bold text-(--color-text)">Debug: Advice Raw</h2>
					<button class="text-(--color-text-tertiary) hover:text-(--color-text) text-lg cursor-pointer transition-colors" onclick={() => (showDebug = false)}>&#10005;</button>
				</div>

				<div class="space-y-4">
					<!-- Raw advice output -->
					<div>
						<p class="text-xs font-bold uppercase tracking-wider text-(--color-text-tertiary) mb-1">advice_raw</p>
						<pre class="rounded-lg bg-(--color-bg) border border-(--color-border) p-3 text-xs font-mono text-(--color-text) whitespace-pre-wrap max-h-64 overflow-y-auto">{debugData.adviceRaw ?? '(empty)'}</pre>
					</div>

					<!-- System prompt -->
					<div>
						<p class="text-xs font-bold uppercase tracking-wider text-(--color-text-tertiary) mb-1">System Prompt</p>
						<pre class="rounded-lg bg-(--color-bg) border border-(--color-border) p-3 text-xs font-mono text-(--color-text-secondary) whitespace-pre-wrap max-h-48 overflow-y-auto">{debugData.systemPrompt ?? '(empty)'}</pre>
					</div>

					<!-- Profile prompt -->
					{#if debugData.profilePrompt}
						<div>
							<p class="text-xs font-bold uppercase tracking-wider text-(--color-text-tertiary) mb-1">Profile Prompt</p>
							<pre class="rounded-lg bg-(--color-bg) border border-(--color-border) p-3 text-xs font-mono text-(--color-text-secondary) whitespace-pre-wrap max-h-32 overflow-y-auto">{debugData.profilePrompt}</pre>
						</div>
					{/if}

					<!-- User message -->
					<div>
						<p class="text-xs font-bold uppercase tracking-wider text-(--color-text-tertiary) mb-1">User Message</p>
						<pre class="rounded-lg bg-(--color-bg) border border-(--color-border) p-3 text-xs font-mono text-(--color-text-secondary) whitespace-pre-wrap max-h-48 overflow-y-auto">{debugData.userMessage ?? '(empty)'}</pre>
					</div>
				</div>
			</div>
		</div>
	{/if}
{/if}
