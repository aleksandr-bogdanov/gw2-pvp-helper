<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';

	let { children } = $props();
	let authorized = $state(false);
	let checking = $state(true);

	onMount(async () => {
		try {
			const res = await fetch('/api/auth/me');
			if (res.ok) {
				const data = await res.json();
				if (data.user?.role === 'admin') {
					authorized = true;
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
</script>

{#if checking}
	<div class="flex items-center justify-center py-20">
		<span class="inline-block h-5 w-5 animate-spin rounded-full border-2 border-(--color-accent) border-t-transparent"></span>
	</div>
{:else if authorized}
	<div class="mx-auto max-w-6xl">
		<!-- Admin sub-nav -->
		<nav class="mb-4 flex items-center gap-4 border-b border-(--color-border) pb-3">
			<a href="/admin" class="text-sm font-medium text-(--color-accent) hover:text-(--color-text) transition-colors">Dashboard</a>
			<a href="/admin/users" class="text-sm text-(--color-text-secondary) hover:text-(--color-text) transition-colors">Users</a>
			<a href="/admin/training" class="text-sm text-(--color-text-secondary) hover:text-(--color-text) transition-colors">Training</a>
		</nav>
		{@render children()}
	</div>
{/if}
