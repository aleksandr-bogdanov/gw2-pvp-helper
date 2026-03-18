<script lang="ts">
	import '../app.css';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { browser } from '$app/environment';
	import LoginGate from '$lib/components/LoginGate.svelte';

	let { children } = $props();

	const themes = [
		{ id: 'legacy', label: 'Legacy' },
		{ id: 'whendoist-light', label: 'Light' },
		{ id: 'whendoist-dark', label: 'Dark' }
	] as const;

	type ThemeId = (typeof themes)[number]['id'];

	let currentTheme = $state<ThemeId>('legacy');

	// Load saved theme on mount
	if (browser) {
		const saved = localStorage.getItem('gw2-theme') as ThemeId | null;
		if (saved && themes.some((t) => t.id === saved)) {
			currentTheme = saved;
		}
	}

	// Apply theme to <html> whenever it changes
	$effect(() => {
		if (!browser) return;
		const html = document.documentElement;
		if (currentTheme === 'legacy') {
			html.removeAttribute('data-theme');
		} else {
			html.setAttribute('data-theme', currentTheme);
		}
		localStorage.setItem('gw2-theme', currentTheme);
	});

	function cycleTheme() {
		const idx = themes.findIndex((t) => t.id === currentTheme);
		currentTheme = themes[(idx + 1) % themes.length].id;
	}

	let scanning = $state(false);
	let scanError = $state('');
	let scanStep = $state(0); // 0=finding, 1=classifying, 2=reading, 3=detecting

	const scanSteps = [
		'Finding scoreboard...',
		'Classifying specs...',
		'Reading names...',
		'Detecting map...'
	];

	async function handlePaste(e: ClipboardEvent) {
		const items = e.clipboardData?.items;
		if (!items) return;

		let file: File | null = null;
		for (const item of items) {
			if (item.type.startsWith('image/')) {
				file = item.getAsFile();
				break;
			}
		}

		if (!file) {
			const files = e.clipboardData?.files;
			if (files) {
				for (const f of files) {
					if (f.type.startsWith('image/')) {
						file = f;
						break;
					}
				}
			}
		}

		if (!file) return;
		e.preventDefault();

		const mediaType = file.type || 'image/png';
		scanning = true;
		scanError = '';
		scanStep = 0;

		// Timed animation: advance steps every ~800ms to approximate pipeline stages
		const stepTimer = setInterval(() => {
			scanStep = Math.min(scanStep + 1, scanSteps.length - 1);
		}, 800);

		try {
			const buffer = await file.arrayBuffer();
			const base64 = btoa(
				new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
			);

			const res = await fetch('/api/scan', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ image: base64, mediaType })
			});

			if (!res.ok) {
				const err = await res.json();
				throw new Error(err.message ?? 'Scan failed');
			}

			const result = await res.json();
			sessionStorage.setItem('scanResult', JSON.stringify(result));
			goto('/last-match');
		} catch (err) {
			scanError = err instanceof Error ? err.message : 'Scan failed';
		} finally {
			clearInterval(stepTimer);
			scanning = false;
		}
	}
</script>

<svelte:window onpaste={handlePaste} />

<LoginGate>
<div class="min-h-screen bg-(--color-bg)">
	<!-- Navbar -->
	<nav class="glass sticky top-0 z-40 border-b border-(--color-border) shadow-sm">
		<div class="mx-auto max-w-3xl flex items-center justify-between px-6 py-3">
			<a href="/" class="text-base font-semibold tracking-tight text-(--color-text) hover:text-(--color-accent) transition-colors">
				GW2 PvP Helper
			</a>
			<div class="flex items-center gap-4">
				{#each [
					{ href: '/last-match', label: 'Last Match' },
					{ href: '/history', label: 'History' },
					{ href: '/players', label: 'Players' },
					{ href: '/profiles', label: 'Profiles' }
				] as link}
					<a
						href={link.href}
						class="text-sm transition-colors {page.url.pathname.startsWith(link.href)
							? 'text-(--color-accent) font-medium'
							: 'text-(--color-text-secondary) hover:text-(--color-text)'}"
					>
						{link.label}
					</a>
				{/each}
				<button
					onclick={cycleTheme}
					class="ml-2 rounded-md border border-(--color-border) bg-(--color-surface)/60 px-2.5 py-1 text-xs font-medium text-(--color-text-secondary) transition-all hover:bg-(--color-surface-hover) hover:text-(--color-text) hover:shadow-sm cursor-pointer"
					title="Cycle theme: {themes.find((t) => t.id === currentTheme)?.label}"
				>
					{themes.find((t) => t.id === currentTheme)?.label}
				</button>
			</div>
		</div>
	</nav>

	{#if scanning}
		<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
			<div class="glass flex flex-col gap-4 rounded-xl p-8 border border-(--color-border) min-w-72 shadow-xl animate-modal-in">
				<p class="text-base font-semibold text-(--color-text)">Scanning...</p>
				<div class="flex flex-col gap-2">
					{#each scanSteps as step, i}
						<div class="flex items-center gap-2.5 text-sm">
							{#if i < scanStep}
								<span class="text-(--color-green) text-base">&#10003;</span>
								<span class="text-(--color-text-secondary)">{step.replace('...', '')}</span>
							{:else if i === scanStep}
								<span class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-(--color-accent) border-t-transparent"></span>
								<span class="text-(--color-text)">{step}</span>
							{:else}
								<span class="h-4 w-4 rounded-full border border-(--color-border)"></span>
								<span class="text-(--color-text-tertiary)">{step}</span>
							{/if}
						</div>
					{/each}
				</div>
			</div>
		</div>
	{/if}

	{#if scanError}
		<div class="fixed top-16 right-4 z-50 rounded-xl bg-(--color-red)/15 border border-(--color-red)/30 px-4 py-3 text-(--color-red) text-sm flex items-center gap-2 shadow-lg animate-slide-down">
			<span>{scanError}</span>
			<button class="opacity-60 hover:opacity-100 cursor-pointer transition-opacity" onclick={() => (scanError = '')}>&#10005;</button>
		</div>
	{/if}

	<main class="mx-auto {page.url.pathname.startsWith('/players') ? 'max-w-6xl' : 'max-w-3xl'} px-6 py-5">
		{@render children()}
	</main>
</div>
</LoginGate>
