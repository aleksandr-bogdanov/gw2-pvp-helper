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

	let isAdmin = $state(false);
	let currentUsername = $state('');
	let userMenuOpen = $state(false);

	if (browser) {
		fetch('/api/auth/me').then(r => r.ok ? r.json() : null).then(data => {
			if (data?.user?.role === 'admin') isAdmin = true;
			if (data?.user?.username) currentUsername = data.user.username;
		}).catch(() => {});
	}

	async function handleLogout() {
		await fetch('/api/auth/logout', { method: 'POST' });
		window.location.href = '/';
	}

	let scanning = $state(false);
	let scanError = $state('');
	let scanStep = $state(0);

	const scanSteps = [
		'Loading image...',
		'Finding scoreboard...',
		'Detecting map...',
		'Classifying specs...',
		'Reading names...'
	];

	/** Beta flag: upload ALL screenshots regardless of confidence */
	const BETA_UPLOAD_ALL = true;

	/** Core scan pipeline — shared by paste and drag-and-drop */
	async function runScan(file: File) {
		scanning = true;
		scanError = '';
		scanStep = 0;

		try {
			const { scanScreenshotClient, hasLowConfidence, blobToJpegBase64 } =
				await import('$lib/scan-client/index.js');

			const scanResult = await scanScreenshotClient(file, (step, _msg) => {
				scanStep = step;
			});

			const jpegBase64 = await blobToJpegBase64(file);
			const shouldUpload = BETA_UPLOAD_ALL || hasLowConfidence(scanResult);

			if (shouldUpload) {
				const bitmap = await createImageBitmap(file);
				const resolution = `${bitmap.width}x${bitmap.height}`;
				bitmap.close();

				const res = await fetch('/api/scan/upload', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						image: jpegBase64,
						scanResult,
						resolution
					})
				});

				if (res.ok) {
					const enrichedResult = await res.json();
					sessionStorage.setItem('scanResult', JSON.stringify(enrichedResult));
					goto('/last-match');
					return;
				}
			}

			sessionStorage.setItem('scanResult', JSON.stringify(scanResult));
			goto('/last-match');
		} catch (err) {
			scanError = err instanceof Error ? err.message : 'Scan failed';
		} finally {
			scanning = false;
		}
	}

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
		runScan(file);
	}

	let dragOver = $state(false);

	function handleDragOver(e: DragEvent) {
		if (e.dataTransfer?.types.includes('Files')) {
			e.preventDefault();
			dragOver = true;
		}
	}

	function handleDragLeave() {
		dragOver = false;
	}

	function handleDrop(e: DragEvent) {
		e.preventDefault();
		dragOver = false;

		const files = e.dataTransfer?.files;
		if (!files) return;

		for (const f of files) {
			if (f.type.startsWith('image/')) {
				runScan(f);
				return;
			}
		}
	}
</script>

<svelte:window onpaste={handlePaste} ondragover={handleDragOver} ondragleave={handleDragLeave} ondrop={handleDrop} />

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

				<!-- User menu -->
				{#if currentUsername}
					<div class="relative">
						<button
							onclick={() => { userMenuOpen = !userMenuOpen; }}
							class="flex items-center gap-1.5 rounded-md border border-(--color-border) bg-(--color-surface)/60 px-2.5 py-1 text-xs font-medium text-(--color-text-secondary) transition-all hover:bg-(--color-surface-hover) hover:text-(--color-text) cursor-pointer"
						>
							{currentUsername}
							<svg class="h-3 w-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M19 9l-7 7-7-7"/></svg>
						</button>

						{#if userMenuOpen}
							<!-- Backdrop to close menu -->
							<button class="fixed inset-0 z-40 cursor-default" onclick={() => { userMenuOpen = false; }} tabindex="-1" aria-label="Close menu"></button>

							<div class="absolute right-0 top-full mt-1 z-50 w-44 rounded-lg border border-(--color-border) bg-(--color-surface) py-1 shadow-lg">
								<a
									href="/settings"
									class="block px-3 py-2 text-xs text-(--color-text-secondary) hover:bg-(--color-surface-hover) hover:text-(--color-text) transition-colors"
									onclick={() => { userMenuOpen = false; }}
								>
									Settings
								</a>
								{#if isAdmin}
									<a
										href="/admin"
										class="block px-3 py-2 text-xs text-(--color-text-secondary) hover:bg-(--color-surface-hover) hover:text-(--color-text) transition-colors"
										onclick={() => { userMenuOpen = false; }}
									>
										Admin
									</a>
								{/if}
								<div class="my-1 border-t border-(--color-border)"></div>
								<button
									onclick={handleLogout}
									class="w-full text-left px-3 py-2 text-xs text-(--color-red) hover:bg-(--color-surface-hover) transition-colors cursor-pointer"
								>
									Log out
								</button>
							</div>
						{/if}
					</div>
				{/if}
			</div>
		</div>
	</nav>

	{#if dragOver}
		<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm pointer-events-none">
			<div class="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-(--color-accent) bg-(--color-surface)/80 px-12 py-10">
				<svg class="h-10 w-10 text-(--color-accent)" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"/></svg>
				<p class="text-base font-semibold text-(--color-text)">Drop screenshot to scan</p>
			</div>
		</div>
	{/if}

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

	<main class="mx-auto {page.url.pathname.startsWith('/players') || page.url.pathname.startsWith('/admin') ? 'max-w-6xl' : 'max-w-3xl'} px-6 py-5">
		{@render children()}
	</main>
</div>
</LoginGate>
