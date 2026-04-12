<script lang="ts">
	import { onMount } from 'svelte';

	let { children } = $props<{ children: import('svelte').Snippet }>();

	type AuthUser = { id: number; username: string; role: string } | null;

	let authUser = $state<AuthUser>(null);
	let step = $state<'checking' | 'login' | 'authenticated'>('checking');

	let apiKey = $state('');
	let loginError = $state('');
	let loginLoading = $state(false);

	onMount(async () => {
		try {
			const res = await fetch('/api/auth/me');
			if (res.ok) {
				const data = await res.json();
				if (data.user) {
					authUser = data.user;
					step = 'authenticated';
					return;
				}
			}
		} catch {
			// no session
		}
		step = 'login';
	});

	async function submitApiKey() {
		loginError = '';
		loginLoading = true;
		try {
			const res = await fetch('/api/auth/login', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					apiKey: apiKey.trim(),
					deviceInfo: {
						userAgent: navigator.userAgent,
						screenWidth: screen.width,
						screenHeight: screen.height,
						devicePixelRatio: devicePixelRatio,
						resolution: `${screen.width}x${screen.height}`
					}
				})
			});
			const data = await res.json();
			if (!res.ok) {
				loginError = data.error || 'Login failed';
				return;
			}
			authUser = { id: data.userId, username: data.username, role: data.role };
			step = 'authenticated';
		} catch {
			loginError = 'Network error — check your connection';
		} finally {
			loginLoading = false;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && apiKey.trim()) submitApiKey();
	}
</script>

{#if step === 'checking'}
	<div class="flex min-h-screen items-center justify-center bg-(--color-bg)">
		<div class="inline-block h-6 w-6 animate-spin rounded-full border-2 border-(--color-accent) border-t-transparent"></div>
	</div>
{:else if step === 'login'}
	<div class="flex min-h-screen items-center justify-center bg-(--color-bg)">
		<div class="flex w-full max-w-sm flex-col gap-5 rounded-xl border border-(--color-border) bg-(--color-surface) px-8 py-10">
			<div class="flex flex-col gap-1.5">
				<h1 class="text-lg font-semibold text-(--color-text)">GW2 PvP Helper</h1>
				<p class="text-sm text-(--color-text-secondary)">Log in with your Guild Wars 2 API key.</p>
			</div>

			<div class="flex flex-col gap-3">
				<input
					type="password"
					bind:value={apiKey}
					onkeydown={handleKeydown}
					placeholder="Paste your GW2 API key"
					class="w-full rounded-lg border border-(--color-border) bg-(--color-bg) px-3.5 py-2.5 font-mono text-sm text-(--color-text) placeholder:text-(--color-text-tertiary) focus:border-(--color-accent) focus:outline-none"
				/>

				{#if loginError}
					<p class="text-xs text-(--color-red)">{loginError}</p>
				{/if}

				<button
					onclick={submitApiKey}
					disabled={loginLoading || !apiKey.trim()}
					class="rounded-lg bg-(--color-accent) px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-(--color-accent)/90 disabled:opacity-50 cursor-pointer"
				>
					{loginLoading ? 'Verifying with GW2...' : 'Log In'}
				</button>
			</div>

			<div class="rounded-lg border border-(--color-border) bg-(--color-bg) p-3">
				<p class="text-xs text-(--color-text-secondary) leading-relaxed">
					<strong class="text-(--color-text)">How to get an API key:</strong><br />
					1. Go to <a href="https://account.arena.net/applications" target="_blank" rel="noopener" class="text-(--color-accent) hover:underline">account.arena.net/applications</a><br />
					2. Click "New Key" and name it anything<br />
					3. Check the <strong>"account"</strong> permission (required)<br />
					4. Copy the key and paste it above
				</p>
			</div>

			<p class="text-center text-[10px] text-(--color-text-tertiary) leading-relaxed">
				By logging in, you consent to the storage of your gameplay data (match results, screenshots, tactical advice) to provide the service. Your API key is encrypted and only used to verify your identity.
			</p>
		</div>
	</div>
{:else}
	{@render children()}
{/if}
