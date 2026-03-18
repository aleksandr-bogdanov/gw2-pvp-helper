<script lang="ts">
	import { onMount } from 'svelte';
	import { getSpecLabel, getProfessionLabel, getSpecsForProfession, getProfessionColor, specs } from '$lib/game-data.js';

	interface PlayerRecord {
		characterName: string;
		nickname: string | null;
		comment: string | null;
		profession: string | null;
		spec: string | null;
		role: string | null;
		specSource: string | null;
		timesSeen: number;
		winsAgainst: number;
		lossesAgainst: number;
		lastSeenAt: string | null;
		tag: string | null;
		avgSkill: number | null;
		avgFriendly: number | null;
	}

	let playerList = $state<PlayerRecord[]>([]);
	let loading = $state(true);
	let editingRole = $state<string | null>(null);
	let editingComment = $state<string | null>(null);
	let ratingPopup = $state<{ player: string; field: 'skill' | 'vibe'; x: number; y: number } | null>(null);
	let searchQuery = $state('');
	let sortField = $state<string>('lastSeenAt');
	let sortDir = $state<'asc' | 'desc'>('desc');

	function toggleSort(field: string) {
		if (sortField === field) {
			sortDir = sortDir === 'asc' ? 'desc' : 'asc';
		} else {
			sortField = field;
			sortDir = field === 'characterName' ? 'asc' : 'desc';
		}
	}

	function sortArrow(field: string): string {
		if (sortField !== field) return '';
		return sortDir === 'asc' ? ' \u25B2' : ' \u25BC';
	}

	let filtered = $derived.by(() => {
		let list = searchQuery.trim()
			? playerList.filter((p) => {
					const q = searchQuery.toLowerCase();
					return (
						p.characterName.toLowerCase().includes(q) ||
						(p.nickname?.toLowerCase().includes(q)) ||
						(p.comment?.toLowerCase().includes(q)) ||
						(p.profession?.toLowerCase().includes(q)) ||
						(p.spec?.toLowerCase().includes(q)) ||
						(p.tag?.toLowerCase().includes(q))
					);
				})
			: [...playerList];

		list.sort((a, b) => {
			let cmp = 0;
			switch (sortField) {
				case 'characterName':
					cmp = a.characterName.localeCompare(b.characterName);
					break;
				case 'profession':
					cmp = (a.profession ?? '').localeCompare(b.profession ?? '');
					break;
				case 'timesSeen':
					cmp = a.timesSeen - b.timesSeen;
					break;
				case 'wl': {
					const aRate = (a.winsAgainst + a.lossesAgainst) > 0 ? a.winsAgainst / (a.winsAgainst + a.lossesAgainst) : -1;
					const bRate = (b.winsAgainst + b.lossesAgainst) > 0 ? b.winsAgainst / (b.winsAgainst + b.lossesAgainst) : -1;
					cmp = aRate - bRate;
					break;
				}
				case 'lastSeenAt': {
					const aTime = a.lastSeenAt ? new Date(a.lastSeenAt).getTime() : 0;
					const bTime = b.lastSeenAt ? new Date(b.lastSeenAt).getTime() : 0;
					cmp = aTime - bTime;
					break;
				}
				case 'role':
					cmp = (a.role ?? '').localeCompare(b.role ?? '');
					break;
				case 'tag': {
					const tagOrder: Record<string, number> = { friend: 2, avoid: 1 };
					cmp = (tagOrder[a.tag ?? ''] ?? 0) - (tagOrder[b.tag ?? ''] ?? 0);
					break;
				}
				case 'comment':
					cmp = (a.comment ?? '').localeCompare(b.comment ?? '');
					break;
				case 'avgSkill':
					cmp = (a.avgSkill ?? 0) - (b.avgSkill ?? 0);
					break;
				case 'avgFriendly':
					cmp = (a.avgFriendly ?? 0) - (b.avgFriendly ?? 0);
					break;
				default:
					cmp = 0;
			}
			return sortDir === 'asc' ? cmp : -cmp;
		});

		return list;
	});

	onMount(async () => {
		try {
			const res = await fetch('/api/players?limit=500');
			if (res.ok) {
				playerList = await res.json();
			}
		} finally {
			loading = false;
		}
	});

	function getSpecIconUrl(specId: string | null, professionId?: string | null): string {
		if (!specId || !professionId) return '/icons/specs/unknown.png';
		const id = specId === 'core' ? professionId : specId;
		return `/icons/specs/${id}.png`;
	}

	function specIconStyle(specId: string | null, professionId: string | null): string {
		const url = getSpecIconUrl(specId, professionId);
		const color = professionId ? getProfessionColor(professionId) : '#888';
		return `background-color: ${color}; -webkit-mask-image: url(${url}); mask-image: url(${url}); -webkit-mask-size: contain; mask-size: contain; -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;`;
	}

	function formatLastSeen(ts: string | null): string {
		if (!ts) return 'Never';
		const d = new Date(ts);
		const now = new Date();
		const diff = now.getTime() - d.getTime();
		const hours = Math.floor(diff / 3600000);
		const days = Math.floor(diff / 86400000);

		if (hours < 1) return 'Just now';
		if (hours < 24) return `${hours}h ago`;
		if (days < 7) return `${days}d ago`;
		return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
	}

	function getSpecShortLabel(profession: string | null, spec: string | null): string {
		if (!profession || !spec) return '—';
		if (spec === 'core') return 'Core';
		const label = getSpecLabel(profession, spec);
		// getSpecLabel returns "Profession · Spec" format, just get spec part
		const parts = label.split(' · ');
		return parts.length > 1 ? parts[parts.length - 1] : label;
	}

	async function saveRole(player: PlayerRecord, role: string) {
		const res = await fetch('/api/players', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ characterName: player.characterName, role })
		});
		if (res.ok) {
			const idx = playerList.findIndex((p) => p.characterName === player.characterName);
			if (idx >= 0) playerList[idx] = { ...playerList[idx], role };
		}
		editingRole = null;
	}

	function getRoleOptions(player: PlayerRecord): string[] {
		if (!player.profession || !player.spec) return ['dps', 'support', 'roamer', 'duelist'];
		const specInfo = getSpecsForProfession(player.profession).find((s) => s.id === player.spec);
		if (specInfo?.roles && specInfo.roles.length > 0) return specInfo.roles;
		return ['dps', 'support', 'roamer', 'duelist'];
	}

	async function saveComment(player: PlayerRecord, value: string) {
		const comment = value.trim() || null;
		const res = await fetch('/api/players', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ characterName: player.characterName, comment })
		});
		if (res.ok) {
			const idx = playerList.findIndex((p) => p.characterName === player.characterName);
			if (idx >= 0) playerList[idx] = { ...playerList[idx], comment };
		}
		editingComment = null;
	}

	async function toggleTag(player: PlayerRecord, tag: string | null) {
		const newTag = player.tag === tag ? null : tag;
		const res = await fetch('/api/players', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ characterName: player.characterName, tag: newTag })
		});
		if (res.ok) {
			const idx = playerList.findIndex((p) => p.characterName === player.characterName);
			if (idx >= 0) playerList[idx] = { ...playerList[idx], tag: newTag };
		}
	}

	function openRatingPopup(e: MouseEvent, player: PlayerRecord, field: 'skill' | 'vibe') {
		e.stopPropagation();
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		ratingPopup = { player: player.characterName, field, x: rect.left + rect.width / 2, y: rect.bottom + 4 };
	}

	async function saveRating(player: PlayerRecord, field: 'skill' | 'vibe', value: number | null) {
		const body: Record<string, unknown> = { characterName: player.characterName };
		if (field === 'skill') body.ratingSkill = value;
		else body.ratingFriendly = value;

		const res = await fetch('/api/players', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});
		if (res.ok) {
			const idx = playerList.findIndex((p) => p.characterName === player.characterName);
			if (idx >= 0) {
				if (field === 'skill') playerList[idx] = { ...playerList[idx], avgSkill: value };
				else playerList[idx] = { ...playerList[idx], avgFriendly: value };
			}
		}
		ratingPopup = null;
	}

	async function deletePlayer(player: PlayerRecord) {
		const res = await fetch('/api/players', {
			method: 'DELETE',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ characterName: player.characterName })
		});
		if (res.ok) {
			playerList = playerList.filter((p) => p.characterName !== player.characterName);
		}
	}

</script>

<svelte:window
	onkeydown={(e) => { if (e.key === 'Escape') { editingRole = null; editingComment = null; ratingPopup = null; } }}
	onclick={() => { ratingPopup = null; }}
/>

<div>
	<!-- Search -->
	<div class="mb-4">
		<input
			type="text"
			placeholder="Search by name, profession, tag..."
			bind:value={searchQuery}
			class="w-full rounded-xl border border-(--color-border) bg-(--color-surface) px-4 py-2.5 text-sm text-(--color-text) placeholder:text-(--color-text-tertiary) focus:border-(--color-accent) focus:outline-none"
		/>
	</div>

	<!-- Stats -->
	{#if !loading && playerList.length > 0}
		<div class="mb-4 text-xs text-(--color-text-tertiary)">
			{filtered.length} of {playerList.length} players
		</div>
	{/if}

	<!-- Loading -->
	{#if loading}
		<div class="flex items-center justify-center py-20">
			<span class="inline-block h-5 w-5 animate-spin rounded-full border-2 border-(--color-accent) border-t-transparent"></span>
		</div>
	{:else if playerList.length === 0}
		<div class="flex flex-col items-center justify-center py-20 text-(--color-text-tertiary)">
			<p class="text-base">No players tracked yet</p>
			<p class="text-sm mt-1">Players appear here after scanning matches</p>
		</div>
	{:else}
		<!-- Player table -->
		<div class="rounded-xl border border-(--color-border) bg-(--color-surface) overflow-x-auto">
			<table class="w-full text-sm" style="min-width: 1000px;">
				<thead>
					<tr class="border-b border-(--color-border) text-[10px] font-bold uppercase tracking-wider text-(--color-text-tertiary)">
						<th class="px-3 py-2.5 text-left">
							<button class="cursor-pointer hover:text-(--color-text-secondary) transition-colors font-bold uppercase tracking-wider" onclick={() => toggleSort('characterName')}>
								Player{sortArrow('characterName')}
							</button>
						</th>
						<th class="px-2 py-2.5 text-left">
							<button class="cursor-pointer hover:text-(--color-text-secondary) transition-colors font-bold uppercase tracking-wider" onclick={() => toggleSort('profession')}>
								Profession{sortArrow('profession')}
							</button>
						</th>
						<th class="px-2 py-2.5 text-left">
							<button class="cursor-pointer hover:text-(--color-text-secondary) transition-colors font-bold uppercase tracking-wider" onclick={() => toggleSort('spec')}>
								Spec{sortArrow('spec')}
							</button>
						</th>
						<th class="px-2 py-2.5 text-left">
							<button class="cursor-pointer hover:text-(--color-text-secondary) transition-colors font-bold uppercase tracking-wider" onclick={() => toggleSort('role')}>
								Role{sortArrow('role')}
							</button>
						</th>
						<th class="px-2 py-2.5 text-center">
							<button class="cursor-pointer hover:text-(--color-text-secondary) transition-colors font-bold uppercase tracking-wider" onclick={() => toggleSort('timesSeen')}>
								Seen{sortArrow('timesSeen')}
							</button>
						</th>
						<th class="px-2 py-2.5 text-center">
							<button class="cursor-pointer hover:text-(--color-text-secondary) transition-colors font-bold uppercase tracking-wider" onclick={() => toggleSort('wl')}>
								W/L{sortArrow('wl')}
							</button>
						</th>
						<th class="px-2 py-2.5 text-center">
							<button class="cursor-pointer hover:text-(--color-text-secondary) transition-colors font-bold uppercase tracking-wider" onclick={() => toggleSort('tag')}>
								Tag{sortArrow('tag')}
							</button>
						</th>
						<th class="px-2 py-2.5 text-center">
							<button class="cursor-pointer hover:text-(--color-text-secondary) transition-colors font-bold uppercase tracking-wider" onclick={() => toggleSort('avgSkill')}>
								Skill{sortArrow('avgSkill')}
							</button>
						</th>
						<th class="px-2 py-2.5 text-center">
							<button class="cursor-pointer hover:text-(--color-text-secondary) transition-colors font-bold uppercase tracking-wider" onclick={() => toggleSort('avgFriendly')}>
								Vibe{sortArrow('avgFriendly')}
							</button>
						</th>
						<th class="px-2 py-2.5 text-right">
							<button class="cursor-pointer hover:text-(--color-text-secondary) transition-colors font-bold uppercase tracking-wider" onclick={() => toggleSort('lastSeenAt')}>
								Last{sortArrow('lastSeenAt')}
							</button>
						</th>
						<th class="px-2 py-2.5 text-left">
							<button class="cursor-pointer hover:text-(--color-text-secondary) transition-colors font-bold uppercase tracking-wider" onclick={() => toggleSort('comment')}>
								Comment{sortArrow('comment')}
							</button>
						</th>
						<th class="px-2 py-2.5 w-6"></th>
					</tr>
				</thead>
				<tbody>
					{#each filtered as player}
						{@const profColor = player.profession ? getProfessionColor(player.profession) : '#888'}
						<tr
							class="group border-b border-(--color-border)/50 hover:bg-(--color-surface-hover) transition-colors align-top"
							style="border-left: 3px solid {profColor}; background-color: color-mix(in srgb, {profColor} 4%, transparent);"
						>
							<!-- Player: colored icon + bold name -->
							<td class="px-3 py-2">
								<div class="flex items-center gap-2">
									<span
										class="inline-block h-6 w-6 flex-shrink-0"
										style={specIconStyle(player.spec, player.profession)}
										title={player.spec ? getSpecShortLabel(player.profession, player.spec) : ''}
									></span>
									<span class="font-mono text-sm font-bold truncate max-w-40" style="color: {profColor};">{player.characterName}</span>
								</div>
							</td>

							<!-- Profession -->
							<td class="px-2 py-2 whitespace-nowrap">
								<span class="text-xs" style="color: {profColor}; opacity: 0.7;">
									{player.profession ? getProfessionLabel(player.profession) : '—'}
								</span>
							</td>

							<!-- Spec -->
							<td class="px-2 py-2 whitespace-nowrap">
								<span class="text-xs" style="color: {profColor}; opacity: 0.7;">
									{getSpecShortLabel(player.profession, player.spec)}
								</span>
							</td>

							<!-- Role (editable) -->
							<td class="px-2 py-2">
								{#if editingRole === player.characterName}
									<div class="flex gap-1 flex-wrap">
										{#each getRoleOptions(player) as role}
											<button
												class="rounded px-1.5 py-0.5 text-[10px] font-medium cursor-pointer transition-colors
													{player.role === role
														? 'bg-(--color-accent)/15 text-(--color-accent) ring-1 ring-(--color-accent)/50'
														: 'bg-(--color-bg) text-(--color-text-secondary) hover:bg-(--color-surface-hover)'}"
												onclick={() => saveRole(player, role)}
											>
												{role}
											</button>
										{/each}
									</div>
								{:else}
									<button
										class="text-xs text-(--color-text-secondary) hover:text-(--color-accent) cursor-pointer transition-colors"
										onclick={() => (editingRole = player.characterName)}
										title="Click to change role"
									>
										{player.role || '—'}
									</button>
								{/if}
							</td>

							<!-- Times seen -->
							<td class="px-2 py-2 text-center">
								<span class="text-xs font-mono text-(--color-text-tertiary)">{player.timesSeen}</span>
							</td>

							<!-- W/L -->
							<td class="px-2 py-2 text-center whitespace-nowrap">
								{#if player.winsAgainst > 0 || player.lossesAgainst > 0}
									<span class="text-xs font-mono">
										<span class="text-(--color-green)">{player.winsAgainst}W</span>
										<span class="text-(--color-text-tertiary)">/</span>
										<span class="text-(--color-red)">{player.lossesAgainst}L</span>
									</span>
								{:else}
									<span class="text-xs text-(--color-text-tertiary)">—</span>
								{/if}
							</td>

							<!-- Tag (friend/avoid) -->
							<td class="px-2 py-2 text-center">
								{#if player.tag === 'friend'}
									<button
										class="rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-(--color-green) bg-(--color-green)/15 border border-(--color-green)/30 cursor-pointer hover:bg-(--color-green)/25 transition-colors"
										onclick={() => toggleTag(player, 'friend')}
										title="Remove friend tag"
									>friend</button>
								{:else if player.tag === 'avoid'}
									<button
										class="rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-(--color-red) bg-(--color-red)/15 border border-(--color-red)/30 cursor-pointer hover:bg-(--color-red)/25 transition-colors"
										onclick={() => toggleTag(player, 'avoid')}
										title="Remove avoid tag"
									>avoid</button>
								{:else}
									<div class="flex justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
										<button
											class="rounded-full px-2 py-0.5 text-[9px] text-(--color-text-tertiary) hover:text-(--color-green) hover:bg-(--color-green)/10 cursor-pointer transition-colors"
											onclick={() => toggleTag(player, 'friend')}
											title="Tag as friend"
										>+F</button>
										<button
											class="rounded-full px-2 py-0.5 text-[9px] text-(--color-text-tertiary) hover:text-(--color-red) hover:bg-(--color-red)/10 cursor-pointer transition-colors"
											onclick={() => toggleTag(player, 'avoid')}
											title="Tag as avoid"
										>+A</button>
									</div>
								{/if}
							</td>

							<!-- Skill rating (clickable) -->
							<td class="px-2 py-2 text-center">
								<button
									class="cursor-pointer transition-colors hover:opacity-80"
									onclick={(e) => openRatingPopup(e, player, 'skill')}
									title="Click to rate skill"
								>
									{#if player.avgSkill}
										<span class="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-mono text-(--color-amber) bg-(--color-amber)/10 border border-(--color-amber)/20">
											&#9733; {player.avgSkill}
										</span>
									{:else}
										<span class="text-xs text-(--color-text-tertiary) hover:text-(--color-amber)">—</span>
									{/if}
								</button>
							</td>

							<!-- Vibe rating (clickable) -->
							<td class="px-2 py-2 text-center">
								<button
									class="cursor-pointer transition-colors hover:opacity-80"
									onclick={(e) => openRatingPopup(e, player, 'vibe')}
									title="Click to rate vibe"
								>
									{#if player.avgFriendly}
										<span class="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-mono text-(--color-green) bg-(--color-green)/10 border border-(--color-green)/20">
											&#9733; {player.avgFriendly}
										</span>
									{:else}
										<span class="text-xs text-(--color-text-tertiary) hover:text-(--color-green)">—</span>
									{/if}
								</button>
							</td>

							<!-- Last seen -->
							<td class="px-2 py-2 text-right whitespace-nowrap">
								<span class="text-xs text-(--color-text-tertiary)">{formatLastSeen(player.lastSeenAt)}</span>
							</td>

							<!-- Comment (editable) -->
							<td class="px-2 py-2 min-w-24">
								{#if editingComment === player.characterName}
									<textarea
										class="w-full rounded bg-(--color-bg) px-2 py-1 text-xs text-(--color-text) border border-(--color-accent) outline-none resize-none leading-relaxed"
										rows="2"
										onblur={(e) => saveComment(player, (e.currentTarget as HTMLTextAreaElement).value)}
										onkeydown={(e) => {
											if (e.key === 'Escape') editingComment = null;
										}}
										autofocus
									>{player.comment ?? ''}</textarea>
								{:else}
									<button
										class="text-left text-xs cursor-pointer transition-colors leading-relaxed w-full
											{player.comment ? 'text-(--color-text-secondary)' : 'text-(--color-text-tertiary)/50 hover:text-(--color-text-tertiary)'}"
										onclick={() => (editingComment = player.characterName)}
										title="Click to add comment"
									>
										{#if player.comment}
											<span class="line-clamp-2 whitespace-pre-line">{player.comment}</span>
										{:else}
											—
										{/if}
									</button>
								{/if}
							</td>

							<!-- Delete -->
							<td class="px-2 py-2">
								<button
									class="text-xs text-(--color-text-tertiary) hover:text-(--color-red) cursor-pointer transition-colors opacity-0 group-hover:opacity-100"
									onclick={() => deletePlayer(player)}
									title="Delete player"
								>
									&#10005;
								</button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>

<!-- Star rating popup -->
{#if ratingPopup}
	{@const player = playerList.find((p) => p.characterName === ratingPopup!.player)}
	{@const isSkill = ratingPopup.field === 'skill'}
	{@const currentVal = isSkill ? (player?.avgSkill ?? 0) : (player?.avgFriendly ?? 0)}
	{@const color = isSkill ? 'var(--color-amber)' : 'var(--color-green)'}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed z-50 rounded-lg border border-(--color-border) bg-(--color-surface) shadow-xl px-3 py-2.5 flex flex-col items-center gap-1.5"
		style="left: {ratingPopup.x}px; top: {ratingPopup.y}px; transform: translateX(-50%);"
		onclick={(e) => e.stopPropagation()}
	>
		<span class="text-[10px] font-bold uppercase tracking-wider text-(--color-text-tertiary)">
			{isSkill ? 'Skill' : 'Vibe'}
		</span>
		<div class="flex gap-1">
			{#each [1, 2, 3, 4, 5] as star}
				<button
					class="text-lg cursor-pointer transition-all hover:scale-125"
					style="color: {star <= Math.round(currentVal) ? color : 'var(--color-text-tertiary)'}; opacity: {star <= Math.round(currentVal) ? 1 : 0.3};"
					onclick={() => player && saveRating(player, ratingPopup!.field, star)}
					title="{star} star{star > 1 ? 's' : ''}"
				>
					&#9733;
				</button>
			{/each}
		</div>
		{#if currentVal > 0}
			<button
				class="text-[10px] text-(--color-text-tertiary) hover:text-(--color-red) cursor-pointer transition-colors"
				onclick={() => player && saveRating(player, ratingPopup!.field, null)}
			>
				Clear
			</button>
		{/if}
	</div>
{/if}
