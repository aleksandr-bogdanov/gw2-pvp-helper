<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';

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
		<nav class="mb-6 flex items-center gap-1 border-b border-(--color-border) pb-3">
			{#each [
				{ href: '/admin', label: 'Dashboard', icon: 'M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z', exact: true },
				{ href: '/admin/users', label: 'Users', icon: 'M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z' },
				{ href: '/admin/training', label: 'Training', icon: 'M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75a1.5 1.5 0 00-1.5 1.5v13.5a1.5 1.5 0 001.5 1.5z' }
			] as link}
				{@const isActive = link.exact ? page.url.pathname === link.href : page.url.pathname.startsWith(link.href)}
				<a
					href={link.href}
					class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors {isActive
						? 'bg-(--color-accent)/10 text-(--color-accent) font-medium'
						: 'text-(--color-text-secondary) hover:bg-(--color-surface-hover) hover:text-(--color-text)'}"
				>
					<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
						<path stroke-linecap="round" stroke-linejoin="round" d={link.icon} />
					</svg>
					{link.label}
				</a>
			{/each}

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
					class="rounded-lg border border-(--color-border) bg-(--color-bg) px-3 py-1.5 text-xs text-(--color-text) focus:border-(--color-accent) focus:outline-none"
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
