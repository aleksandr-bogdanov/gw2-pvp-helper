<script lang="ts">
	import { onMount } from 'svelte';
	import { formatTime } from '$lib/match-utils.js';

	interface Stats {
		totalUsers: number;
		totalMatches: number;
		totalTrainingSamples: number;
		totalAdviceCalls: number;
		totalProfileGens: number;
		activeToday: number;
		activeWeek: number;
		byokUsers: number;
		unreviewedSamples: number;
		recentUsers: Array<{ id: number; username: string; createdAt: string }>;
		freeAdviceLimit: number;
		freeProfileLimit: number;
	}

	let stats = $state<Stats | null>(null);
	let loading = $state(true);

	onMount(async () => {
		try {
			const res = await fetch('/api/admin/stats');
			if (res.ok) {
				stats = await res.json();
			}
		} finally {
			loading = false;
		}
	});

	let maxAdvice = $derived(stats ? stats.totalUsers * stats.freeAdviceLimit : 0);
	let advicePct = $derived(maxAdvice > 0 && stats ? Math.min((stats.totalAdviceCalls / maxAdvice) * 100, 100) : 0);
	let maxProfiles = $derived(stats ? stats.totalUsers * stats.freeProfileLimit : 0);
	let profilePct = $derived(maxProfiles > 0 && stats ? Math.min((stats.totalProfileGens / maxProfiles) * 100, 100) : 0);

</script>

<svelte:head>
	<title>Admin Dashboard — GW2 PvP Helper</title>
</svelte:head>

{#if loading}
	<div class="flex items-center justify-center py-20">
		<span class="inline-block h-5 w-5 animate-spin rounded-full border-2 border-(--color-accent) border-t-transparent"></span>
	</div>
{:else if stats}
	<div>
		<h1 class="mb-8 text-2xl font-bold text-(--color-text)">Dashboard</h1>

		<!-- Primary stats row -->
		<div class="mb-6 grid grid-cols-4 gap-4">
			<!-- Users -->
			<div class="rounded-xl border border-(--color-border) bg-(--color-surface) p-5 transition-all hover:border-(--color-accent)/30">
				<div class="flex items-center gap-3 mb-3">
					<div class="flex h-9 w-9 items-center justify-center rounded-lg bg-(--color-accent)/10">
						<svg class="h-4.5 w-4.5 text-(--color-accent)" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
						</svg>
					</div>
					<p class="text-xs font-bold uppercase tracking-wider text-(--color-text-tertiary)">Users</p>
				</div>
				<p class="text-3xl font-bold text-(--color-text)">{stats.totalUsers}</p>
				<div class="mt-2 flex items-center gap-3 text-xs text-(--color-text-tertiary)">
					<span class="flex items-center gap-1">
						<span class="h-1.5 w-1.5 rounded-full bg-(--color-green)"></span>
						{stats.activeToday} today
					</span>
					<span>{stats.activeWeek} this week</span>
				</div>
			</div>

			<!-- Matches -->
			<div class="rounded-xl border border-(--color-border) bg-(--color-surface) p-5 transition-all hover:border-(--color-green)/30">
				<div class="flex items-center gap-3 mb-3">
					<div class="flex h-9 w-9 items-center justify-center rounded-lg bg-(--color-green)/10">
						<svg class="h-4.5 w-4.5 text-(--color-green)" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5" />
						</svg>
					</div>
					<p class="text-xs font-bold uppercase tracking-wider text-(--color-text-tertiary)">Matches</p>
				</div>
				<p class="text-3xl font-bold text-(--color-text)">{stats.totalMatches}</p>
			</div>

			<!-- Training Samples -->
			<div class="rounded-xl border border-(--color-border) bg-(--color-surface) p-5 transition-all hover:border-(--color-amber)/30">
				<div class="flex items-center gap-3 mb-3">
					<div class="flex h-9 w-9 items-center justify-center rounded-lg bg-(--color-amber)/10">
						<svg class="h-4.5 w-4.5 text-(--color-amber)" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75a1.5 1.5 0 00-1.5 1.5v13.5a1.5 1.5 0 001.5 1.5z" />
						</svg>
					</div>
					<p class="text-xs font-bold uppercase tracking-wider text-(--color-text-tertiary)">Training Samples</p>
				</div>
				<p class="text-3xl font-bold text-(--color-text)">{stats.totalTrainingSamples}</p>
				{#if stats.unreviewedSamples > 0}
					<div class="mt-2">
						<span class="rounded-full bg-(--color-amber)/15 px-2 py-0.5 text-[10px] font-bold text-(--color-amber)">
							{stats.unreviewedSamples} unreviewed
						</span>
					</div>
				{/if}
			</div>

			<!-- BYOK -->
			<div class="rounded-xl border border-(--color-border) bg-(--color-surface) p-5 transition-all hover:border-(--color-accent)/30">
				<div class="flex items-center gap-3 mb-3">
					<div class="flex h-9 w-9 items-center justify-center rounded-lg bg-(--color-accent)/10">
						<svg class="h-4.5 w-4.5 text-(--color-accent)" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
						</svg>
					</div>
					<p class="text-xs font-bold uppercase tracking-wider text-(--color-text-tertiary)">BYOK Users</p>
				</div>
				<p class="text-3xl font-bold text-(--color-accent)">{stats.byokUsers}</p>
				<p class="mt-2 text-xs text-(--color-text-tertiary)">of {stats.totalUsers} total</p>
			</div>
		</div>

		<!-- Usage bars -->
		<div class="mb-6 grid grid-cols-2 gap-4">
			<!-- Advice usage -->
			<div class="rounded-xl border border-(--color-border) bg-(--color-surface) p-5">
				<div class="flex items-center justify-between mb-3">
					<p class="text-xs font-bold uppercase tracking-wider text-(--color-text-tertiary)">Advice Calls Used</p>
					<span class="font-mono text-lg font-bold text-(--color-accent)">{stats.totalAdviceCalls}</span>
				</div>
				<div class="h-2 w-full rounded-full bg-(--color-bg)">
					<div class="h-full rounded-full bg-gradient-to-r from-(--color-accent) to-(--color-green) transition-all duration-1000" style="width: {advicePct}%"></div>
				</div>
				<p class="mt-1.5 text-[10px] text-(--color-text-tertiary)">{stats.totalAdviceCalls} of {maxAdvice} total capacity ({stats.totalUsers} users × {stats.freeAdviceLimit} each)</p>
			</div>

			<!-- Profile gen usage -->
			<div class="rounded-xl border border-(--color-border) bg-(--color-surface) p-5">
				<div class="flex items-center justify-between mb-3">
					<p class="text-xs font-bold uppercase tracking-wider text-(--color-text-tertiary)">Profile Generations Used</p>
					<span class="font-mono text-lg font-bold text-(--color-accent)">{stats.totalProfileGens}</span>
				</div>
				<div class="h-2 w-full rounded-full bg-(--color-bg)">
					<div class="h-full rounded-full bg-gradient-to-r from-(--color-amber) to-(--color-red) transition-all duration-1000" style="width: {profilePct}%"></div>
				</div>
				<p class="mt-1.5 text-[10px] text-(--color-text-tertiary)">{stats.totalProfileGens} of {maxProfiles} total capacity ({stats.totalUsers} users × {stats.freeProfileLimit} each)</p>
			</div>
		</div>

		<!-- Bottom row: Recent users + Quick actions -->
		<div class="grid grid-cols-2 gap-4">
			<!-- Recent users -->
			<div class="rounded-xl border border-(--color-border) bg-(--color-surface) p-5">
				<p class="text-xs font-bold uppercase tracking-wider text-(--color-text-tertiary) mb-4">Recent Users</p>
				{#if stats.recentUsers.length === 0}
					<p class="text-sm text-(--color-text-tertiary)">No users yet</p>
				{:else}
					<div class="flex flex-col gap-2.5">
						{#each stats.recentUsers as user}
							<div class="flex items-center justify-between">
								<div class="flex items-center gap-3">
									<div class="flex h-8 w-8 items-center justify-center rounded-full bg-(--color-accent)/10 text-xs font-bold text-(--color-accent)">
										{user.username.slice(0, 2).toUpperCase()}
									</div>
									<span class="font-mono text-sm text-(--color-text)">{user.username}</span>
								</div>
								<span class="text-xs text-(--color-text-tertiary)">{formatTime(user.createdAt)}</span>
							</div>
						{/each}
					</div>
				{/if}
			</div>

			<!-- Quick actions -->
			<div class="rounded-xl border border-(--color-border) bg-(--color-surface) p-5">
				<p class="text-xs font-bold uppercase tracking-wider text-(--color-text-tertiary) mb-4">Quick Actions</p>
				<div class="flex flex-col gap-3">
					<a href="/admin/users" class="flex items-center gap-3 rounded-lg border border-(--color-border) bg-(--color-bg) px-4 py-3 text-sm text-(--color-text) hover:bg-(--color-surface-hover) transition-colors">
						<svg class="h-4 w-4 text-(--color-accent)" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
						</svg>
						Manage Users
					</a>
					<a href="/admin/training" class="flex items-center gap-3 rounded-lg border border-(--color-border) bg-(--color-bg) px-4 py-3 text-sm text-(--color-text) hover:bg-(--color-surface-hover) transition-colors">
						<svg class="h-4 w-4 text-(--color-amber)" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75a1.5 1.5 0 00-1.5 1.5v13.5a1.5 1.5 0 001.5 1.5z" />
						</svg>
						Review Training Data
						{#if stats.unreviewedSamples > 0}
							<span class="ml-auto rounded-full bg-(--color-amber)/15 px-2 py-0.5 text-[10px] font-bold text-(--color-amber)">{stats.unreviewedSamples}</span>
						{/if}
					</a>
					<a href="/api/admin/training/export" target="_blank" class="flex items-center gap-3 rounded-lg border border-(--color-border) bg-(--color-bg) px-4 py-3 text-sm text-(--color-text) hover:bg-(--color-surface-hover) transition-colors">
						<svg class="h-4 w-4 text-(--color-green)" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
						</svg>
						Export Training Data
					</a>
				</div>
			</div>
		</div>
	</div>
{/if}
