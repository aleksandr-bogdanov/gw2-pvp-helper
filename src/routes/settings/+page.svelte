<script lang="ts">
	import { onMount } from 'svelte';

	let apiKeyInput = $state('');
	let hasKey = $state(false);
	let selectedModel = $state('claude-sonnet-4-6');
	let adviceRemaining = $state<number | null>(null);
	let profileRemaining = $state<number | null>(null);
	let saving = $state(false);
	let testing = $state(false);
	let message = $state('');
	let messageType = $state<'success' | 'error'>('success');

	onMount(() => {
		loadState();
	});

	async function loadState() {
		try {
			const [keyRes, meRes] = await Promise.all([
				fetch('/api/settings/api-key'),
				fetch('/api/auth/me')
			]);
			if (keyRes.ok) {
				const data = await keyRes.json();
				hasKey = data.hasKey;
			}
			if (meRes.ok) {
				const data = await meRes.json();
				adviceRemaining = data.user?.adviceCallsRemaining ?? null;
				profileRemaining = data.user?.profileGensRemaining ?? null;
				selectedModel = data.user?.byokModelPreference ?? 'claude-sonnet-4-6';
			}
		} catch {
			// silently fail
		}
	}

	function showMessage(text: string, type: 'success' | 'error') {
		message = text;
		messageType = type;
		setTimeout(() => (message = ''), 4000);
	}

	async function saveApiKey() {
		if (!apiKeyInput.trim()) return;
		saving = true;
		try {
			const res = await fetch('/api/settings/api-key', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ apiKey: apiKeyInput.trim() })
			});
			const data = await res.json();
			if (res.ok) {
				hasKey = true;
				apiKeyInput = '';
				showMessage('API key saved and validated', 'success');
			} else {
				showMessage(data.error ?? 'Failed to save key', 'error');
			}
		} catch {
			showMessage('Network error', 'error');
		} finally {
			saving = false;
		}
	}

	async function deleteApiKey() {
		saving = true;
		try {
			const res = await fetch('/api/settings/api-key', { method: 'DELETE' });
			if (res.ok) {
				hasKey = false;
				selectedModel = 'claude-sonnet-4-6';
				showMessage('API key removed', 'success');
			}
		} catch {
			showMessage('Network error', 'error');
		} finally {
			saving = false;
		}
	}

	async function updateModel() {
		try {
			const res = await fetch('/api/settings/model', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ model: selectedModel })
			});
			const data = await res.json();
			if (res.ok) {
				showMessage(`Model set to ${selectedModel}`, 'success');
			} else {
				showMessage(data.error ?? 'Failed to update model', 'error');
			}
		} catch {
			showMessage('Network error', 'error');
		}
	}

	async function deleteAccount() {
		if (!confirm('Delete your account? This removes all your data permanently.')) return;
		try {
			const res = await fetch('/api/users/me', { method: 'DELETE' });
			if (res.ok) {
				window.location.href = '/';
			}
		} catch {
			showMessage('Failed to delete account', 'error');
		}
	}
</script>

<svelte:head>
	<title>Settings — GW2 PvP Helper</title>
</svelte:head>

<div class="mx-auto max-w-2xl p-6">
	<h1 class="mb-6 text-2xl font-bold text-(--color-text)">Settings</h1>

	{#if message}
		<div
			role="alert"
			aria-live="assertive"
			class="mb-4 rounded px-4 py-2 text-sm {messageType === 'success'
				? 'bg-(--color-green)/10 text-(--color-green)'
				: 'bg-(--color-red)/10 text-(--color-red)'}"
		>
			{message}
		</div>
	{/if}

	<!-- Usage Stats -->
	<section class="mb-8 rounded-lg bg-(--color-surface)/50 p-5" aria-labelledby="usage-heading">
		<h2 id="usage-heading" class="mb-3 text-lg font-semibold text-(--color-text-secondary)">Usage</h2>
		<div class="grid grid-cols-2 gap-4 text-sm">
			<div>
				<span class="text-(--color-text-tertiary)">Advice calls:</span>
				{#if hasKey}
					<span class="ml-2 text-(--color-green)">Unlimited (BYOK)</span>
				{:else}
					<span class="ml-2 text-(--color-amber)">{adviceRemaining ?? '...'} remaining</span>
				{/if}
			</div>
			<div>
				<span class="text-(--color-text-tertiary)">Profile generations:</span>
				{#if hasKey}
					<span class="ml-2 text-(--color-green)">Unlimited (BYOK)</span>
				{:else}
					<span class="ml-2 text-(--color-amber)">{profileRemaining ?? '...'} remaining</span>
				{/if}
			</div>
		</div>
	</section>

	<!-- API Key -->
	<section class="mb-8 rounded-lg bg-(--color-surface)/50 p-5" aria-labelledby="apikey-heading">
		<h2 id="apikey-heading" class="mb-3 text-lg font-semibold text-(--color-text-secondary)">Anthropic API Key</h2>
		<p class="mb-3 text-sm text-(--color-text-tertiary)">
			Add your own Anthropic API key for unlimited access. Your key is encrypted at rest.
		</p>

		{#if hasKey}
			<div class="flex items-center gap-3">
				<span class="text-sm text-(--color-green)">Key saved</span>
				<button
					onclick={deleteApiKey}
					disabled={saving}
					class="rounded bg-(--color-red) px-3 py-1.5 text-sm text-white hover:opacity-80 disabled:opacity-50 cursor-pointer"
				>
					Remove Key
				</button>
			</div>
		{:else}
			<div class="flex gap-2">
				<label for="api-key-input" class="sr-only">Anthropic API Key</label>
				<input
					id="api-key-input"
					type="password"
					bind:value={apiKeyInput}
					placeholder="sk-ant-..."
					autocomplete="off"
					class="flex-1 rounded bg-(--color-surface-raised) px-3 py-2 text-sm text-(--color-text) placeholder:text-(--color-text-dim) focus:ring-2 focus:ring-(--color-accent) focus:outline-none"
				/>
				<button
					onclick={saveApiKey}
					disabled={saving || !apiKeyInput.trim()}
					class="rounded bg-(--color-accent) px-4 py-2 text-sm font-medium text-white hover:bg-(--color-accent-hover) disabled:opacity-50 cursor-pointer"
				>
					{saving ? 'Validating...' : 'Save Key'}
				</button>
			</div>
		{/if}
	</section>

	<!-- Model Selection -->
	<section class="mb-8 rounded-lg bg-(--color-surface)/50 p-5" aria-labelledby="model-heading">
		<h2 id="model-heading" class="mb-3 text-lg font-semibold text-(--color-text-secondary)">Model</h2>
		<p class="mb-3 text-sm text-(--color-text-tertiary)">
			Choose which Claude model to use for advice. Requires your own API key.
		</p>
		<div class="flex items-center gap-3">
			<label for="model-select" class="sr-only">Claude model</label>
			<select
				id="model-select"
				bind:value={selectedModel}
				onchange={updateModel}
				disabled={!hasKey}
				class="rounded bg-(--color-surface-raised) px-3 py-2 text-sm text-(--color-text) disabled:opacity-50 cursor-pointer"
			>
				<option value="claude-sonnet-4-6">Claude Sonnet 4.6 (fast, recommended)</option>
				<option value="claude-opus-4-6">Claude Opus 4.6 (highest quality)</option>
			</select>
			{#if !hasKey}
				<span class="text-xs text-(--color-text-dim)">Add API key to unlock</span>
			{/if}
		</div>
	</section>

	<!-- Danger Zone -->
	<section class="rounded-lg border border-(--color-red)/30 bg-(--color-surface)/30 p-5" aria-labelledby="danger-heading">
		<h2 id="danger-heading" class="mb-3 text-lg font-semibold text-(--color-red)">Danger Zone</h2>
		<button
			onclick={deleteAccount}
			aria-describedby="delete-description"
			class="rounded bg-(--color-red)/80 px-4 py-2 text-sm text-white hover:bg-(--color-red) cursor-pointer"
		>
			Delete My Account
		</button>
		<p id="delete-description" class="mt-2 text-xs text-(--color-text-dim)">
			Permanently deletes your account, profiles, matches, and all associated data.
		</p>
	</section>
</div>
