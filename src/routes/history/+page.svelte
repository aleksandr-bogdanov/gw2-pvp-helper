<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { maps, specs, getSpecsForProfession, getSpecLabel, getProfessionLabel, getProfessionColor } from '$lib/game-data.js';
	import type { MatchPlayer, MatchRecord, ParsedAdvice } from '$lib/match-types.js';
	import {
		specIconStyle, getSpecIconUrl, getMapName, getMapMode,
		getThreatColor, getModeColor, formatTime,
		getTeams, getEnemyAllyTeams,
		getEnemyAdviceForIdx, getAllyAdviceForIdx,
		buildNameFragments, highlightNames,
		parseAdvice
	} from '$lib/match-utils.js';

	const PAGE_SIZE = 20;

	let matchHistory = $state<MatchRecord[]>([]);
	let totalMatches = $state(0);
	let currentPage = $state(0);
	let loading = $state(true);
	let loadingMore = $state(false);
	let error = $state<string | null>(null);
	let zoomedScreenshot = $state<string | null>(null);
	let deletingMatch = $state<string | null>(null);
	let updatingResult = $state<string | null>(null);
	let editingMap = $state<string | null>(null);

	// Inline editing state
	let editingName = $state<{ matchId: string; characterName: string } | null>(null);
	let specPickerOpen = $state<{ matchId: string; characterName: string } | null>(null);
	let pickerProfession = $state<string | null>(null);

	let totalPages = $derived(Math.ceil(totalMatches / PAGE_SIZE));

	async function loadPage(page: number) {
		const isInitial = matchHistory.length === 0;
		if (isInitial) loading = true;
		else loadingMore = true;
		error = null;

		try {
			const res = await fetch(`/api/match?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`);
			if (res.ok) {
				const data = await res.json();
				matchHistory = data.matches ?? data;
				totalMatches = data.total ?? matchHistory.length;
				currentPage = page;
			} else if (res.status === 401) {
				error = 'Session expired. Please log in again.';
			} else {
				error = 'Failed to load match history. Check your connection and try again.';
			}
		} catch {
			error = 'Failed to load match history. Check your connection and try again.';
		} finally {
			loading = false;
			loadingMore = false;
		}
	}

	onMount(() => loadPage(0));

	// --- Result editing ---
	async function setResult(match: MatchRecord, result: 'win' | 'loss' | null) {
		updatingResult = match.matchId;
		try {
			const res = await fetch('/api/match', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ matchId: match.matchId, result })
			});
			if (res.ok) {
				const idx = matchHistory.findIndex((m) => m.matchId === match.matchId);
				if (idx >= 0) {
					matchHistory[idx] = { ...matchHistory[idx], result };
				}
			}
		} finally {
			updatingResult = null;
		}
	}

	// --- Map editing ---
	async function setMap(match: MatchRecord, mapId: string) {
		try {
			const res = await fetch('/api/match', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ matchId: match.matchId, map: mapId })
			});
			if (res.ok) {
				const idx = matchHistory.findIndex((m) => m.matchId === match.matchId);
				if (idx >= 0) {
					matchHistory[idx] = { ...matchHistory[idx], map: mapId };
				}
			}
		} finally {
			editingMap = null;
		}
	}

	// --- Delete match ---
	async function deleteMatch(match: MatchRecord) {
		deletingMatch = match.matchId;
		try {
			const res = await fetch('/api/match', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ matchId: match.matchId })
			});
			if (res.ok) {
				matchHistory = matchHistory.filter((m) => m.matchId !== match.matchId);
				totalMatches--;
			}
		} finally {
			deletingMatch = null;
		}
	}

	// --- Player editing ---
	async function updateMatchPlayer(matchId: string, characterName: string, updates: Record<string, unknown>) {
		try {
			await fetch('/api/match/ratings', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					matchId,
					ratings: [{ characterName, ...updates }]
				})
			});
		} catch { /* non-critical */ }
	}

	function findPlayer(matchId: string, characterName: string): { matchIdx: number; playerIdx: number } | null {
		const matchIdx = matchHistory.findIndex(m => m.matchId === matchId);
		if (matchIdx < 0) return null;
		const playerIdx = matchHistory[matchIdx].players.findIndex(p => p.characterName === characterName);
		if (playerIdx < 0) return null;
		return { matchIdx, playerIdx };
	}

	async function startNameEdit(matchId: string, characterName: string) {
		editingName = { matchId, characterName };
		await tick();
		const input = document.getElementById(`name-edit-${matchId}-${characterName}`) as HTMLInputElement;
		input?.select();
	}

	function commitNameEdit(matchId: string, oldName: string, newName: string) {
		const trimmed = newName.trim();
		if (!trimmed || trimmed === oldName) { editingName = null; return; }

		const loc = findPlayer(matchId, oldName);
		if (loc) {
			matchHistory[loc.matchIdx].players[loc.playerIdx] = {
				...matchHistory[loc.matchIdx].players[loc.playerIdx],
				characterName: trimmed
			};
		}
		updateMatchPlayer(matchId, oldName, { newCharacterName: trimmed });
		editingName = null;
	}

	function handleNameKeydown(e: KeyboardEvent, matchId: string, oldName: string) {
		if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
		else if (e.key === 'Escape') editingName = null;
	}

	function openSpecPicker(matchId: string, p: MatchPlayer) {
		if (specPickerOpen?.matchId === matchId && specPickerOpen?.characterName === p.characterName) {
			specPickerOpen = null;
			pickerProfession = null;
		} else {
			specPickerOpen = { matchId, characterName: p.characterName };
			pickerProfession = p.profession;
		}
	}

	function selectSpec(matchId: string, characterName: string, profId: string, specId: string) {
		const loc = findPlayer(matchId, characterName);
		if (loc) {
			matchHistory[loc.matchIdx].players[loc.playerIdx] = {
				...matchHistory[loc.matchIdx].players[loc.playerIdx],
				profession: profId,
				spec: specId
			};
		}
		updateMatchPlayer(matchId, characterName, { profession: profId, spec: specId });
		specPickerOpen = null;
		pickerProfession = null;
	}

	function setPlayerRating(matchId: string, characterName: string, type: 'ratingSkill' | 'ratingFriendly', value: number) {
		const loc = findPlayer(matchId, characterName);
		if (!loc) return;
		const p = matchHistory[loc.matchIdx].players[loc.playerIdx];
		const current = p[type];
		const newVal = current === value ? null : value;
		matchHistory[loc.matchIdx].players[loc.playerIdx] = { ...p, [type]: newVal };
		updateMatchPlayer(matchId, characterName, { [type]: newVal });
	}

	function toggleTag(matchId: string, characterName: string, tag: 'friend' | 'avoid') {
		const loc = findPlayer(matchId, characterName);
		if (!loc) return;
		const p = matchHistory[loc.matchIdx].players[loc.playerIdx];
		const newTag = p.tag === tag ? null : tag;

		// Update all matches for this player
		for (let mi = 0; mi < matchHistory.length; mi++) {
			for (let pi = 0; pi < matchHistory[mi].players.length; pi++) {
				if (matchHistory[mi].players[pi].characterName === characterName) {
					matchHistory[mi].players[pi] = { ...matchHistory[mi].players[pi], tag: newTag };
				}
			}
		}
		updateMatchPlayer(matchId, characterName, { tag: newTag });
	}

	// Close spec picker on click outside
	function handleWindowClick(e: MouseEvent) {
		if (specPickerOpen) {
			const target = e.target as HTMLElement;
			if (!target.closest('.history-spec-picker') && !target.closest('.history-spec-icon-btn')) {
				specPickerOpen = null;
				pickerProfession = null;
			}
		}
	}

	// Stats (computed from total counts — for current page we show page-local stats)
	let wins = $derived(matchHistory.filter((m) => m.result === 'win').length);
	let losses = $derived(matchHistory.filter((m) => m.result === 'loss').length);
	let winRate = $derived(wins + losses > 0 ? Math.round((wins / (wins + losses)) * 100) : 0);
</script>

<svelte:window
	onclick={handleWindowClick}
	onkeydown={(e) => {
		if (e.key === 'Escape') {
			zoomedScreenshot = null;
			editingMap = null;
			editingName = null;
			if (specPickerOpen) { specPickerOpen = null; pickerProfession = null; }
		}
	}}
/>

{#snippet playerRowWithAdvice(p: MatchPlayer, match: MatchRecord, side: 'my' | 'enemy', playerIdx: number, advice: ParsedAdvice | null, nameFrags: Set<string>)}
	{@const isEditingName = editingName?.matchId === match.matchId && editingName?.characterName === p.characterName}
	{@const isPickerOpen = specPickerOpen?.matchId === match.matchId && specPickerOpen?.characterName === p.characterName}
	{@const selectedProf = pickerProfession || p.profession}
	{@const eAdvice = side === 'enemy' ? getEnemyAdviceForIdx(advice, playerIdx) : null}
	{@const aAdvice = side === 'my' ? getAllyAdviceForIdx(advice, playerIdx) : null}
	<div class="group relative rounded-lg border-l-3 px-3 py-2
		{p.isUser ? 'border-l-(--color-amber)/30' : ''}"
		style="{!p.isUser ? `border-left-color: ${getProfessionColor(p.profession)};` : ''} background-color: color-mix(in srgb, {getProfessionColor(p.profession)} 6%, transparent);"
	>
		<div class="flex items-center gap-2.5">
			<!-- Spec icon (clickable to change) -->
			<button
				class="history-spec-icon-btn relative flex-shrink-0 cursor-pointer rounded-md p-0.5 transition-all hover:bg-(--color-surface-hover) hover:ring-1 hover:ring-(--color-accent)/30"
				onclick={() => openSpecPicker(match.matchId, p)}
				title="Click to change spec"
			>
				<span
					class="inline-block h-8 w-8"
					style={specIconStyle(p.spec, p.profession)}
					title={getSpecLabel(p.profession, p.spec)}
				></span>
			</button>

			<div class="min-w-0 flex-1">
				<!-- Line 1: Name + threat badge -->
				<div class="flex items-center gap-2">
					{#if isEditingName}
						<input
							id="name-edit-{match.matchId}-{p.characterName}"
							type="text"
							value={p.characterName}
							class="w-48 rounded bg-(--color-bg) px-2 py-0.5 font-mono text-sm text-(--color-text) border border-(--color-accent) outline-none"
							onblur={(e) => commitNameEdit(match.matchId, p.characterName, (e.currentTarget as HTMLInputElement).value)}
							onkeydown={(e) => handleNameKeydown(e, match.matchId, p.characterName)}
						/>
					{:else}
						<button
							class="truncate font-mono text-sm font-bold cursor-pointer transition-colors"
							style="color: {getProfessionColor(p.profession)};"
							onclick={() => startNameEdit(match.matchId, p.characterName)}
							title="Click to edit name"
						>
							{p.characterName}
						</button>
					{/if}
					{#if p.isUser}
						<span class="shrink-0 text-[10px] font-medium text-(--color-amber)/70">you</span>
					{/if}
					<!-- Threat badge inline (enemy only) -->
					{#if eAdvice?.threat}
						<span class="ml-auto shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider {getThreatColor(eAdvice.threat)}">
							{eAdvice.threat}
						</span>
					{/if}
				</div>
				<!-- Line 2: Spec label + role -->
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
									onclick={() => setPlayerRating(match.matchId, p.characterName, 'ratingSkill', star)}
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
									onclick={() => setPlayerRating(match.matchId, p.characterName, 'ratingFriendly', star)}
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
							onclick={() => toggleTag(match.matchId, p.characterName, 'friend')}
						>Friend</button>
						<button
							class="flex-1 rounded-full px-1.5 text-[8px] font-bold uppercase tracking-wider cursor-pointer transition-colors border leading-none text-center
								{p.tag === 'avoid'
									? 'text-(--color-red) bg-(--color-red)/15 border-(--color-red)/30'
									: 'text-(--color-text-tertiary)/30 border-transparent hover:text-(--color-red)/60 hover:border-(--color-red)/20'}"
							onclick={() => toggleTag(match.matchId, p.characterName, 'avoid')}
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

		<!-- Spec picker popup -->
		{#if isPickerOpen}
			{@const profList = Object.entries(specs.professions)}
			{@const profSpecs = getSpecsForProfession(selectedProf)}
			<div class="history-spec-picker absolute left-0 top-full z-30 mt-1 rounded-xl border border-(--color-border-strong) bg-(--color-surface-raised) p-3 shadow-lg min-w-64 animate-slide-up">
				<div class="flex flex-wrap gap-1 mb-2 pb-2 border-b border-(--color-border)/50">
					{#each profList as [profId, prof]}
						<button
							class="rounded-md px-1.5 py-1 transition-all cursor-pointer
								{profId === selectedProf
									? 'bg-(--color-accent)/15 ring-1 ring-(--color-accent)/50'
									: 'hover:bg-(--color-surface-hover)'}"
							onclick={() => (pickerProfession = profId)}
							title={prof.label}
						>
							<span class="inline-block h-6 w-6" style={specIconStyle(profId, profId)} title={prof.label}></span>
						</button>
					{/each}
				</div>
				<p class="mb-2 text-[10px] font-bold uppercase tracking-wider text-(--color-text-tertiary)">
					{getProfessionLabel(selectedProf)}
				</p>
				<div class="flex flex-wrap gap-2">
					{#each profSpecs as spec}
						<button
							class="flex flex-col items-center gap-1 rounded-lg p-2 transition-all cursor-pointer
								{spec.id === p.spec && selectedProf === p.profession
									? 'bg-(--color-accent)/15 ring-1 ring-(--color-accent)/50'
									: 'hover:bg-(--color-surface-hover)'}"
							onclick={() => selectSpec(match.matchId, p.characterName, selectedProf, spec.id)}
						>
							<span
								class="inline-block h-10 w-10"
								style={specIconStyle(spec.id === 'core' ? selectedProf : spec.id, selectedProf)}
								title={spec.label}
							></span>
							<span class="text-[10px] text-(--color-text-secondary) max-w-16 text-center leading-tight">
								{spec.id === 'core' ? 'Core' : spec.label}
							</span>
						</button>
					{/each}
				</div>
			</div>
		{/if}
	</div>
{/snippet}

<div>
	<!-- Stats bar -->
	{#if !loading && totalMatches > 0}
		<div class="mb-5 flex items-center gap-4 rounded-xl border border-(--color-border) bg-(--color-surface) px-5 py-3">
			<div class="flex items-center gap-2">
				<span class="text-2xl font-bold text-(--color-text)">{totalMatches}</span>
				<span class="text-xs text-(--color-text-tertiary)">matches</span>
			</div>
			<div class="h-6 w-px bg-(--color-border)"></div>
			<div class="flex items-center gap-3">
				<span class="text-sm font-mono">
					<span class="text-(--color-green)">{wins}W</span>
					<span class="text-(--color-text-tertiary) mx-0.5">/</span>
					<span class="text-(--color-red)">{losses}L</span>
				</span>
				{#if wins + losses > 0}
					<span class="rounded-full px-2 py-0.5 text-[10px] font-bold
						{winRate >= 55 ? 'text-(--color-green) bg-(--color-green)/10' :
						 winRate >= 45 ? 'text-(--color-amber) bg-(--color-amber)/10' :
						 'text-(--color-red) bg-(--color-red)/10'}">
						{winRate}%
					</span>
				{/if}
			</div>
			{#if totalPages > 1}
				<div class="ml-auto flex items-center gap-1 text-xs text-(--color-text-tertiary)">
					<span>Page {currentPage + 1}/{totalPages}</span>
				</div>
			{/if}
		</div>
	{/if}

	<!-- Loading -->
	{#if loading}
		<div class="flex items-center justify-center py-20">
			<span class="inline-block h-5 w-5 animate-spin rounded-full border-2 border-(--color-accent) border-t-transparent"></span>
		</div>
	{:else if error}
		<div class="flex flex-col items-center justify-center py-20 text-(--color-text-tertiary)">
			<p class="text-base text-(--color-red)">{error}</p>
			<button
				class="mt-3 rounded-lg px-4 py-2 text-sm text-(--color-accent) border border-(--color-accent)/30 hover:bg-(--color-accent)/10 transition-colors cursor-pointer"
				onclick={() => loadPage(currentPage)}
			>
				Retry
			</button>
		</div>
	{:else if matchHistory.length === 0}
		<div class="flex flex-col items-center justify-center py-20 text-(--color-text-tertiary)">
			<p class="text-base">No matches yet</p>
			<p class="text-sm mt-1">Paste a screenshot to start tracking</p>
		</div>
	{:else}
		<!-- Match list -->
		<div class="flex flex-col gap-2">
			{#each matchHistory as match}
				{@const { redTeam, blueTeam } = getTeams(match)}
				{@const { myTeam, enemyTeam } = getEnemyAllyTeams(match)}
				{@const advice = parseAdvice(match)}
				{@const nameFrags = buildNameFragments(match)}
				{@const mapMode = getMapMode(match.map)}
				{@const userPlayer = match.players.find(p => p.isUser)}
				<details class="match-card rounded-xl border border-(--color-border) bg-(--color-surface) overflow-hidden transition-all">
					<!-- Match summary row -->
					<summary
						class="w-full flex items-center gap-2.5 px-4 py-3 cursor-pointer transition-colors text-left
							{match.result === 'win'
								? 'bg-(--color-green)/8 hover:bg-(--color-green)/12'
								: match.result === 'loss'
									? 'bg-(--color-red)/8 hover:bg-(--color-red)/12'
									: 'hover:bg-(--color-surface-hover)'}"
					>
						<!-- Result badge -->
						<div class="flex-shrink-0 w-11">
							{#if match.result === 'win'}
								<span class="text-sm font-bold text-(--color-green)">WIN</span>
							{:else if match.result === 'loss'}
								<span class="text-sm font-bold text-(--color-red)">LOSS</span>
							{:else}
								<span class="text-xs text-(--color-text-tertiary)">---</span>
							{/if}
						</div>

						<!-- Map name (fixed width for alignment) -->
						<span class="text-sm text-(--color-text) flex-shrink-0 w-48 truncate" title={getMapName(match.map)}>
							{getMapName(match.map)}
						</span>

						<!-- User's profession icon -->
						{#if userPlayer}
							<span
								class="inline-block h-5 w-5 flex-shrink-0"
								style={specIconStyle(userPlayer.spec, userPlayer.profession)}
								title={getSpecLabel(userPlayer.profession, userPlayer.spec)}
							></span>
						{:else}
							<span class="inline-block h-5 w-5 flex-shrink-0"></span>
						{/if}

						<!-- vs label -->
						<span class="flex-shrink-0 text-[10px] text-(--color-text-tertiary)">vs</span>

						<!-- Enemy team specs -->
						<div class="flex items-center gap-1 flex-1 min-w-0">
							{#each enemyTeam as p}
								<span
									class="inline-block h-5 w-5 flex-shrink-0"
									style={specIconStyle(p.spec, p.profession)}
									title={`${p.characterName} — ${getSpecLabel(p.profession, p.spec)}`}
								></span>
							{/each}
						</div>

						<!-- Mode badge (right-aligned, fixed width) -->
						<div class="flex-shrink-0 w-20 flex justify-end">
							{#if mapMode}
								<span class="rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider {getModeColor(mapMode)}">
									{mapMode}
								</span>
							{/if}
						</div>

						<!-- Timestamp (right-aligned, fixed width) -->
						<span class="text-xs text-(--color-text-tertiary) flex-shrink-0 w-14 text-right">
							{formatTime(match.timestamp)}
						</span>

						<!-- Expand chevron -->
						<span class="chevron text-(--color-text-tertiary) text-xs flex-shrink-0 transition-transform">
							&#9660;
						</span>
					</summary>

					<!-- Expanded detail -->
					<div class="border-t border-(--color-border) px-4 py-4">
						<!-- Header bar: screenshot + result/map controls -->
						<div class="mb-4 flex items-center gap-4 rounded-xl border border-(--color-border) bg-(--color-bg) p-3">
							{#if match.screenshotUrl}
								<button
									class="shrink-0 cursor-pointer rounded-lg overflow-hidden border border-(--color-border) hover:border-(--color-accent)/50 transition-colors w-32"
									onclick={() => (zoomedScreenshot = match.screenshotUrl)}
								>
									<img src={match.screenshotUrl} alt="Match screenshot" class="w-full h-auto" />
								</button>
							{/if}
							<div class="flex-1 min-w-0">
								<div class="flex items-center gap-2 mb-1.5">
									<span class="text-[10px] font-bold uppercase tracking-wider text-(--color-text-tertiary)">Result</span>
									<button
										class="rounded-lg px-3 py-1 text-xs font-bold transition-colors cursor-pointer
											{match.result === 'win'
												? 'bg-(--color-green) text-white'
												: 'border border-(--color-green)/30 text-(--color-green) hover:bg-(--color-green)/10'}"
										disabled={updatingResult === match.matchId}
										onclick={(e) => { e.stopPropagation(); setResult(match, match.result === 'win' ? null : 'win'); }}
									>Win</button>
									<button
										class="rounded-lg px-3 py-1 text-xs font-bold transition-colors cursor-pointer
											{match.result === 'loss'
												? 'bg-(--color-red) text-white'
												: 'border border-(--color-red)/30 text-(--color-red) hover:bg-(--color-red)/10'}"
										disabled={updatingResult === match.matchId}
										onclick={(e) => { e.stopPropagation(); setResult(match, match.result === 'loss' ? null : 'loss'); }}
									>Loss</button>
								</div>
								<div class="flex items-center gap-2">
									<span class="text-[10px] font-bold uppercase tracking-wider text-(--color-text-tertiary)">Map</span>
									{#if editingMap === match.matchId}
										<select
											class="rounded-lg bg-(--color-surface) border border-(--color-border) px-2 py-1 text-xs text-(--color-text) outline-none"
											value={match.map ?? ''}
											onchange={(e) => setMap(match, (e.currentTarget as HTMLSelectElement).value)}
											onblur={() => (editingMap = null)}
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
											class="text-xs text-(--color-text-secondary) hover:text-(--color-accent) transition-colors cursor-pointer border-b border-dashed border-(--color-text-tertiary)/40 hover:border-(--color-accent)"
											onclick={(e) => { e.stopPropagation(); editingMap = match.matchId; }}
											title="Click to change map"
										>
											{getMapName(match.map)}
										</button>
									{/if}
								</div>
							</div>
							<button
								class="shrink-0 rounded-lg px-3 py-1.5 text-[10px] text-(--color-text-tertiary) hover:text-(--color-red) hover:bg-(--color-red)/10 transition-colors cursor-pointer"
								disabled={deletingMatch === match.matchId}
								onclick={(e) => { e.stopPropagation(); deleteMatch(match); }}
							>
								{deletingMatch === match.matchId ? 'Deleting...' : 'Delete'}
							</button>
						</div>

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
							<!-- Red team -->
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
										{@render playerRowWithAdvice(p, match, side, pIdx >= 0 ? pIdx : i, advice, nameFrags)}
									{/each}
								</div>
							</div>

							<!-- Blue team -->
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
										{@render playerRowWithAdvice(p, match, side, pIdx >= 0 ? pIdx : i, advice, nameFrags)}
									{/each}
								</div>
							</div>
						</div>
					</div>
				</details>
			{/each}
		</div>

		<!-- Pagination -->
		{#if totalPages > 1}
			<div class="mt-5 flex items-center justify-center gap-2">
				<button
					class="rounded-lg px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer
						{currentPage > 0
							? 'text-(--color-accent) hover:bg-(--color-accent)/10'
							: 'text-(--color-text-tertiary)/30 cursor-default'}"
					disabled={currentPage === 0 || loadingMore}
					onclick={() => loadPage(currentPage - 1)}
				>Prev</button>
				{#each Array(totalPages) as _, i}
					{#if totalPages <= 7 || i === 0 || i === totalPages - 1 || Math.abs(i - currentPage) <= 1}
						<button
							class="rounded-lg px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer
								{i === currentPage
									? 'bg-(--color-accent)/15 text-(--color-accent) ring-1 ring-(--color-accent)/30'
									: 'text-(--color-text-secondary) hover:bg-(--color-surface-hover)'}"
							disabled={loadingMore}
							onclick={() => loadPage(i)}
						>{i + 1}</button>
					{:else if i === 1 && currentPage > 3}
						<span class="text-xs text-(--color-text-tertiary)">...</span>
					{:else if i === totalPages - 2 && currentPage < totalPages - 4}
						<span class="text-xs text-(--color-text-tertiary)">...</span>
					{/if}
				{/each}
				<button
					class="rounded-lg px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer
						{currentPage < totalPages - 1
							? 'text-(--color-accent) hover:bg-(--color-accent)/10'
							: 'text-(--color-text-tertiary)/30 cursor-default'}"
					disabled={currentPage >= totalPages - 1 || loadingMore}
					onclick={() => loadPage(currentPage + 1)}
				>Next</button>
				{#if loadingMore}
					<span class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-(--color-accent) border-t-transparent ml-2"></span>
				{/if}
			</div>
		{/if}
	{/if}
</div>

<!-- Screenshot zoom modal -->
{#if zoomedScreenshot}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm cursor-pointer animate-fade-in"
		onclick={() => (zoomedScreenshot = null)}
		role="dialog"
		tabindex="-1"
	>
		<img
			src={zoomedScreenshot}
			alt="Match screenshot (zoomed)"
			class="max-w-[95vw] max-h-[95vh] object-contain rounded-lg shadow-2xl animate-modal-in"
		/>
	</div>
{/if}
