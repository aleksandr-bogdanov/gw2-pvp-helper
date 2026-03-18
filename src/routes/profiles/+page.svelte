<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { specs, getProfessionColor } from '$lib/game-data.js';

	interface Profile {
		id: number;
		characterName: string;
		profession: string;
		spec: string;
		buildLabel: string | null;
		role: string;
		weaponsMain: string | null;
		weaponsSwap: string | null;
		profilePrompt: string | null;
		isActive: boolean;
	}

	let profiles = $state<Profile[]>([]);
	let loading = $state(true);
	let deleteConfirm = $state<number | null>(null);

	onMount(async () => {
		await loadProfiles();
	});

	async function loadProfiles() {
		loading = true;
		const res = await fetch('/api/profiles');
		if (res.ok) {
			profiles = await res.json();
		}
		loading = false;
	}

	async function setActive(id: number) {
		await fetch('/api/profiles', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id, setActive: true })
		});
		await loadProfiles();
	}

	async function deleteProfile(id: number) {
		await fetch('/api/profiles', {
			method: 'DELETE',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id })
		});
		deleteConfirm = null;
		await loadProfiles();
	}

	function getProfessionLabel(profId: string): string {
		return specs.professions[profId]?.label ?? profId;
	}

	function getSpecLabel(profId: string, specId: string): string {
		const spec = specs.professions[profId]?.specs.find(s => s.id === specId);
		return spec?.label ?? specId;
	}

	function getSpecIconUrl(specId: string, professionId: string): string {
		return `/icons/specs/${specId === 'core' ? professionId : specId}.png`;
	}
</script>

<div class="mx-auto max-w-2xl {profiles.length <= 2 && !loading ? 'mt-[10vh]' : ''}">
	{#if loading}
		<div class="flex justify-center py-12">
			<div class="h-6 w-6 animate-spin rounded-full border-2 border-(--color-accent) border-t-transparent"></div>
		</div>
	{:else if profiles.length === 0}
		<div class="rounded-xl border border-(--color-border) bg-(--color-surface) p-6 text-center">
			<p class="text-sm text-(--color-text-secondary) mb-1">No profiles yet.</p>
			<p class="text-xs text-(--color-text-tertiary) mb-4">
				Create a character profile to get personalized tactical advice for your build.
			</p>
			<a
				href="/profiles/create"
				class="btn-cta inline-block rounded-xl px-5 py-2.5 text-sm"
			>
				+ Add Character
			</a>
		</div>
	{:else}
		<div class="flex flex-col gap-3">
			{#each profiles as profile}
				<div class="rounded-xl border border-l-3 p-4 transition-all
					{profile.isActive
						? 'border-(--color-accent)/50 ring-1 ring-(--color-accent)/30'
						: 'border-(--color-border)'}"
					style="border-left-color: {getProfessionColor(profile.profession)}; background-color: color-mix(in srgb, {getProfessionColor(profile.profession)} 6%, transparent);">
					<div class="flex items-start gap-3">
						<!-- Spec icon -->
						<img
							src={getSpecIconUrl(profile.spec, profile.profession)}
							alt={getSpecLabel(profile.profession, profile.spec)}
							class="h-10 w-10 spec-icon flex-shrink-0 mt-0.5"
						/>

						<div class="flex-1 min-w-0">
							<!-- Line 1: Build label or spec name -->
							<div class="flex items-center gap-2">
								{#if profile.isActive}
									<span class="text-[10px] font-bold uppercase tracking-wider text-(--color-accent) bg-(--color-accent)/10 rounded-full px-2 py-0.5">Active</span>
								{/if}
								<span class="font-mono text-sm font-medium text-(--color-text) truncate">
									{profile.buildLabel || getSpecLabel(profile.profession, profile.spec)}
								</span>
							</div>

							<!-- Line 2: Character name + details -->
							<div class="flex items-center gap-1.5 mt-0.5 text-xs text-(--color-text-secondary)">
								<span>{profile.characterName}</span>
								<span class="text-(--color-text-tertiary)">&middot;</span>
								<span>{getProfessionLabel(profile.profession)}</span>
								<span class="text-(--color-text-tertiary)">&middot;</span>
								<span>{profile.role}</span>
							</div>

							<!-- Line 3: Weapons -->
							{#if profile.weaponsMain}
								<div class="mt-0.5 text-xs text-(--color-text-tertiary)">
									{profile.weaponsMain}{profile.weaponsSwap ? ` + ${profile.weaponsSwap}` : ''}
								</div>
							{/if}

							{#if profile.profilePrompt}
								<p class="mt-1.5 text-[11px] text-(--color-text-tertiary) line-clamp-2 leading-relaxed">
									{profile.profilePrompt.slice(0, 150)}{profile.profilePrompt.length > 150 ? '...' : ''}
								</p>
							{/if}
						</div>

						<!-- Actions -->
						<div class="flex items-center gap-2 flex-shrink-0">
							{#if !profile.isActive}
								<button
									class="text-xs text-(--color-text-secondary) hover:text-(--color-accent) transition-colors cursor-pointer px-2 py-1 rounded border border-(--color-border) hover:border-(--color-accent)/40"
									onclick={() => setActive(profile.id)}
								>
									Set Active
								</button>
							{/if}
							<a
								href="/profiles/create?edit={profile.id}"
								class="text-xs text-(--color-text-secondary) hover:text-(--color-text) transition-colors px-2 py-1 rounded border border-(--color-border) hover:border-(--color-border-strong)"
							>
								Edit
							</a>
							{#if deleteConfirm === profile.id}
								<button
									class="text-xs text-(--color-red) hover:text-(--color-red)/80 transition-colors cursor-pointer px-2 py-1 rounded border border-(--color-red)/30"
									onclick={() => deleteProfile(profile.id)}
								>
									Confirm
								</button>
								<button
									class="text-xs text-(--color-text-tertiary) hover:text-(--color-text-secondary) transition-colors cursor-pointer"
									onclick={() => (deleteConfirm = null)}
								>
									Cancel
								</button>
							{:else}
								<button
									class="text-xs text-(--color-text-tertiary) hover:text-(--color-red) transition-colors cursor-pointer px-2 py-1"
									onclick={() => (deleteConfirm = profile.id)}
									title="Delete profile"
								>
									&#10005;
								</button>
							{/if}
						</div>
					</div>

					<!-- Profile prompt indicator -->
					{#if !profile.profilePrompt}
						<div class="mt-2 text-[10px] text-(--color-amber)/80 bg-(--color-amber)/5 rounded px-2 py-1">
							Profile prompt not generated — edit to complete setup
						</div>
					{/if}
				</div>
			{/each}

			<a
				href="/profiles/create"
				class="rounded-xl border border-dashed border-(--color-border) bg-(--color-surface)/50 py-3 text-center text-sm font-medium text-(--color-text-secondary) hover:border-(--color-accent)/40 hover:text-(--color-accent) transition-colors"
			>
				+ Add Character
			</a>

			<!-- Guidance -->
			<div class="mt-4 rounded-lg border border-(--color-border)/50 bg-(--color-surface)/50 px-4 py-3 text-center">
				<p class="text-xs text-(--color-text-tertiary) leading-relaxed">
					Your active character determines the tactical advice you receive during matches.
					Add profiles for each build you play — the advisor will tailor strategy to your specific weapons, skills, and playstyle.
				</p>
			</div>
		</div>
	{/if}
</div>
