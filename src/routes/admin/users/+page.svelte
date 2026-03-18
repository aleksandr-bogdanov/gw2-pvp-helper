<script lang="ts">
	import { onMount } from 'svelte';

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

	function formatDate(dateStr: string): string {
		return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
	}

	function getResolution(deviceInfo: Record<string, string> | null): string {
		return deviceInfo?.resolution ?? '-';
	}
</script>

<svelte:head>
	<title>Users — Admin — GW2 PvP Helper</title>
</svelte:head>

<div>
	<div class="mb-4 flex items-center justify-between">
		<h1 class="text-xl font-bold text-(--color-text)">Users</h1>
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
						<th class="px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wider text-(--color-text-tertiary)">User</th>
						<th class="px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wider text-(--color-text-tertiary)">Role</th>
						<th class="px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wider text-(--color-text-tertiary)">Resolution</th>
						<th class="px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wider text-(--color-text-tertiary)">Advice</th>
						<th class="px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wider text-(--color-text-tertiary)">Profiles</th>
						<th class="px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wider text-(--color-text-tertiary)">BYOK</th>
						<th class="px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wider text-(--color-text-tertiary)">Last Seen</th>
						<th class="px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wider text-(--color-text-tertiary)">Created</th>
						<th class="px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wider text-(--color-text-tertiary)"></th>
					</tr>
				</thead>
				<tbody>
					{#each users as user}
						<tr class="border-b border-(--color-border)/50 hover:bg-(--color-surface-hover) transition-colors">
							<td class="px-3 py-2 font-mono font-medium text-(--color-text)">{user.username}</td>
							<td class="px-3 py-2">
								<span class="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider
									{user.role === 'admin' ? 'text-(--color-amber) bg-(--color-amber)/10' : 'text-(--color-text-tertiary) bg-(--color-surface-raised)'}">
									{user.role}
								</span>
							</td>
							<td class="px-3 py-2 font-mono text-xs text-(--color-text-secondary)">{getResolution(user.deviceInfo)}</td>
							<td class="px-3 py-2 text-(--color-text-secondary)">{user.adviceCallsRemaining}</td>
							<td class="px-3 py-2 text-(--color-text-secondary)">{user.profileGensRemaining}</td>
							<td class="px-3 py-2">
								{#if user.hasByokKey}
									<span class="text-(--color-green) text-xs font-medium">Yes</span>
								{:else}
									<span class="text-(--color-text-tertiary) text-xs">No</span>
								{/if}
							</td>
							<td class="px-3 py-2 text-xs text-(--color-text-tertiary)">{formatDate(user.lastSeenAt)}</td>
							<td class="px-3 py-2 text-xs text-(--color-text-tertiary)">{formatDate(user.createdAt)}</td>
							<td class="px-3 py-2">
								<a
									href="/?as={user.id}"
									class="rounded border border-(--color-accent)/30 bg-(--color-accent)/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-(--color-accent) hover:bg-(--color-accent)/20 transition-colors"
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
