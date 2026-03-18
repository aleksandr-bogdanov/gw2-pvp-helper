<script lang="ts">
	import { onMount } from 'svelte';

	interface Stats {
		totalUsers: number;
		totalMatches: number;
		totalTrainingSamples: number;
		totalAdviceCalls: number;
		totalProfileGens: number;
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
		<h1 class="mb-6 text-xl font-bold text-(--color-text)">Admin Dashboard</h1>

		<!-- Stats grid -->
		<div class="mb-8 grid grid-cols-3 gap-4">
			<div class="rounded-xl border border-(--color-border) bg-(--color-surface) p-5">
				<p class="text-xs font-bold uppercase tracking-wider text-(--color-text-tertiary)">Total Users</p>
				<p class="mt-1 text-2xl font-bold text-(--color-text)">{stats.totalUsers}</p>
			</div>
			<div class="rounded-xl border border-(--color-border) bg-(--color-surface) p-5">
				<p class="text-xs font-bold uppercase tracking-wider text-(--color-text-tertiary)">Total Matches</p>
				<p class="mt-1 text-2xl font-bold text-(--color-text)">{stats.totalMatches}</p>
			</div>
			<div class="rounded-xl border border-(--color-border) bg-(--color-surface) p-5">
				<p class="text-xs font-bold uppercase tracking-wider text-(--color-text-tertiary)">Training Samples</p>
				<p class="mt-1 text-2xl font-bold text-(--color-text)">{stats.totalTrainingSamples}</p>
			</div>
		</div>

		<div class="mb-8 grid grid-cols-2 gap-4">
			<div class="rounded-xl border border-(--color-border) bg-(--color-surface) p-5">
				<p class="text-xs font-bold uppercase tracking-wider text-(--color-text-tertiary)">Advice Calls Made</p>
				<p class="mt-1 text-2xl font-bold text-(--color-accent)">{stats.totalAdviceCalls}</p>
			</div>
			<div class="rounded-xl border border-(--color-border) bg-(--color-surface) p-5">
				<p class="text-xs font-bold uppercase tracking-wider text-(--color-text-tertiary)">Profile Generations</p>
				<p class="mt-1 text-2xl font-bold text-(--color-accent)">{stats.totalProfileGens}</p>
			</div>
		</div>

		<!-- Quick links -->
		<div class="flex gap-4">
			<a href="/admin/users" class="btn-cta inline-block rounded-lg px-5 py-2.5 text-sm font-medium">
				Manage Users
			</a>
			<a href="/admin/training" class="rounded-lg border border-(--color-border) bg-(--color-surface) px-5 py-2.5 text-sm font-medium text-(--color-text) hover:bg-(--color-surface-hover) transition-colors">
				Review Training Data
			</a>
		</div>
	</div>
{/if}
