<script lang="ts">
	import { onMount } from 'svelte';

	let { children } = $props<{ children: import('svelte').Snippet }>();

	type AuthUser = { id: number; username: string; role: string } | null;

	let authUser = $state<AuthUser>(null);
	let step = $state<'checking' | 'invite' | 'register' | 'authenticated'>('checking');

	// Invite flow state
	let inviteCode = $state('');
	let inviteError = $state('');
	let inviteLoading = $state(false);
	let validatedCode = $state('');

	// Register flow state
	let username = $state('');
	let registerError = $state('');
	let registerLoading = $state(false);

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
		step = 'invite';
	});

	async function submitInviteCode() {
		inviteError = '';
		inviteLoading = true;
		try {
			const res = await fetch('/api/auth/invite', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ code: inviteCode.trim() })
			});
			const data = await res.json();
			if (!res.ok) {
				inviteError = data.reason || data.error || 'Invalid code';
				return;
			}
			validatedCode = inviteCode.trim();
			step = 'register';
		} catch {
			inviteError = 'Network error';
		} finally {
			inviteLoading = false;
		}
	}

	async function submitRegister() {
		registerError = '';
		registerLoading = true;
		try {
			const res = await fetch('/api/auth/register', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					code: validatedCode,
					username: username.trim(),
					consent: true,
					deviceInfo: {
						userAgent: navigator.userAgent,
						screenWidth: screen.width,
						screenHeight: screen.height,
						devicePixelRatio: devicePixelRatio
					}
				})
			});
			const data = await res.json();
			if (!res.ok) {
				registerError = data.error || 'Registration failed';
				return;
			}
			authUser = { id: data.userId, username: data.username, role: 'user' };
			step = 'authenticated';
		} catch {
			registerError = 'Network error';
		} finally {
			registerLoading = false;
		}
	}

	function handleInviteKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') submitInviteCode();
	}

	function handleRegisterKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && username.trim().length >= 2) submitRegister();
	}
</script>

{#if step === 'checking'}
	<div class="flex min-h-screen items-center justify-center bg-(--color-bg)">
		<div class="inline-block h-6 w-6 animate-spin rounded-full border-2 border-(--color-accent) border-t-transparent"></div>
	</div>
{:else if step === 'invite'}
	<div class="flex min-h-screen items-center justify-center bg-(--color-bg)">
		<div class="flex w-full max-w-sm flex-col gap-5 rounded-xl border border-(--color-border) bg-(--color-surface) px-8 py-10">
			<div class="flex flex-col gap-1.5">
				<h1 class="text-lg font-semibold text-(--color-text)">GW2 PvP Helper</h1>
				<p class="text-sm text-(--color-text-secondary)">Enter your invite code to get started.</p>
			</div>
			<div class="flex flex-col gap-3">
				<input
					type="text"
					bind:value={inviteCode}
					onkeydown={handleInviteKeydown}
					placeholder="Invite code"
					class="w-full rounded-lg border border-(--color-border) bg-(--color-bg) px-3.5 py-2.5 text-sm text-(--color-text) placeholder:text-(--color-text-tertiary) focus:border-(--color-accent) focus:outline-none"
					autofocus
				/>
				{#if inviteError}
					<p class="text-xs text-(--color-red)">{inviteError}</p>
				{/if}
				<button
					onclick={submitInviteCode}
					disabled={inviteLoading || !inviteCode.trim()}
					class="rounded-lg bg-(--color-accent) px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-(--color-accent)/90 disabled:opacity-50 cursor-pointer"
				>
					{inviteLoading ? 'Checking...' : 'Continue'}
				</button>
			</div>
		</div>
	</div>
{:else if step === 'register'}
	<div class="flex min-h-screen items-center justify-center bg-(--color-bg)">
		<div class="flex w-full max-w-sm flex-col gap-5 rounded-xl border border-(--color-border) bg-(--color-surface) px-8 py-10">
			<div class="flex flex-col gap-1.5">
				<h1 class="text-lg font-semibold text-(--color-text)">Choose a Username</h1>
				<p class="text-sm text-(--color-text-secondary)">This will identify you in the app.</p>
			</div>
			<div class="flex flex-col gap-3">
				<input
					type="text"
					bind:value={username}
					onkeydown={handleRegisterKeydown}
					placeholder="Username (2-32 chars)"
					maxlength={32}
					class="w-full rounded-lg border border-(--color-border) bg-(--color-bg) px-3.5 py-2.5 text-sm text-(--color-text) placeholder:text-(--color-text-tertiary) focus:border-(--color-accent) focus:outline-none"
					autofocus
				/>
				{#if registerError}
					<p class="text-xs text-(--color-red)">{registerError}</p>
				{/if}
				<div class="rounded-lg border border-(--color-border) bg-(--color-bg) p-3">
					<p class="text-xs text-(--color-text-secondary) leading-relaxed">
						By creating an account, you consent to the storage of your gameplay data (match results, screenshots, tactical advice) to provide the service. You can delete all your data at any time from Settings.
					</p>
				</div>
				<button
					onclick={submitRegister}
					disabled={registerLoading || username.trim().length < 2}
					class="rounded-lg bg-(--color-accent) px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-(--color-accent)/90 disabled:opacity-50 cursor-pointer"
				>
					{registerLoading ? 'Creating account...' : 'Create Account & Agree'}
				</button>
			</div>
		</div>
	</div>
{:else}
	{@render children()}
{/if}
