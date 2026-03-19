<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';

	let { children } = $props();
	let authorized = $state(false);
	let checking = $state(true);

	// Impersonation state
	type UserEntry = { id: number; username: string };
	let allUsers = $state<UserEntry[]>([]);
	let impersonatingId = $state<number | null>(null);
	let impersonatingName = $derived(
		impersonatingId
			? allUsers.find((u) => u.id === impersonatingId)?.username ?? `User #${impersonatingId}`
			: null
	);

	onMount(async () => {
		try {
			const res = await fetch('/api/auth/me');
			if (res.ok) {
				const data = await res.json();
				if (data.user?.role === 'admin') {
					authorized = true;
					// Check if currently impersonating
					if (data.user.effectiveUserId && data.user.effectiveUserId !== data.user.id) {
						impersonatingId = data.user.effectiveUserId;
					}
					// Load users list for impersonation dropdown
					loadUsers();
				} else {
					goto('/');
				}
			} else {
				goto('/');
			}
		} catch {
			goto('/');
		} finally {
			checking = false;
		}
	});

	async function loadUsers() {
		try {
			const res = await fetch('/api/admin/users');
			if (res.ok) {
				const data = await res.json();
				allUsers = data.users?.map((u: { id: number; username: string }) => ({
					id: u.id,
					username: u.username
				})) ?? [];
				// impersonatingName is $derived — no manual sync needed
			}
		} catch {
			// non-critical
		}
	}

	async function startImpersonation(userId: number) {
		const res = await fetch('/api/admin/impersonate', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ userId })
		});
		if (res.ok) {
			impersonatingId = userId;
		}
	}

	async function stopImpersonation() {
		const res = await fetch('/api/admin/impersonate', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ userId: null })
		});
		if (res.ok) {
			impersonatingId = null;
		}
	}
</script>

{#if checking}
	<div class="flex items-center justify-center py-20">
		<span class="inline-block h-5 w-5 animate-spin rounded-full border-2 border-(--color-accent) border-t-transparent"></span>
	</div>
{:else if authorized}
	<!-- Impersonation banner -->
	{#if impersonatingId}
		<div class="sticky top-0 z-50 flex items-center justify-between bg-amber-600 px-4 py-2 text-sm font-medium text-black">
			<span>Impersonating: <strong>{impersonatingName}</strong> (ID: {impersonatingId})</span>
			<button
				onclick={stopImpersonation}
				class="rounded bg-black/20 px-3 py-1 text-xs font-semibold hover:bg-black/30 cursor-pointer"
			>
				Stop Impersonating
			</button>
		</div>
	{/if}

	<div class="mx-auto max-w-6xl">
		<!-- Admin sub-nav -->
		<nav class="mb-4 flex items-center gap-4 border-b border-(--color-border) pb-3">
			<a href="/admin" class="text-sm font-medium text-(--color-accent) hover:text-(--color-text) transition-colors">Dashboard</a>
			<a href="/admin/users" class="text-sm text-(--color-text-secondary) hover:text-(--color-text) transition-colors">Users</a>
			<a href="/admin/training" class="text-sm text-(--color-text-secondary) hover:text-(--color-text) transition-colors">Training</a>

			<!-- Impersonation selector -->
			<div class="ml-auto flex items-center gap-2">
				<select
					onchange={(e) => {
						const val = (e.target as HTMLSelectElement).value;
						if (val === '') {
							stopImpersonation();
						} else {
							startImpersonation(parseInt(val));
						}
					}}
					class="rounded border border-(--color-border) bg-(--color-bg) px-2 py-1 text-xs text-(--color-text)"
					value={impersonatingId ?? ''}
				>
					<option value="">View as: yourself</option>
					{#each allUsers as user}
						<option value={user.id}>{user.username} (#{user.id})</option>
					{/each}
				</select>
			</div>
		</nav>
		{@render children()}
	</div>
{/if}
