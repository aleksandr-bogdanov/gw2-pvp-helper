<script lang="ts">
	import { onMount } from 'svelte';
	import { formatTime } from '$lib/match-utils.js';

	interface AdminUser {
		id: number;
		username: string;
		role: string;
		deviceInfo: Record<string, string> | null;
		adviceCallsRemaining: number;
		profileGensRemaining: number;
		hasByokKey: boolean;
		byokModelPreference: string;
		lastSeenAt: string;
		createdAt: string;
	}

	let users = $state<AdminUser[]>([]);
	let loading = $state(true);
	let search = $state('');
	let searchTimer: ReturnType<typeof setTimeout> | null = null;

	const FREE_ADVICE_LIMIT = 15;
	const FREE_PROFILE_LIMIT = 3;

	async function loadUsers(q: string = '') {
		loading = true;
		try {
			const params = q ? `?search=${encodeURIComponent(q)}` : '';
			const res = await fetch(`/api/admin/users${params}`);
			if (res.ok) {
				const data = await res.json();
				users = data.users;
			}
		} finally {
			loading = false;
		}
	}

	function handleSearch() {
		if (searchTimer) clearTimeout(searchTimer);
		searchTimer = setTimeout(() => loadUsers(search), 300);
	}

	onMount(() => {
		loadUsers();
	});


	function getResolution(deviceInfo: Record<string, string> | null): string {
		return deviceInfo?.resolution ?? '-';
	}
</script>

<svelte:head>
	<title>Users — Admin — GW2 PvP Helper</title>
</svelte:head>

<div>
	<div class="mb-6 flex items-center justify-between">
		<h1 class="text-2xl font-bold text-(--color-text)">Users</h1>
		<input
			type="text"
			bind:value={search}
			oninput={handleSearch}
			placeholder="Search by username or resolution..."
			class="rounded-lg border border-(--color-border) bg-(--color-bg) px-3.5 py-2 text-sm text-(--color-text) placeholder:text-(--color-text-tertiary) focus:border-(--color-accent) focus:outline-none w-72"
		/>
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
						<th class="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-(--color-text-tertiary)">User</th>
						<th class="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-(--color-text-tertiary)">Role</th>
						<th class="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-(--color-text-tertiary)">Resolution</th>
						<th class="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-(--color-text-tertiary)">Advice Usage</th>
						<th class="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-(--color-text-tertiary)">Profile Usage</th>
						<th class="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-(--color-text-tertiary)">BYOK</th>
						<th class="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-(--color-text-tertiary)">Last Active</th>
						<th class="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-(--color-text-tertiary)"></th>
					</tr>
				</thead>
				<tbody>
					{#each users as user}
						{@const adviceUsed = FREE_ADVICE_LIMIT - user.adviceCallsRemaining}
						{@const profilesUsed = FREE_PROFILE_LIMIT - user.profileGensRemaining}
						{@const advicePct = (adviceUsed / FREE_ADVICE_LIMIT) * 100}
						{@const profilePct = (profilesUsed / FREE_PROFILE_LIMIT) * 100}
						<tr class="border-b border-(--color-border)/50 hover:bg-(--color-surface-hover) transition-colors">
							<td class="px-4 py-3">
								<div class="flex items-center gap-3">
									<div class="flex h-8 w-8 items-center justify-center rounded-full bg-(--color-accent)/10 text-xs font-bold text-(--color-accent)">
										{user.username.slice(0, 2).toUpperCase()}
									</div>
									<span class="font-mono font-medium text-(--color-text)">{user.username}</span>
								</div>
							</td>
							<td class="px-4 py-3">
								<span class="rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider
									{user.role === 'admin' ? 'text-(--color-amber) bg-(--color-amber)/10' : 'text-(--color-text-tertiary) bg-(--color-surface-raised)'}">
									{user.role}
								</span>
							</td>
							<td class="px-4 py-3 font-mono text-xs text-(--color-text-secondary)">{getResolution(user.deviceInfo)}</td>
							<td class="px-4 py-3">
								<div class="flex items-center gap-2">
									<div class="h-1.5 w-20 rounded-full bg-(--color-bg)">
										<div class="h-full rounded-full transition-all {advicePct >= 100 ? 'bg-(--color-red)' : 'bg-(--color-accent)'}" style="width: {Math.min(advicePct, 100)}%"></div>
									</div>
									<span class="font-mono text-xs text-(--color-text-tertiary)">{adviceUsed}/{FREE_ADVICE_LIMIT}</span>
								</div>
							</td>
							<td class="px-4 py-3">
								<div class="flex items-center gap-2">
									<div class="h-1.5 w-16 rounded-full bg-(--color-bg)">
										<div class="h-full rounded-full transition-all {profilePct >= 100 ? 'bg-(--color-red)' : 'bg-(--color-amber)'}" style="width: {Math.min(profilePct, 100)}%"></div>
									</div>
									<span class="font-mono text-xs text-(--color-text-tertiary)">{profilesUsed}/{FREE_PROFILE_LIMIT}</span>
								</div>
							</td>
							<td class="px-4 py-3">
								{#if user.hasByokKey}
									<span class="flex items-center gap-1.5 rounded-full bg-(--color-green)/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-(--color-green)">
										<svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" /></svg>
										BYOK
									</span>
								{:else}
									<span class="text-(--color-text-tertiary) text-xs">Free tier</span>
								{/if}
							</td>
							<td class="px-4 py-3 text-xs text-(--color-text-tertiary)">{formatTime(user.lastSeenAt)}</td>
							<td class="px-4 py-3">
								<a
									href="/app?as={user.id}"
									class="rounded border border-(--color-accent)/30 bg-(--color-accent)/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-(--color-accent) hover:bg-(--color-accent)/20 transition-colors"
								>
									Impersonate
								</a>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<p class="mt-3 text-xs text-(--color-text-tertiary)">{users.length} users</p>
	{/if}
</div>
