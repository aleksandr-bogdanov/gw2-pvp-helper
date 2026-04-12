<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';

	// Profession data for the showcase
	const professions = [
		{ id: 'guardian', label: 'Guardian', color: 'var(--prof-guardian)' },
		{ id: 'warrior', label: 'Warrior', color: 'var(--prof-warrior)' },
		{ id: 'revenant', label: 'Revenant', color: 'var(--prof-revenant)' },
		{ id: 'ranger', label: 'Ranger', color: 'var(--prof-ranger)' },
		{ id: 'thief', label: 'Thief', color: 'var(--prof-thief)' },
		{ id: 'engineer', label: 'Engineer', color: 'var(--prof-engineer)' },
		{ id: 'necromancer', label: 'Necromancer', color: 'var(--prof-necromancer)' },
		{ id: 'mesmer', label: 'Mesmer', color: 'var(--prof-mesmer)' },
		{ id: 'elementalist', label: 'Elementalist', color: 'var(--prof-elementalist)' }
	];

	// Sample elite specs for showcase
	const sampleSpecs = [
		'dragonhunter', 'firebrand', 'willbender', 'bladesworn', 'berserker', 'spellbreaker',
		'herald', 'renegade', 'vindicator', 'soulbeast', 'druid', 'untamed',
		'daredevil', 'deadeye', 'specter', 'holosmith', 'scrapper', 'mechanist',
		'reaper', 'scourge', 'harbinger', 'chronomancer', 'mirage', 'virtuoso',
		'tempest', 'weaver', 'catalyst'
	];

	const features = [
		{
			icon: '🔍',
			title: 'Computer Vision',
			desc: 'Client-side elite spec detection with 97.5% accuracy. No screenshot leaves your browser.',
			accent: 'var(--color-accent)'
		},
		{
			icon: '🧠',
			title: 'AI Tactical Advice',
			desc: 'Claude analyzes team compositions, player history, and map — streams a personalized briefing.',
			accent: 'var(--color-green)'
		},
		{
			icon: '📊',
			title: 'Match History',
			desc: 'Track wins, losses, and patterns. Review past advice and see how compositions played out.',
			accent: 'var(--color-amber)'
		},
		{
			icon: '🎯',
			title: 'Player Scouting',
			desc: 'Tag players as friend or avoid. Build a database of opponents with win rates and tendencies.',
			accent: 'var(--color-red)'
		}
	];

	const steps = [
		{ num: '01', title: 'Paste', desc: 'Ctrl+V your PvP scoreboard screenshot during the pre-match timer', icon: 'M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184' },
		{ num: '02', title: 'Detect', desc: 'CV pipeline identifies all 10 players\' elite specs and reads their names in under a second', icon: 'M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178zM15 12a3 3 0 11-6 0 3 3 0 016 0z' },
		{ num: '03', title: 'Review', desc: 'Verify the detected roster. Correct any misidentifications to improve accuracy over time', icon: 'M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
		{ num: '04', title: 'Get Advice', desc: 'AI streams a tactical briefing: target priority, role assignments, win condition, and danger zones', icon: 'M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z' }
	];

	const stats = [
		{ value: 45, suffix: '', label: 'Elite Specs Detected' },
		{ value: 97.5, suffix: '%', label: 'Classification Accuracy' },
		{ value: 1, suffix: 's', prefix: '<', label: 'Scan Time' }
	];

	// Animated counter state
	let countersVisible = $state(false);
	let animatedValues = $state<number[]>(stats.map(() => 0));

	// Intersection observer for scroll animations
	let visibleSections = $state<Set<string>>(new Set());

	onMount(() => {
		if (!browser) return;

		const observer = new IntersectionObserver(
			(entries) => {
				entries.forEach((entry) => {
					const id = entry.target.getAttribute('data-section');
					if (!id) return;
					if (entry.isIntersecting) {
						visibleSections = new Set([...visibleSections, id]);

						// Trigger counter animation
						if (id === 'stats' && !countersVisible) {
							countersVisible = true;
							animateCounters();
						}
					}
				});
			},
			{ threshold: 0.2 }
		);

		document.querySelectorAll('[data-section]').forEach((el) => observer.observe(el));

		return () => observer.disconnect();
	});

	function animateCounters() {
		const duration = 1500;
		const start = performance.now();

		function tick() {
			const elapsed = performance.now() - start;
			const progress = Math.min(elapsed / duration, 1);
			// Ease out cubic
			const eased = 1 - Math.pow(1 - progress, 3);

			animatedValues = stats.map((s) => {
				const val = s.value * eased;
				return s.suffix === '%' ? Math.round(val * 10) / 10 : Math.round(val);
			});

			if (progress < 1) requestAnimationFrame(tick);
		}
		requestAnimationFrame(tick);
	}

	// Check if user is already authenticated
	let isAuthenticated = $state(false);
	onMount(async () => {
		try {
			const res = await fetch('/api/auth/me');
			if (res.ok) {
				const data = await res.json();
				if (data.user) isAuthenticated = true;
			}
		} catch {
			// not authenticated
		}
	});
</script>

<svelte:head>
	<title>GW2 PvP Helper — AI-Powered Match Scouting</title>
	<meta name="description" content="Paste a PvP scoreboard screenshot. Get AI tactical advice in 60 seconds. Detect elite specs, track opponents, win more matches." />
</svelte:head>

<div class="min-h-screen bg-(--color-bg) overflow-x-hidden">
	<!-- ═══ HERO SECTION ═══ -->
	<section class="relative flex min-h-screen flex-col items-center justify-center px-6" data-section="hero">
		<!-- Animated grid background -->
		<div class="pointer-events-none absolute inset-0 overflow-hidden">
			<div class="landing-grid absolute inset-0 opacity-[0.04]"></div>
			<div class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full bg-(--color-accent)/5 blur-[120px]"></div>
			<div class="absolute right-1/4 top-1/4 w-[400px] h-[400px] rounded-full bg-(--color-green)/3 blur-[100px]"></div>
		</div>

		<div class="relative z-10 flex flex-col items-center gap-8 text-center max-w-3xl {visibleSections.has('hero') ? 'animate-slide-up' : 'opacity-0'}">
			<!-- Badge -->
			<div class="flex items-center gap-2 rounded-full border border-(--color-accent)/20 bg-(--color-accent)/5 px-4 py-1.5">
				<span class="h-2 w-2 rounded-full bg-(--color-green) animate-pulse"></span>
				<span class="text-xs font-medium text-(--color-accent)">Open Beta — Guild Wars 2 PvP</span>
			</div>

			<!-- Headline -->
			<h1 class="text-5xl font-bold leading-tight tracking-tight text-(--color-text)">
				AI-Powered
				<br />
				<span class="bg-gradient-to-r from-(--color-accent) to-(--color-green) bg-clip-text text-transparent">
					PvP Scouting
				</span>
			</h1>

			<!-- Subtext -->
			<p class="max-w-lg text-lg text-(--color-text-secondary) leading-relaxed">
				Paste a scoreboard screenshot during the <span class="font-mono font-semibold text-(--color-accent)">60-second</span> pre-match timer.
				Get a tactical briefing before the gates open.
			</p>

			<!-- CTA buttons -->
			<div class="flex items-center gap-4">
				<a href={isAuthenticated ? '/app' : '#get-started'} class="btn-cta rounded-xl px-8 py-3.5 text-base font-semibold">
					{isAuthenticated ? 'Open App' : 'Get Started'}
				</a>
				<a href="#how-it-works" class="rounded-xl border border-(--color-border) bg-(--color-surface)/60 px-6 py-3.5 text-base font-medium text-(--color-text-secondary) hover:bg-(--color-surface-hover) hover:text-(--color-text) transition-all">
					How It Works
				</a>
			</div>

			<!-- Scroll hint -->
			<div class="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 text-(--color-text-tertiary)">
				<span class="text-xs tracking-wider uppercase">Scroll</span>
				<svg class="h-5 w-5 animate-bounce" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
				</svg>
			</div>
		</div>
	</section>

	<!-- ═══ HOW IT WORKS ═══ -->
	<section id="how-it-works" class="relative py-28 px-6" data-section="how-it-works">
		<div class="mx-auto max-w-4xl">
			<div class="text-center mb-16 {visibleSections.has('how-it-works') ? 'animate-slide-up' : 'opacity-0'}">
				<p class="text-xs font-bold uppercase tracking-[0.2em] text-(--color-accent) mb-3">The Pipeline</p>
				<h2 class="text-3xl font-bold text-(--color-text)">Four Steps. Sixty Seconds.</h2>
			</div>

			<div class="relative">
				<!-- Connecting line -->
				<div class="absolute left-[39px] top-0 bottom-0 w-px bg-gradient-to-b from-(--color-accent)/40 via-(--color-accent)/20 to-transparent hidden md:block"></div>

				<div class="flex flex-col gap-12">
					{#each steps as step, i}
						<div
							class="relative flex items-start gap-8 transition-all duration-700 {visibleSections.has('how-it-works') ? 'translate-x-0 opacity-100' : 'translate-x-8 opacity-0'}"
							style="transition-delay: {i * 150}ms"
						>
							<!-- Step number -->
							<div class="relative z-10 flex h-20 w-20 flex-shrink-0 items-center justify-center rounded-2xl border border-(--color-accent)/30 bg-(--color-surface)">
								<span class="font-mono text-2xl font-bold text-(--color-accent)">{step.num}</span>
							</div>

							<!-- Content -->
							<div class="flex-1 pt-2">
								<div class="flex items-center gap-3 mb-2">
									<svg class="h-5 w-5 text-(--color-accent)" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
										<path stroke-linecap="round" stroke-linejoin="round" d={step.icon} />
									</svg>
									<h3 class="text-xl font-bold text-(--color-text)">{step.title}</h3>
								</div>
								<p class="text-sm text-(--color-text-secondary) leading-relaxed max-w-md">{step.desc}</p>
							</div>
						</div>
					{/each}
				</div>
			</div>
		</div>
	</section>

	<!-- ═══ FEATURES ═══ -->
	<section class="py-28 px-6" data-section="features">
		<div class="mx-auto max-w-5xl">
			<div class="text-center mb-16 {visibleSections.has('features') ? 'animate-slide-up' : 'opacity-0'}">
				<p class="text-xs font-bold uppercase tracking-[0.2em] text-(--color-accent) mb-3">Features</p>
				<h2 class="text-3xl font-bold text-(--color-text)">Everything You Need to Win</h2>
			</div>

			<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
				{#each features as feature, i}
					<div
						class="glass rounded-2xl border border-(--color-border) p-8 transition-all duration-700 hover:border-({feature.accent})/30 hover:shadow-lg group {visibleSections.has('features') ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0'}"
						style="transition-delay: {i * 100}ms"
					>
						<div class="flex items-center gap-4 mb-4">
							<span class="text-3xl">{feature.icon}</span>
							<h3 class="text-lg font-bold text-(--color-text)">{feature.title}</h3>
						</div>
						<p class="text-sm text-(--color-text-secondary) leading-relaxed">{feature.desc}</p>
						<div class="mt-4 h-0.5 w-12 rounded-full transition-all duration-500 group-hover:w-24" style="background: {feature.accent}"></div>
					</div>
				{/each}
			</div>
		</div>
	</section>

	<!-- ═══ PROFESSION SHOWCASE ═══ -->
	<section class="py-28 px-6" data-section="professions">
		<div class="mx-auto max-w-5xl">
			<div class="text-center mb-16 {visibleSections.has('professions') ? 'animate-slide-up' : 'opacity-0'}">
				<p class="text-xs font-bold uppercase tracking-[0.2em] text-(--color-accent) mb-3">Coverage</p>
				<h2 class="text-3xl font-bold text-(--color-text)">All Professions. All Elite Specs.</h2>
				<p class="mt-3 text-sm text-(--color-text-tertiary)">45 elite specializations detected and classified from scoreboard screenshots</p>
			</div>

			<!-- Profession icons row -->
			<div class="flex justify-center gap-6 mb-12 flex-wrap {visibleSections.has('professions') ? 'animate-slide-up' : 'opacity-0'}">
				{#each professions as prof, i}
					<div
						class="group flex flex-col items-center gap-2 transition-all duration-500"
						style="transition-delay: {i * 60}ms; {visibleSections.has('professions') ? '' : 'transform: translateY(16px); opacity: 0'}"
					>
						<div
							class="flex h-16 w-16 items-center justify-center rounded-xl border border-(--color-border) bg-(--color-surface) transition-all group-hover:scale-110 group-hover:shadow-lg"
							style="--hover-border: {prof.color}"
						>
							<img
								src="/icons/specs/{prof.id}.png"
								alt={prof.label}
								class="h-10 w-10 spec-icon transition-transform group-hover:scale-110"
							/>
						</div>
						<span class="text-[10px] font-bold uppercase tracking-wider text-(--color-text-tertiary) group-hover:text-(--color-text) transition-colors" style="color: {prof.color}">{prof.label}</span>
					</div>
				{/each}
			</div>

			<!-- Elite spec grid (subtle) -->
			<div class="flex flex-wrap justify-center gap-2 {visibleSections.has('professions') ? 'animate-fade-in' : 'opacity-0'}" style="animation-delay: 0.5s">
				{#each sampleSpecs as spec}
					<div class="flex items-center gap-1.5 rounded-lg border border-(--color-border)/50 bg-(--color-surface)/50 px-2.5 py-1">
						<img src="/icons/specs/{spec}.png" alt="" class="h-4 w-4 spec-icon" />
						<span class="text-[10px] font-medium text-(--color-text-tertiary) capitalize">{spec.replace(/([A-Z])/g, ' $1').trim()}</span>
					</div>
				{/each}
			</div>
		</div>
	</section>

	<!-- ═══ STATS ═══ -->
	<section class="py-28 px-6" data-section="stats">
		<div class="mx-auto max-w-3xl">
			<div class="grid grid-cols-3 gap-6 {visibleSections.has('stats') ? 'animate-slide-up' : 'opacity-0'}">
				{#each stats as stat, i}
					<div class="flex flex-col items-center gap-2 rounded-2xl border border-(--color-border) bg-(--color-surface) p-8 text-center">
						<span class="font-mono text-4xl font-bold text-(--color-accent)">
							{stat.prefix ?? ''}{animatedValues[i]}{stat.suffix}
						</span>
						<span class="text-xs font-bold uppercase tracking-wider text-(--color-text-tertiary)">{stat.label}</span>
					</div>
				{/each}
			</div>
		</div>
	</section>

	<!-- ═══ FINAL CTA ═══ -->
	<section id="get-started" class="py-28 px-6" data-section="cta">
		<div class="mx-auto max-w-lg text-center {visibleSections.has('cta') ? 'animate-slide-up' : 'opacity-0'}">
			<h2 class="text-3xl font-bold text-(--color-text) mb-4">Ready to Scout?</h2>
			<p class="text-sm text-(--color-text-secondary) mb-8">
				Log in with your GW2 API key and start getting tactical advice.
			</p>

			{#if isAuthenticated}
				<a href="/app" class="btn-cta inline-block rounded-xl px-10 py-4 text-base font-semibold">
					Open App
				</a>
			{:else}
				<a href="/app" class="btn-cta inline-block rounded-xl px-10 py-4 text-base font-semibold">
					Log In with GW2 API Key
				</a>
			{/if}
		</div>
	</section>

	<!-- ═══ FOOTER ═══ -->
	<footer class="border-t border-(--color-border) py-8 px-6">
		<div class="mx-auto max-w-4xl flex items-center justify-between">
			<div class="flex items-center gap-3">
				<span class="text-sm font-semibold text-(--color-text-tertiary)">GW2 PvP Helper</span>
			</div>
			<div class="flex items-center gap-4 text-xs text-(--color-text-tertiary)">
				<span>SvelteKit + Claude AI</span>
				<span class="text-(--color-border)">|</span>
				<span>Not affiliated with ArenaNet</span>
			</div>
		</div>
	</footer>
</div>

<style>
	.landing-grid {
		background-image:
			linear-gradient(var(--color-accent) 1px, transparent 1px),
			linear-gradient(90deg, var(--color-accent) 1px, transparent 1px);
		background-size: 60px 60px;
	}
</style>
