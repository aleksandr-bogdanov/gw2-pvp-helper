<script lang="ts">
	let apiKeyInput = $state('');
	let hasKey = $state(false);
	let selectedModel = $state('claude-sonnet-4-6');
	let adviceRemaining = $state<number | null>(null);
	let profileRemaining = $state<number | null>(null);
	let saving = $state(false);
	let testing = $state(false);
	let message = $state('');
	let messageType = $state<'success' | 'error'>('success');

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

	$effect(() => {
		loadState();
	});

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
	<h1 class="mb-6 text-2xl font-bold text-white">Settings</h1>

	{#if message}
		<div
			class="mb-4 rounded px-4 py-2 text-sm {messageType === 'success'
				? 'bg-green-900/50 text-green-300'
				: 'bg-red-900/50 text-red-300'}"
		>
			{message}
		</div>
	{/if}

	<!-- Usage Stats -->
	<section class="mb-8 rounded-lg bg-zinc-800/50 p-5">
		<h2 class="mb-3 text-lg font-semibold text-zinc-200">Usage</h2>
		<div class="grid grid-cols-2 gap-4 text-sm">
			<div>
				<span class="text-zinc-400">Advice calls:</span>
				{#if hasKey}
					<span class="ml-2 text-green-400">Unlimited (BYOK)</span>
				{:else}
					<span class="ml-2 text-yellow-300">{adviceRemaining ?? '...'} remaining</span>
				{/if}
			</div>
			<div>
				<span class="text-zinc-400">Profile generations:</span>
				{#if hasKey}
					<span class="ml-2 text-green-400">Unlimited (BYOK)</span>
				{:else}
					<span class="ml-2 text-yellow-300">{profileRemaining ?? '...'} remaining</span>
				{/if}
			</div>
		</div>
	</section>

	<!-- API Key -->
	<section class="mb-8 rounded-lg bg-zinc-800/50 p-5">
		<h2 class="mb-3 text-lg font-semibold text-zinc-200">Anthropic API Key</h2>
		<p class="mb-3 text-sm text-zinc-400">
			Add your own Anthropic API key for unlimited access. Your key is encrypted at rest.
		</p>

		{#if hasKey}
			<div class="flex items-center gap-3">
				<span class="text-sm text-green-400">Key saved</span>
				<button
					onclick={deleteApiKey}
					disabled={saving}
					class="rounded bg-red-700 px-3 py-1.5 text-sm text-white hover:bg-red-600 disabled:opacity-50"
				>
					Remove Key
				</button>
			</div>
		{:else}
			<div class="flex gap-2">
				<input
					type="password"
					bind:value={apiKeyInput}
					placeholder="sk-ant-..."
					class="flex-1 rounded bg-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:ring-2 focus:ring-amber-500 focus:outline-none"
				/>
				<button
					onclick={saveApiKey}
					disabled={saving || !apiKeyInput.trim()}
					class="rounded bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-50"
				>
					{saving ? 'Validating...' : 'Save Key'}
				</button>
			</div>
		{/if}
	</section>

	<!-- Model Selection -->
	<section class="mb-8 rounded-lg bg-zinc-800/50 p-5">
		<h2 class="mb-3 text-lg font-semibold text-zinc-200">Model</h2>
		<p class="mb-3 text-sm text-zinc-400">
			Choose which Claude model to use for advice. Requires your own API key.
		</p>
		<div class="flex items-center gap-3">
			<select
				bind:value={selectedModel}
				onchange={updateModel}
				disabled={!hasKey}
				class="rounded bg-zinc-700 px-3 py-2 text-sm text-white disabled:opacity-50"
			>
				<option value="claude-sonnet-4-6">Claude Sonnet 4.6 (fast, recommended)</option>
				<option value="claude-opus-4-6">Claude Opus 4.6 (highest quality)</option>
			</select>
			{#if !hasKey}
				<span class="text-xs text-zinc-500">Add API key to unlock</span>
			{/if}
		</div>
	</section>

	<!-- Danger Zone -->
	<section class="rounded-lg border border-red-900/50 bg-zinc-900/50 p-5">
		<h2 class="mb-3 text-lg font-semibold text-red-400">Danger Zone</h2>
		<button
			onclick={deleteAccount}
			class="rounded bg-red-800 px-4 py-2 text-sm text-white hover:bg-red-700"
		>
			Delete My Account
		</button>
		<p class="mt-2 text-xs text-zinc-500">
			Permanently deletes your account, profiles, matches, and all associated data.
		</p>
	</section>
</div>
