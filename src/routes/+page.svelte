<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { specs } from '$lib/game-data.js';

	let dragOver = $state(false);

	interface ActiveProfile {
		id: number;
		characterName: string;
		profession: string;
		spec: string;
		buildLabel: string | null;
		role: string;
	}

	let activeProfile = $state<ActiveProfile | null>(null);
	let allProfiles = $state<(ActiveProfile & { isActive: boolean })[]>([]);
	let hasProfiles = $state(false);
	let switchingProfile = $state(false);

	onMount(async () => {
		const res = await fetch('/api/profiles');
		if (res.ok) {
			const profiles = await res.json();
			allProfiles = profiles;
			hasProfiles = profiles.length > 0;
			activeProfile = profiles.find((p: ActiveProfile & { isActive: boolean }) => p.isActive) ?? null;

			// Feature 5: First-launch redirect
			if (profiles.length === 0) {
				goto('/profiles/create');
				return;
			}
		}
	});

	async function switchProfile(profileId: number) {
		if (switchingProfile) return;
		switchingProfile = true;
		try {
			const res = await fetch('/api/profiles', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id: profileId, setActive: true })
			});
			if (res.ok) {
				activeProfile = allProfiles.find(p => p.id === profileId) ?? null;
			}
		} finally {
			switchingProfile = false;
		}
	}

	function handleDragOver(e: DragEvent) {
		e.preventDefault();
		e.dataTransfer!.dropEffect = 'copy';
		dragOver = true;
	}

	function handleDragLeave() {
		dragOver = false;
	}

	async function handleDrop(e: DragEvent) {
		e.preventDefault();
		dragOver = false;
		const file = e.dataTransfer?.files[0];
		if (!file || !file.type.startsWith('image/')) return;

		const buffer = await file.arrayBuffer();
		const base64 = btoa(
			new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
		);

		const res = await fetch('/api/scan', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ image: base64, mediaType: file.type })
		});

		if (res.ok) {
			const result = await res.json();
			sessionStorage.setItem('scanResult', JSON.stringify(result));
			goto('/last-match');
		}
	}

	function getSpecLabel(profId: string, specId: string): string {
		const spec = specs.professions[profId]?.specs.find(s => s.id === specId);
		return spec?.label ?? specId;
	}

	function getSpecIconUrl(specId: string, professionId: string): string {
		return `/icons/specs/${specId === 'core' ? professionId : specId}.png`;
	}
</script>

<div
	class="flex min-h-[calc(100vh-57px)] flex-col"
	ondragover={handleDragOver}
	ondragleave={handleDragLeave}
	ondrop={handleDrop}
	role="application"
>
	<!-- Center content -->
	<div class="flex flex-1 flex-col items-center justify-center gap-5 pb-24">
		<!-- Paste card -->
		<div
			class="flex w-full max-w-md flex-col items-center gap-5 rounded-xl border bg-(--color-surface) px-12 py-14 transition-all
				{dragOver
					? 'border-(--color-accent) bg-(--color-accent)/5'
					: 'border-(--color-border)'}"
		>
			<div class="flex flex-col items-center gap-3">
				<kbd
					class="rounded-lg bg-(--color-bg) px-5 py-2.5 font-mono text-xl font-bold text-(--color-accent) border border-(--color-border-strong)"
				>
					Ctrl+V
				</kbd>
				<p class="text-base font-medium text-(--color-text)">paste to scout match</p>
			</div>
			<p class="text-sm text-(--color-text-tertiary)">or drop image here</p>
		</div>

		<!-- Active character selector -->
		{#if allProfiles.length > 1}
			<div class="w-full max-w-md">
				<select
					class="w-full appearance-none rounded-xl border border-(--color-border) bg-(--color-surface) px-4 py-2.5 text-sm text-(--color-text) font-mono cursor-pointer focus:border-(--color-accent) focus:outline-none transition-colors"
					value={activeProfile?.id ?? ''}
					onchange={(e) => {
						const id = parseInt((e.currentTarget as HTMLSelectElement).value);
						if (id) switchProfile(id);
					}}
					disabled={switchingProfile}
				>
					{#if !activeProfile}
						<option value="" disabled>Select character...</option>
					{/if}
					{#each allProfiles as profile}
						<option value={profile.id}>
							{profile.buildLabel || getSpecLabel(profile.profession, profile.spec)} — {profile.characterName} · {profile.role}
						</option>
					{/each}
				</select>
			</div>
		{:else if activeProfile}
			<div class="flex w-full max-w-md items-center gap-3 rounded-xl border border-(--color-border) bg-(--color-surface) px-4 py-2.5">
				<img
					src={getSpecIconUrl(activeProfile.spec, activeProfile.profession)}
					alt=""
					class="h-6 w-6 spec-icon flex-shrink-0"
				/>
				<div class="flex-1 min-w-0">
					<span class="text-sm font-mono font-medium text-(--color-text)">
						{activeProfile.buildLabel || getSpecLabel(activeProfile.profession, activeProfile.spec)}
					</span>
					<span class="text-xs text-(--color-text-tertiary) ml-1.5">
						{activeProfile.characterName} &middot; {activeProfile.role}
					</span>
				</div>
				<span class="text-[10px] font-medium text-(--color-accent) bg-(--color-accent)/10 rounded-full px-2 py-0.5">Active</span>
			</div>
		{:else if hasProfiles}
			<a
				href="/profiles"
				class="flex w-full max-w-md items-center justify-center gap-2 rounded-xl border border-(--color-amber)/30 bg-(--color-amber)/5 px-4 py-2.5 text-sm text-(--color-amber) hover:bg-(--color-amber)/10 transition-colors"
			>
				No active character — set one in Profiles
			</a>
		{:else}
			<a
				href="/profiles/create"
				class="flex w-full max-w-md items-center justify-center gap-2 rounded-xl border border-(--color-accent)/30 bg-(--color-accent)/5 px-4 py-2.5 text-sm text-(--color-accent) hover:bg-(--color-accent)/10 transition-colors"
			>
				Create your first character profile
			</a>
		{/if}
	</div>
</div>
