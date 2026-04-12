<script lang="ts">
	import { onMount } from 'svelte';
	import { getSpecLabel } from '$lib/game-data.js';

	interface TrainingSample {
		id: number;
		userId: number | null;
		username: string | null;
		screenshotHash: string;
		screenshotUrl: string;
		resolution: string | null;
		uiSize: string | null;
		scanResult: any;
		userCorrections: any;
		confidenceScores: Array<{ slot?: number; spec_confidence?: number; name_confidence?: number }> | null;
		reviewedByAdmin: boolean;
		createdAt: string;
	}

	interface ResolutionStats {
		[resolution: string]: { total: number; corrected: number; avgConfidence: number };
	}

	let samples = $state<TrainingSample[]>([]);
	let stats = $state<ResolutionStats>({});
	let loading = $state(true);
	let sortBy = $state('date');
	let filterResolution = $state('');
	let filterReviewed = $state('');
	let selectedSample = $state<TrainingSample | null>(null);

	async function loadSamples() {
		loading = true;
		try {
			const params = new URLSearchParams();
			if (sortBy) params.set('sort', sortBy);
			if (filterResolution) params.set('resolution', filterResolution);
			if (filterReviewed) params.set('reviewed', filterReviewed);
			const res = await fetch(`/api/admin/training?${params}`);
			if (res.ok) {
				const data = await res.json();
				samples = data.samples;
				stats = data.stats;
			}
		} finally {
			loading = false;
		}
	}

	onMount(loadSamples);

	function avgConfidenceNum(scores: TrainingSample['confidenceScores']): number {
		if (!scores || !Array.isArray(scores) || scores.length === 0) return 0;
		return scores.reduce((s, c) => s + (c.spec_confidence ?? 0), 0) / scores.length;
	}

	function avgConfidence(scores: TrainingSample['confidenceScores']): string {
		const avg = avgConfidenceNum(scores);
		return avg > 0 ? (avg * 100).toFixed(0) + '%' : '-';
	}

	function confidenceColor(pct: number): string {
		if (pct >= 0.9) return 'var(--color-green)';
		if (pct >= 0.7) return 'var(--color-amber)';
		return 'var(--color-red)';
	}

	function formatDate(dateStr: string): string {
		return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
	}

	async function markReviewed(id: number) {
		await fetch(`/api/admin/training/${id}`, { method: 'PATCH' });
		samples = samples.map(s => s.id === id ? { ...s, reviewedByAdmin: true } : s);
		if (selectedSample?.id === id) {
			selectedSample = { ...selectedSample, reviewedByAdmin: true };
		}
	}

	function getDetectedRoster(scanResult: any): Array<{ name: string; spec: string; profession: string }> {
		if (!scanResult) return [];
		const roster: Array<{ name: string; spec: string; profession: string }> = [];
		for (const team of ['red_team', 'blue_team']) {
			const players = scanResult[team];
			if (Array.isArray(players)) {
				for (const p of players) {
					roster.push({
						name: p.character_name ?? 'Unknown',
						spec: p.spec_id ?? 'unknown',
						profession: p.profession_id ?? 'unknown'
					});
				}
			}
		}
		return roster;
	}

	function getCorrectedRoster(corrections: any): Array<{ slot: number; original_spec?: string; corrected_spec?: string; original_name?: string; corrected_name?: string }> {
		if (!corrections) return [];
		if (Array.isArray(corrections)) return corrections;
		return [];
	}

	let resolutionTimer: ReturnType<typeof setTimeout> | null = null;

	function handleResolutionInput() {
		if (resolutionTimer) clearTimeout(resolutionTimer);
		resolutionTimer = setTimeout(loadSamples, 300);
	}
</script>

<svelte:head>
	<title>Training Data — Admin — GW2 PvP Helper</title>
</svelte:head>

<div>
	<div class="mb-6 flex items-center justify-between">
		<h1 class="text-2xl font-bold text-(--color-text)">Training Data</h1>
		<a
			href="/api/admin/training/export"
			target="_blank"
			class="flex items-center gap-2 rounded-lg border border-(--color-border) bg-(--color-surface) px-4 py-2 text-sm text-(--color-text) hover:bg-(--color-surface-hover) transition-colors"
		>
			<svg class="h-4 w-4 text-(--color-green)" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
			</svg>
			Export JSON
		</a>
	</div>

	<!-- Stats panel -->
	{#if Object.keys(stats).length > 0}
		<div class="mb-6 grid grid-cols-{Object.keys(stats).length > 3 ? '4' : Object.keys(stats).length} gap-4">
			{#each Object.entries(stats) as [res, stat]}
				{@const confPct = stat.avgConfidence}
				<div class="rounded-xl border border-(--color-border) bg-(--color-surface) p-4">
					<div class="flex items-center justify-between mb-3">
						<span class="font-mono text-sm font-medium text-(--color-text)">{res}</span>
						<span class="text-[10px] font-bold uppercase tracking-wider text-(--color-text-tertiary)">{stat.total} samples</span>
					</div>
					<!-- Confidence gauge -->
					<div class="flex items-center gap-3">
						<div class="h-2 flex-1 rounded-full bg-(--color-bg)">
							<div class="h-full rounded-full transition-all duration-500" style="width: {confPct * 100}%; background: {confidenceColor(confPct)}"></div>
						</div>
						<span class="font-mono text-xs font-medium" style="color: {confidenceColor(confPct)}">{(confPct * 100).toFixed(0)}%</span>
					</div>
					{#if stat.corrected > 0}
						<p class="mt-2 text-[10px] text-(--color-amber)">{stat.corrected} corrected</p>
					{/if}
				</div>
			{/each}
		</div>
	{/if}

	<!-- Filters -->
	<div class="mb-6 flex items-center gap-3">
		<select
			bind:value={sortBy}
			onchange={loadSamples}
			class="rounded-lg border border-(--color-border) bg-(--color-bg) px-3 py-2 text-sm text-(--color-text) focus:border-(--color-accent) focus:outline-none"
		>
			<option value="date">Sort: Newest</option>
			<option value="confidence">Sort: Lowest Confidence</option>
		</select>
		<input
			type="text"
			bind:value={filterResolution}
			oninput={handleResolutionInput}
			placeholder="Filter resolution (e.g. 3440x1440)"
			class="rounded-lg border border-(--color-border) bg-(--color-bg) px-3.5 py-2 text-sm text-(--color-text) placeholder:text-(--color-text-tertiary) focus:border-(--color-accent) focus:outline-none w-56"
		/>
		<select
			bind:value={filterReviewed}
			onchange={loadSamples}
			class="rounded-lg border border-(--color-border) bg-(--color-bg) px-3 py-2 text-sm text-(--color-text) focus:border-(--color-accent) focus:outline-none"
		>
			<option value="">All</option>
			<option value="false">Unreviewed</option>
			<option value="true">Reviewed</option>
		</select>
	</div>

	{#if loading}
		<div class="flex items-center justify-center py-20">
			<span class="inline-block h-5 w-5 animate-spin rounded-full border-2 border-(--color-accent) border-t-transparent"></span>
		</div>
	{:else}
		<div class="overflow-x-auto rounded-xl border border-(--color-border)">
			<table class="w-full text-sm">
				<thead>
					<tr class="border-b border-(--color-border) bg-(--color-surface)">
						<th class="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-(--color-text-tertiary)">ID</th>
						<th class="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-(--color-text-tertiary)">User</th>
						<th class="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-(--color-text-tertiary)">Resolution</th>
						<th class="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-(--color-text-tertiary)">Confidence</th>
						<th class="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-(--color-text-tertiary)">Corrections</th>
						<th class="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-(--color-text-tertiary)">Status</th>
						<th class="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-(--color-text-tertiary)">Date</th>
						<th class="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-(--color-text-tertiary)"></th>
					</tr>
				</thead>
				<tbody>
					{#each samples as sample}
						{@const confNum = avgConfidenceNum(sample.confidenceScores)}
						<tr
							class="border-b border-(--color-border)/50 hover:bg-(--color-surface-hover) transition-colors cursor-pointer"
							onclick={() => (selectedSample = sample)}
						>
							<td class="px-4 py-3 font-mono text-xs text-(--color-text-tertiary)">#{sample.id}</td>
							<td class="px-4 py-3 font-mono text-(--color-text)">{sample.username ?? '-'}</td>
							<td class="px-4 py-3 font-mono text-xs text-(--color-text-secondary)">{sample.resolution ?? '-'}</td>
							<!-- Confidence gauge -->
							<td class="px-4 py-3">
								<div class="flex items-center gap-2">
									<div class="h-1.5 w-16 rounded-full bg-(--color-bg)">
										<div class="h-full rounded-full" style="width: {confNum * 100}%; background: {confidenceColor(confNum)}"></div>
									</div>
									<span class="font-mono text-xs" style="color: {confidenceColor(confNum)}">{avgConfidence(sample.confidenceScores)}</span>
								</div>
							</td>
							<td class="px-4 py-3">
								{#if sample.userCorrections}
									<span class="rounded-full bg-(--color-amber)/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-(--color-amber)">Corrected</span>
								{:else}
									<span class="text-(--color-text-tertiary) text-xs">—</span>
								{/if}
							</td>
							<td class="px-4 py-3">
								{#if sample.reviewedByAdmin}
									<span class="flex items-center gap-1 text-xs font-medium text-(--color-green)">
										<svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
										Reviewed
									</span>
								{:else}
									<span class="flex items-center gap-1 text-xs text-(--color-text-tertiary)">
										<svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
										Pending
									</span>
								{/if}
							</td>
							<td class="px-4 py-3 text-xs text-(--color-text-tertiary)">{formatDate(sample.createdAt)}</td>
							<td class="px-4 py-3">
								{#if !sample.reviewedByAdmin}
									<button
										onclick={(e) => { e.stopPropagation(); markReviewed(sample.id); }}
										class="rounded border border-(--color-green)/30 bg-(--color-green)/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-(--color-green) hover:bg-(--color-green)/20 transition-colors cursor-pointer"
									>
										Approve
									</button>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<p class="mt-3 text-xs text-(--color-text-tertiary)">{samples.length} samples</p>
	{/if}
</div>

<!-- Detail modal -->
{#if selectedSample}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
		onclick={(e) => { if (e.target === e.currentTarget) selectedSample = null; }}
		onkeydown={(e) => { if (e.key === 'Escape') selectedSample = null; }}
		role="dialog"
		aria-modal="true"
		aria-label="Training sample detail"
		tabindex="-1"
	>
		<div class="glass max-w-4xl w-full max-h-[90vh] overflow-y-auto rounded-xl p-6 border border-(--color-border) shadow-xl animate-modal-in m-4">
			<div class="flex items-center justify-between mb-4">
				<h2 class="text-lg font-bold text-(--color-text)">Training Sample #{selectedSample.id}</h2>
				<div class="flex items-center gap-3">
					{#if !selectedSample.reviewedByAdmin}
						<button
							onclick={() => markReviewed(selectedSample!.id)}
							class="btn-cta rounded-lg px-4 py-2 text-sm font-medium"
						>
							Mark Reviewed
						</button>
					{:else}
						<span class="flex items-center gap-1.5 text-(--color-green) text-sm font-medium">
							<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
							Reviewed
						</span>
					{/if}
					<button class="text-(--color-text-tertiary) hover:text-(--color-text) text-lg cursor-pointer transition-colors" onclick={() => (selectedSample = null)}>&#10005;</button>
				</div>
			</div>

			<div class="grid grid-cols-2 gap-6">
				<!-- Screenshot -->
				<div>
					<p class="text-xs font-bold uppercase tracking-wider text-(--color-text-tertiary) mb-2">Screenshot</p>
					<img src={selectedSample.screenshotUrl} alt="Training screenshot" class="w-full rounded-lg border border-(--color-border)" />
					<div class="mt-2 text-xs text-(--color-text-tertiary)">
						Resolution: {selectedSample.resolution ?? '-'} | UI Size: {selectedSample.uiSize ?? '-'}
					</div>
				</div>

				<!-- Roster comparison -->
				<div>
					<p class="text-xs font-bold uppercase tracking-wider text-(--color-text-tertiary) mb-2">Detected Roster</p>
					<div class="space-y-1">
						{#each getDetectedRoster(selectedSample.scanResult) as player, i}
							{@const corrections = getCorrectedRoster(selectedSample.userCorrections)}
							{@const correction = corrections.find(c => c.slot === i)}
							<div class="flex items-center gap-2 text-xs rounded px-2 py-1.5 {correction ? 'bg-(--color-amber)/10 border border-(--color-amber)/20' : 'bg-(--color-surface)'}">
								<img src="/icons/specs/{player.spec === 'core' ? player.profession : player.spec}.png" alt="" class="h-4 w-4 spec-icon" />
								<span class="font-mono text-(--color-text)">{player.name}</span>
								<span class="text-(--color-text-tertiary)">{getSpecLabel(player.profession, player.spec)}</span>
								{#if correction?.corrected_spec}
									<span class="text-(--color-amber) font-medium">→ {correction.corrected_spec}</span>
								{/if}
								{#if correction?.corrected_name}
									<span class="text-(--color-amber) font-medium">→ {correction.corrected_name}</span>
								{/if}
							</div>
						{/each}
					</div>

					{#if selectedSample.confidenceScores && Array.isArray(selectedSample.confidenceScores)}
						<p class="text-xs font-bold uppercase tracking-wider text-(--color-text-tertiary) mt-4 mb-2">Confidence Scores</p>
						<div class="space-y-2">
							{#each selectedSample.confidenceScores as score, i}
								{@const specConf = score.spec_confidence ?? 0}
								<div class="flex items-center gap-2 text-xs">
									<span class="w-12 text-(--color-text-tertiary)">Slot {score.slot ?? i}</span>
									<div class="h-1.5 flex-1 rounded-full bg-(--color-bg)">
										<div class="h-full rounded-full" style="width: {specConf * 100}%; background: {confidenceColor(specConf)}"></div>
									</div>
									<span class="font-mono w-8 text-right" style="color: {confidenceColor(specConf)}">
										{(specConf * 100).toFixed(0)}%
									</span>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			</div>
		</div>
	</div>
{/if}
