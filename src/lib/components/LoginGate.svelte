<script lang="ts">
	import { onMount } from 'svelte';

	let { children } = $props<{ children: import('svelte').Snippet }>();

	type AuthUser = { id: number; username: string; role: string } | null;

	let authUser = $state<AuthUser>(null);
	let step = $state<'checking' | 'invite' | 'register' | 'login' | 'authenticated'>('checking');

	// Invite flow state
	let inviteCode = $state('');
	let inviteError = $state('');
	let inviteLoading = $state(false);
	let validatedCode = $state('');

	// Register flow state
	let regUsername = $state('');
	let regPassword = $state('');
	let regPasswordConfirm = $state('');
	let registerError = $state('');
	let registerLoading = $state(false);

	// Login flow state
	let loginUsername = $state('');
	let loginPassword = $state('');
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

		if (regPassword.length < 8) {
			registerError = 'Password must be at least 8 characters';
			return;
		}
		if (regPassword !== regPasswordConfirm) {
			registerError = 'Passwords do not match';
			return;
		}

		registerLoading = true;
		try {
			const res = await fetch('/api/auth/register', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					code: validatedCode,
					username: regUsername.trim(),
					password: regPassword,
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

	async function submitLogin() {
		loginError = '';
		loginLoading = true;
		try {
			const res = await fetch('/api/auth/login', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					username: loginUsername.trim(),
					password: loginPassword
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
			loginError = 'Network error';
		} finally {
			loginLoading = false;
		}
	}

	function handleInviteKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') submitInviteCode();
	}

	function handleRegisterKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && regUsername.trim().length >= 2 && regPassword.length >= 8 && regPassword === regPasswordConfirm) submitRegister();
	}

	function handleLoginKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && loginUsername.trim() && loginPassword) submitLogin();
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
			<div class="text-center">
				<button
					onclick={() => { step = 'login'; }}
					class="text-xs text-(--color-accent) hover:underline cursor-pointer"
				>
					Already have an account? Log in
				</button>
			</div>
		</div>
	</div>
{:else if step === 'register'}
	<div class="flex min-h-screen items-center justify-center bg-(--color-bg)">
		<div class="flex w-full max-w-sm flex-col gap-5 rounded-xl border border-(--color-border) bg-(--color-surface) px-8 py-10">
			<div class="flex flex-col gap-1.5">
				<h1 class="text-lg font-semibold text-(--color-text)">Create Account</h1>
				<p class="text-sm text-(--color-text-secondary)">Choose a username and password.</p>
			</div>
			<div class="flex flex-col gap-3">
				<input
					type="text"
					bind:value={regUsername}
					onkeydown={handleRegisterKeydown}
					placeholder="Username (2-32 chars)"
					maxlength={32}
					class="w-full rounded-lg border border-(--color-border) bg-(--color-bg) px-3.5 py-2.5 text-sm text-(--color-text) placeholder:text-(--color-text-tertiary) focus:border-(--color-accent) focus:outline-none"
					autofocus
				/>
				<input
					type="password"
					bind:value={regPassword}
					onkeydown={handleRegisterKeydown}
					placeholder="Password (min 8 chars)"
					class="w-full rounded-lg border border-(--color-border) bg-(--color-bg) px-3.5 py-2.5 text-sm text-(--color-text) placeholder:text-(--color-text-tertiary) focus:border-(--color-accent) focus:outline-none"
				/>
				<input
					type="password"
					bind:value={regPasswordConfirm}
					onkeydown={handleRegisterKeydown}
					placeholder="Confirm password"
					class="w-full rounded-lg border border-(--color-border) bg-(--color-bg) px-3.5 py-2.5 text-sm text-(--color-text) placeholder:text-(--color-text-tertiary) focus:border-(--color-accent) focus:outline-none"
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
					disabled={registerLoading || regUsername.trim().length < 2 || regPassword.length < 8 || regPassword !== regPasswordConfirm}
					class="rounded-lg bg-(--color-accent) px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-(--color-accent)/90 disabled:opacity-50 cursor-pointer"
				>
					{registerLoading ? 'Creating account...' : 'Create Account & Agree'}
				</button>
			</div>
			<div class="text-center">
				<button
					onclick={() => { step = 'invite'; }}
					class="text-xs text-(--color-text-secondary) hover:underline cursor-pointer"
				>
					Back
				</button>
			</div>
		</div>
	</div>
{:else if step === 'login'}
	<div class="flex min-h-screen items-center justify-center bg-(--color-bg)">
		<div class="flex w-full max-w-sm flex-col gap-5 rounded-xl border border-(--color-border) bg-(--color-surface) px-8 py-10">
			<div class="flex flex-col gap-1.5">
				<h1 class="text-lg font-semibold text-(--color-text)">Welcome Back</h1>
				<p class="text-sm text-(--color-text-secondary)">Log in to your account.</p>
			</div>
			<div class="flex flex-col gap-3">
				<input
					type="text"
					bind:value={loginUsername}
					onkeydown={handleLoginKeydown}
					placeholder="Username"
					class="w-full rounded-lg border border-(--color-border) bg-(--color-bg) px-3.5 py-2.5 text-sm text-(--color-text) placeholder:text-(--color-text-tertiary) focus:border-(--color-accent) focus:outline-none"
					autofocus
				/>
				<input
					type="password"
					bind:value={loginPassword}
					onkeydown={handleLoginKeydown}
					placeholder="Password"
					class="w-full rounded-lg border border-(--color-border) bg-(--color-bg) px-3.5 py-2.5 text-sm text-(--color-text) placeholder:text-(--color-text-tertiary) focus:border-(--color-accent) focus:outline-none"
				/>
				{#if loginError}
					<p class="text-xs text-(--color-red)">{loginError}</p>
				{/if}
				<button
					onclick={submitLogin}
					disabled={loginLoading || !loginUsername.trim() || !loginPassword}
					class="rounded-lg bg-(--color-accent) px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-(--color-accent)/90 disabled:opacity-50 cursor-pointer"
				>
					{loginLoading ? 'Logging in...' : 'Log In'}
				</button>
			</div>
			<div class="text-center">
				<button
					onclick={() => { step = 'invite'; }}
					class="text-xs text-(--color-accent) hover:underline cursor-pointer"
				>
					New user? Enter invite code
				</button>
			</div>
		</div>
	</div>
{:else}
	{@render children()}
{/if}
