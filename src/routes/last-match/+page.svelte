<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import type { ScanResult, PlayerInfo } from '$lib/types.js';
	import {
		maps,
		specs,
		getSpecsForProfession,
		getSpecLabel,
		getProfessionLabel,
		getProfessionColor,
		getDefaultRole,
		cycleSpec,
		getStolenSkill
	} from '$lib/game-data.js';

	// --- Interfaces (same as history page) ---
	interface MatchPlayer {
		characterName: string;
		team: string;
		profession: string;
		spec: string;
		role: string;
		isUser: boolean;
		ratingSkill: number | null;
		ratingFriendly: number | null;
		tag: string | null;
	}

	interface MatchRecord {
		matchId: string;
		userTeamColor: string | null;
		map: string | null;
		result: string | null;
		screenshotHash: string | null;
		screenshotUrl: string | null;
		adviceText: string | null;
		timestamp: string;
		players: MatchPlayer[];
	}

	interface ParsedAdvice {
		focusOrder: string;
		babysit: string;
		mapAdvice: string;
		gameplan: string;
		positioning: string;
		enemyAdvice: { threat: string; advice: string; dont_hit?: string }[];
		allyAdvice: { advice?: string }[];
	}

	// --- Scan confidence metadata per player (preserved from sessionStorage) ---
	interface ScanMeta {
		spec_confidence?: number;
		name_confidence?: number;
		top_candidates?: { specId: string; professionId: string; confidence: number }[];
		icon_crop_base64?: string;
		spec_source?: string;
	}

	// --- State ---
	let scanResult = $state<ScanResult | null>(null);
	let redTeam = $state<PlayerInfo[]>([]);
	let blueTeam = $state<PlayerInfo[]>([]);
	let selectedMap = $state('conquest_generic');
	let mapAutoDetected = $state(false);
	let userTeamColor = $state<'red' | 'blue'>('red');

	// Match state (post-creation, display uses MatchRecord format)
	let match = $state<MatchRecord | null>(null);
	let matchId = $state<string | null>(null);
	let screenshotUrl = $state<string | null>(null);
	let screenshotHash = $state<string | null>(null);
	let zoomedScreenshot = $state<string | null>(null);

	// Scan metadata indexed by "team-index" key
	let scanMetaMap = $state<Map<string, ScanMeta>>(new Map());

	// Editing state (uses history page's matchId-based approach, adapted for single match)
	let editingName = $state<{ matchId: string; characterName: string } | null>(null);
	let specPickerOpen = $state<{ matchId: string; characterName: string } | null>(null);
	let pickerProfession = $state<string | null>(null);
	let editingMap = $state<boolean>(false);
	let updatingResult = $state<boolean>(false);
	let deletingMatch = $state<boolean>(false);

	// Advice state
	let adviceLoading = $state(false);
	let adviceReady = $state(false);
	let adviceError = $state('');
	let adviceElapsed = $state(0);
	let adviceTimer = $state<ReturnType<typeof setInterval> | null>(null);

	// Streaming advice (pre-match-record, used during SSE streaming)
	let streamEnemyAdvice = $state<{ threat: string; advice: string; dont_hit?: string }[]>([]);
	let streamAllyAdvice = $state<{ advice?: string }[]>([]);
	let streamFocusOrder = $state('');
	let streamMapAdvice = $state('');
	let streamGameplan = $state('');
	let streamBabysit = $state('');
	let streamPositioning = $state('');

	// Profile switch notice
	let profileSwitchNotice = $state('');
	let userProfession = $state('');
	let recordingResult = $state(false);

	// --- Confidence thresholds ---
	const SPEC_HIGH = 0.62;
	const SPEC_MED = 0.58;
	const NAME_HIGH = 75;
	const NAME_MED = 40;

	// --- GW2 character name rules ---
	// GW2 names: 3-19 chars, starts with uppercase, each word starts with uppercase,
	// no consecutive uppercase letters (each uppercase starts a new word).
	// Allowed: letters, spaces, hyphens, apostrophes. No numbers, no special chars.
	function guessGW2Name(rawOcr: string): string {
		if (!rawOcr || rawOcr.startsWith('Unknown Player')) return rawOcr;
		// Remove non-letter/space/hyphen/apostrophe chars
		let cleaned = rawOcr.replace(/[^A-Za-z\u00C0-\u00FF '\-]/g, '');
		if (!cleaned) return rawOcr;
		// Insert space before each uppercase that follows a lowercase (GW2 rule: no consecutive uppers without space)
		cleaned = cleaned.replace(/([a-z\u00E0-\u00FF])([A-Z\u00C0-\u00DE])/g, '$1 $2');
		// Capitalize first letter of each word, lowercase rest
		cleaned = cleaned.replace(/\b([a-zA-Z\u00C0-\u00FF])/g, (_, c) => c.toUpperCase())
			.replace(/(?<=\b[A-Z\u00C0-\u00DE])([A-Z\u00C0-\u00DE]+)/g, (m) => m.toLowerCase());
		// Trim and collapse multiple spaces
		cleaned = cleaned.replace(/\s+/g, ' ').trim();
		return cleaned || rawOcr;
	}

	// --- Derived ---
	let myTeam = $derived(userTeamColor === 'red' ? redTeam : blueTeam);
	let enemyTeam = $derived(userTeamColor === 'red' ? blueTeam : redTeam);

	interface FlaggedIssue {
		type: 'spec' | 'name';
		player: PlayerInfo;
		team: 'red' | 'blue';
		index: number;
		meta: PlayerInfo;
		guessedName?: string;
	}

	function getFlaggedIssues(): FlaggedIssue[] {
		const specIssues: FlaggedIssue[] = [];
		const nameIssues: FlaggedIssue[] = [];
		for (const [team, players] of [['red', redTeam], ['blue', blueTeam]] as const) {
			for (let i = 0; i < players.length; i++) {
				const p = players[i];
				if (specNeedsReview(p)) {
					specIssues.push({ type: 'spec', player: p, team, index: i, meta: p });
				}
				if (nameNeedsReview(p)) {
					nameIssues.push({
						type: 'name', player: p, team, index: i, meta: p,
						guessedName: guessGW2Name(p.character_name)
					});
				}
			}
		}
		return [...specIssues, ...nameIssues];
	}

	let flaggedIssues = $derived(getFlaggedIssues());
	let issueCount = $derived(flaggedIssues.length);

	// Auto-trigger Get Advice when all issues resolved
	let autoAdviceTriggered = $state(false);
	$effect(() => {
		if (issueCount === 0 && redTeam.length > 0 && !adviceLoading && !adviceReady && !autoAdviceTriggered) {
			autoAdviceTriggered = true;
			getAdvice();
		}
	});

	function specNeedsReview(p: PlayerInfo): boolean {
		if (p.spec_source === 'corrected') return false;
		return (p.spec_confidence ?? 1) < SPEC_HIGH;
	}

	function nameNeedsReview(p: PlayerInfo): boolean {
		if (p.character_name.startsWith('Unknown Player')) return true;
		return (p.name_confidence ?? 100) < NAME_MED;
	}

	function specConfidenceLevel(p: PlayerInfo): 'high' | 'medium' | 'low' {
		if (p.spec_source === 'corrected') return 'high';
		const c = p.spec_confidence ?? 1;
		if (c >= SPEC_HIGH) return 'high';
		if (c >= SPEC_MED) return 'medium';
		return 'low';
	}

	function nameConfidenceLevel(p: PlayerInfo): 'high' | 'medium' | 'low' {
		if (p.character_name.startsWith('Unknown Player')) return 'low';
		const c = p.name_confidence ?? 100;
		if (c >= NAME_HIGH) return 'high';
		if (c >= NAME_MED) return 'medium';
		return 'low';
	}

	function rowConfidenceLevel(p: PlayerInfo): 'high' | 'medium' | 'low' {
		const spec = specConfidenceLevel(p);
		const name = nameConfidenceLevel(p);
		if (spec === 'low' || name === 'low') return 'low';
		if (spec === 'medium' || name === 'medium') return 'medium';
		return 'high';
	}

	// --- Spec icon helpers (same as history page) ---
	function getSpecIconUrl(specId: string, professionId?: string): string {
		const id = specId === 'core' && professionId ? professionId : specId;
		return `/icons/specs/${id}.png`;
	}

	function specIconStyle(specId: string, professionId: string): string {
		const url = getSpecIconUrl(specId, professionId);
		const color = getProfessionColor(professionId);
		return `background-color: ${color}; -webkit-mask-image: url(${url}); mask-image: url(${url}); -webkit-mask-size: contain; mask-size: contain; -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;`;
	}

	function getMapName(mapId: string | null): string {
		if (!mapId) return 'Unknown';
		return maps.find((m) => m.id === mapId)?.name ?? mapId;
	}

	function getMapMode(mapId: string | null): string | null {
		if (!mapId) return null;
		return maps.find((m) => m.id === mapId)?.mode ?? null;
	}

	function getModeColor(mode: string): string {
		switch (mode) {
			case 'conquest': return 'text-(--color-accent)/70 bg-(--color-accent)/10';
			case 'push': return 'text-(--color-amber)/70 bg-(--color-amber)/10';
			case 'stronghold': return 'text-(--color-red)/70 bg-(--color-red)/10';
			default: return 'text-(--color-text-tertiary) bg-(--color-surface-raised)';
		}
	}

	// --- Player history helpers ---
	function getHistoryBadge(p: PlayerInfo): { label: string; color: string } | null {
		if (p.is_user) return null;
		const seen = p.times_seen ?? 0;
		if (seen === 0) return { label: 'NEW', color: 'text-(--color-text-tertiary) bg-(--color-surface-raised)' };
		if (seen >= 1 && p.spec_source === 'corrected') {
			return { label: `seen ${seen}x`, color: 'text-(--color-green) bg-(--color-green)/10' };
		}
		return { label: `seen ${seen}x`, color: 'text-(--color-amber) bg-(--color-amber)/10' };
	}

	function getWLRecord(p: PlayerInfo): string | null {
		const w = p.wins_against ?? 0;
		const l = p.losses_against ?? 0;
		if (w === 0 && l === 0) return null;
		return `${w}W ${l}L`;
	}

	// --- Init ---
	onMount(async () => {
		const stored = sessionStorage.getItem('scanResult');

		if (stored) {
			// Fresh scan — load from sessionStorage
			const result: ScanResult = JSON.parse(stored);
			scanResult = result;
			redTeam = result.red_team;
			blueTeam = result.blue_team;
			userTeamColor = result.user_team_color;

			if (result.detected_map && result.detected_map.confidence > 0.2) {
				selectedMap = result.detected_map.mapId;
				mapAutoDetected = true;
			}

			screenshotUrl = result.screenshotUrl ?? null;
			screenshotHash = result.screenshotHash ?? null;

			// Store scan confidence metadata per player for correction panel
			const meta = new Map<string, ScanMeta>();
			for (let i = 0; i < result.red_team.length; i++) {
				const p = result.red_team[i];
				meta.set(`red-${i}`, {
					spec_confidence: p.spec_confidence,
					name_confidence: p.name_confidence,
					top_candidates: p.top_candidates,
					icon_crop_base64: p.icon_crop_base64,
					spec_source: p.spec_source
				});
			}
			for (let i = 0; i < result.blue_team.length; i++) {
				const p = result.blue_team[i];
				meta.set(`blue-${i}`, {
					spec_confidence: p.spec_confidence,
					name_confidence: p.name_confidence,
					top_candidates: p.top_candidates,
					icon_crop_base64: p.icon_crop_base64,
					spec_source: p.spec_source
				});
			}
			scanMetaMap = meta;

			// Apply best-guess GW2 name formatting for OCR results (not "Unknown Player" placeholders)
			for (const team of [redTeam, blueTeam]) {
				for (let i = 0; i < team.length; i++) {
					const name = team[i].character_name;
					if (!name.startsWith('Unknown Player') && (team[i].name_confidence ?? 100) < NAME_HIGH) {
						const guessed = guessGW2Name(name);
						if (guessed !== name) {
							team[i] = { ...team[i], character_name: guessed, name_confidence: 100 };
						}
					}
				}
			}

			// Profile auto-switch
			const userPlayer = [...result.red_team, ...result.blue_team].find((p) => p.is_user);
			if (userPlayer) {
				userProfession = userPlayer.profession_id;
				await tryAutoSwitchProfile(userPlayer.profession_id);
			}

			// Persist match to DB immediately so refreshes recover it
			await upsertRosterPlayers();
			matchId = await saveMatch();
			if (matchId) {
				sessionStorage.setItem('lastMatchId', matchId);
			}
		} else {
			// No sessionStorage — try to recover from DB (refresh scenario)
			const savedMatchId = sessionStorage.getItem('lastMatchId');
			const recovered = await recoverMatchFromDB(savedMatchId);
			if (!recovered) {
				goto('/');
				return;
			}
		}
	});

	/** Recover last match from DB — used on page refresh */
	async function recoverMatchFromDB(savedMatchId: string | null): Promise<boolean> {
		try {
			let matchData: MatchRecord | null = null;

			if (savedMatchId) {
				// Fetch specific match by ID
				const res = await fetch(`/api/match?limit=50`);
				if (!res.ok) return false;
				const data = await res.json();
				matchData = data.matches?.find((m: MatchRecord) => m.matchId === savedMatchId) ?? null;
			}

			if (!matchData) {
				// Fall back to most recent match
				const res = await fetch('/api/match?limit=1');
				if (!res.ok) return false;
				const data = await res.json();
				matchData = data.matches?.[0] ?? null;
			}

			if (!matchData || matchData.players.length === 0) return false;

			// Restore state from DB match
			matchId = matchData.matchId;
			match = matchData;
			selectedMap = matchData.map ?? 'conquest_generic';
			userTeamColor = (matchData.userTeamColor ?? 'red') as 'red' | 'blue';
			screenshotUrl = matchData.screenshotUrl ?? null;
			screenshotHash = matchData.screenshotHash ?? null;

			// Rebuild redTeam/blueTeam from match players for pre-advice display
			const red = matchData.players.filter((p) => p.team === 'red');
			const blue = matchData.players.filter((p) => p.team === 'blue');
			redTeam = red.map(mpToPlayerInfo);
			blueTeam = blue.map(mpToPlayerInfo);

			// If advice already exists, show it
			if (matchData.adviceText) {
				adviceReady = true;
			}

			return true;
		} catch {
			return false;
		}
	}

	/** Convert a MatchPlayer (DB format) back to PlayerInfo (scan format) */
	function mpToPlayerInfo(mp: MatchPlayer): PlayerInfo {
		return {
			character_name: mp.characterName,
			profession_id: mp.profession,
			spec_id: mp.spec,
			role: mp.role,
			is_user: mp.isUser,
			spec_confidence: 1.0,
			name_confidence: 100,
			spec_source: 'corrected',
			tag: mp.tag
		} as PlayerInfo;
	}

	// --- Profile auto-switch ---
	async function tryAutoSwitchProfile(detectedProfession: string) {
		try {
			const res = await fetch('/api/profiles');
			if (!res.ok) return;
			const profiles = await res.json();
			const active = profiles.find((p: { isActive: boolean }) => p.isActive);
			if (active && active.profession === detectedProfession) return;

			const found = profiles.find(
				(p: { profession: string }) => p.profession === detectedProfession
			);
			if (!found) return;

			const switchRes = await fetch('/api/profiles', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id: found.id, setActive: true })
			});
			if (switchRes.ok) {
				profileSwitchNotice = `Switched to ${found.buildLabel || found.characterName} (${detectedProfession})`;
				setTimeout(() => (profileSwitchNotice = ''), 5000);
			}
		} catch {
			// non-critical
		}
	}

	// --- Spec/Name editing (pre-advice, works on PlayerInfo arrays) ---
	function handleSpecClickScan(team: 'red' | 'blue', index: number) {
		const key = `scan-${team}-${index}`;
		if (specPickerOpen?.matchId === key && specPickerOpen?.characterName === String(index)) {
			specPickerOpen = null;
			pickerProfession = null;
		} else {
			const players = team === 'red' ? redTeam : blueTeam;
			specPickerOpen = { matchId: key, characterName: String(index) };
			pickerProfession = players[index].profession_id;
			// Scroll to the player row so the picker is visible
			tick().then(() => {
				const row = document.querySelector(`[data-player-row="${team}-${index}"]`);
				row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
			});
		}
	}

	function selectSpecScan(team: 'red' | 'blue', index: number, profId: string, newSpecId: string) {
		const players = team === 'red' ? redTeam : blueTeam;
		players[index] = {
			...players[index],
			profession_id: profId,
			spec_id: newSpecId,
			role: getDefaultRole(profId, newSpecId),
			spec_source: 'corrected',
			spec_confidence: 1.0
		};
		specPickerOpen = null;
		pickerProfession = null;
		persistRosterToDB();
	}

	function handleRoleToggle(team: 'red' | 'blue', index: number) {
		const players = team === 'red' ? redTeam : blueTeam;
		const player = players[index];
		const specInfo = getSpecsForProfession(player.profession_id).find(
			(s) => s.id === player.spec_id
		);
		if (!specInfo?.roles || specInfo.roles.length < 2) return;
		const currentIdx = specInfo.roles.indexOf(player.role);
		const nextIdx = (currentIdx + 1) % specInfo.roles.length;
		players[index] = { ...player, role: specInfo.roles[nextIdx] };
	}

	function hasRoleToggle(player: PlayerInfo): boolean {
		const specInfo = getSpecsForProfession(player.profession_id).find(
			(s) => s.id === player.spec_id
		);
		return !!specInfo?.roles && specInfo.roles.length > 1;
	}

	async function startNameEditScan(team: 'red' | 'blue', index: number) {
		editingName = { matchId: `scan-${team}`, characterName: String(index) };
		await tick();
		const input = document.getElementById(`name-input-${team}-${index}`) as HTMLInputElement;
		input?.select();
	}

	function commitNameEditScan(team: 'red' | 'blue', index: number, value: string) {
		const players = team === 'red' ? redTeam : blueTeam;
		const trimmed = value.trim();
		if (trimmed) {
			players[index] = {
				...players[index],
				character_name: trimmed,
				name_confidence: 100
			};
		}
		editingName = null;
		persistRosterToDB();
	}

	function handleNameKeydownScan(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			(e.currentTarget as HTMLInputElement).blur();
		} else if (e.key === 'Escape') {
			editingName = null;
		}
	}

	// --- Post-advice editing (works on MatchRecord) ---
	async function updateMatchPlayer(characterName: string, updates: Record<string, unknown>) {
		if (!matchId) return;
		try {
			await fetch('/api/match/ratings', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					matchId,
					ratings: [{ characterName, ...updates }]
				})
			});
		} catch { /* non-critical */ }
	}

	function findPlayer(characterName: string): number {
		if (!match) return -1;
		return match.players.findIndex(p => p.characterName === characterName);
	}

	async function startNameEdit(characterName: string) {
		if (!match) return;
		editingName = { matchId: match.matchId, characterName };
		await tick();
		const input = document.getElementById(`name-edit-${match.matchId}-${characterName}`) as HTMLInputElement;
		input?.select();
	}

	function commitNameEdit(oldName: string, newName: string) {
		const trimmed = newName.trim();
		if (!trimmed || trimmed === oldName || !match) { editingName = null; return; }

		const idx = findPlayer(oldName);
		if (idx >= 0) {
			match = {
				...match,
				players: match.players.map((p, i) => i === idx ? { ...p, characterName: trimmed } : p)
			};
		}
		updateMatchPlayer(oldName, { newCharacterName: trimmed });
		editingName = null;
	}

	function handleNameKeydown(e: KeyboardEvent, oldName: string) {
		if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
		else if (e.key === 'Escape') editingName = null;
	}

	function openSpecPicker(p: MatchPlayer) {
		if (!match) return;
		if (specPickerOpen?.matchId === match.matchId && specPickerOpen?.characterName === p.characterName) {
			specPickerOpen = null;
			pickerProfession = null;
		} else {
			specPickerOpen = { matchId: match.matchId, characterName: p.characterName };
			pickerProfession = p.profession;
		}
	}

	function selectSpec(characterName: string, profId: string, specId: string) {
		if (!match) return;
		const idx = findPlayer(characterName);
		if (idx >= 0) {
			match = {
				...match,
				players: match.players.map((p, i) => i === idx ? { ...p, profession: profId, spec: specId } : p)
			};
		}
		updateMatchPlayer(characterName, { profession: profId, spec: specId });
		specPickerOpen = null;
		pickerProfession = null;
	}

	function setPlayerRating(characterName: string, type: 'ratingSkill' | 'ratingFriendly', value: number) {
		if (!match) return;
		const idx = findPlayer(characterName);
		if (idx < 0) return;
		const p = match.players[idx];
		const current = p[type];
		const newVal = current === value ? null : value;
		match = {
			...match,
			players: match.players.map((pl, i) => i === idx ? { ...pl, [type]: newVal } : pl)
		};
		updateMatchPlayer(characterName, { [type]: newVal });
	}

	function toggleTag(characterName: string, tag: 'friend' | 'avoid') {
		if (!match) return;
		const idx = findPlayer(characterName);
		if (idx < 0) return;
		const p = match.players[idx];
		const newTag = p.tag === tag ? null : tag;
		match = {
			...match,
			players: match.players.map((pl) => pl.characterName === characterName ? { ...pl, tag: newTag } : pl)
		};
		updateMatchPlayer(characterName, { tag: newTag });
	}

	// --- Result / Map editing ---
	async function setResult(result: 'win' | 'loss' | null) {
		if (!match || !matchId) return;
		updatingResult = true;
		try {
			const res = await fetch('/api/match', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ matchId, result })
			});
			if (res.ok) {
				match = { ...match, result };
			}
		} finally {
			updatingResult = false;
		}
	}

	async function setMap(mapId: string) {
		if (!match || !matchId) return;
		try {
			const res = await fetch('/api/match', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ matchId, map: mapId })
			});
			if (res.ok) {
				match = { ...match, map: mapId };
			}
		} finally {
			editingMap = false;
		}
	}

	async function deleteCurrentMatch() {
		if (!match || !matchId) return;
		deletingMatch = true;
		try {
			const res = await fetch('/api/match', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ matchId })
			});
			if (res.ok) {
				newScan();
			}
		} finally {
			deletingMatch = false;
		}
	}

	// Close spec picker on click outside
	function handleWindowClick(e: MouseEvent) {
		if (specPickerOpen) {
			const target = e.target as HTMLElement;
			if (!target.closest('.history-spec-picker') && !target.closest('.history-spec-icon-btn') &&
				!target.closest('.spec-picker') && !target.closest('.spec-icon-btn')) {
				specPickerOpen = null;
				pickerProfession = null;
			}
		}
	}

	function handleWindowKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			zoomedScreenshot = null;
			editingMap = false;
			if (editingName) editingName = null;
			if (specPickerOpen) { specPickerOpen = null; pickerProfession = null; }
		}
		// Enter -> Get Advice when no issues (pre-advice)
		if (e.key === 'Enter' && !editingName && !specPickerOpen && issueCount === 0 && !adviceReady && !adviceLoading && scanResult && !match) {
			getAdvice();
		}
		// Tab cycles focus between flagged rows (pre-advice)
		if (e.key === 'Tab' && !adviceReady && !editingName && !specPickerOpen && scanResult && !match) {
			const flagged = getFlaggedRows();
			if (flagged.length > 0) {
				e.preventDefault();
				const current = document.activeElement;
				const currentIdx = flagged.findIndex(
					(f) => current?.closest(`[data-player-row="${f.team}-${f.index}"]`)
				);
				const nextIdx = e.shiftKey
					? (currentIdx <= 0 ? flagged.length - 1 : currentIdx - 1)
					: (currentIdx + 1) % flagged.length;
				const next = flagged[nextIdx];
				const row = document.querySelector(`[data-player-row="${next.team}-${next.index}"]`);
				const btn = row?.querySelector('.spec-icon-btn') as HTMLElement;
				btn?.focus();
			}
		}
	}

	function getFlaggedRows(): Array<{ team: 'red' | 'blue'; index: number }> {
		const flagged: Array<{ team: 'red' | 'blue'; index: number }> = [];
		for (const [team, players] of [['red', redTeam], ['blue', blueTeam]] as const) {
			for (let i = 0; i < players.length; i++) {
				if (specNeedsReview(players[i]) || nameNeedsReview(players[i])) {
					flagged.push({ team, index: i });
				}
			}
		}
		return flagged;
	}

	// --- Advice parsing (same as history page) ---
	function parseAdvice(m: MatchRecord): ParsedAdvice | null {
		if (!m.adviceText) return null;

		const { myTeamPlayers, enemyTeamPlayers } = getEnemyAllyTeams(m);
		const result: ParsedAdvice = {
			focusOrder: '',
			babysit: '',
			mapAdvice: '',
			gameplan: '',
			positioning: '',
			enemyAdvice: enemyTeamPlayers.map(() => ({ threat: '', advice: '' })),
			allyAdvice: myTeamPlayers.map(() => ({ advice: undefined }))
		};

		const lines = m.adviceText.split('\n');
		let section = '';
		let playerIdx = -1;
		let currentBlock = '';

		for (const line of lines) {
			const trimmed = line.trim();
			if (/^-{3,}$|^\*{3,}$|^_{3,}$/.test(trimmed)) continue;

			if (/^(?:#+|\d+\.|\*\*)\s*(TEAM COMP|PER-ENEMY|PER.ALLY|FOCUS ORDER|MAP STRATEGY|GENERAL GAMEPLAN|WHO TO BABYSIT|ENEMY THREATS|TEAMFIGHT POSITION|KEY COOLDOWN)/i.test(trimmed)) {
				flush(result, section, playerIdx, currentBlock, enemyTeamPlayers, myTeamPlayers);
				currentBlock = '';
				playerIdx = -1;

				if (/PER-ENEMY|ENEMY THREATS/i.test(trimmed)) section = 'per_enemy';
				else if (/PER.ALLY/i.test(trimmed)) section = 'per_ally';
				else if (/FOCUS ORDER/i.test(trimmed)) section = 'focus';
				else if (/MAP STRATEGY/i.test(trimmed)) section = 'map';
				else if (/GENERAL GAMEPLAN/i.test(trimmed)) section = 'gameplan';
				else if (/WHO TO BABYSIT/i.test(trimmed)) section = 'babysit';
				else if (/TEAMFIGHT POSITION/i.test(trimmed)) section = 'positioning';
				else if (/KEY COOLDOWN/i.test(trimmed)) section = 'gameplan';
				else section = 'team_comp';
				continue;
			}

			const playerMatch = trimmed.match(/^(?:#+\s*|\*\*)?(\d+)\.[\s*]*(.+)/);
			if (playerMatch && (section === 'per_enemy' || section === 'per_ally')) {
				flush(result, section, playerIdx, currentBlock, enemyTeamPlayers, myTeamPlayers);
				currentBlock = '';

				const headerText = playerMatch[2].toLowerCase();
				const team = section === 'per_enemy' ? enemyTeamPlayers : myTeamPlayers;
				const nameMatchIdx = team.findIndex(p =>
					p.characterName && headerText.includes(p.characterName.toLowerCase())
				);

				playerIdx = nameMatchIdx >= 0 ? nameMatchIdx : parseInt(playerMatch[1]) - 1;

				if (section === 'per_enemy') {
					const threatMatch = headerText.match(/\b(HUNT|RESPECT|AVOID)\b/i);
					if (threatMatch && playerIdx >= 0 && playerIdx < result.enemyAdvice.length) {
						result.enemyAdvice[playerIdx] = {
							...result.enemyAdvice[playerIdx],
							threat: threatMatch[1].toLowerCase()
						};
					}
				}
				continue;
			}

			currentBlock += line + '\n';
		}

		flush(result, section, playerIdx, currentBlock, enemyTeamPlayers, myTeamPlayers);
		return result;
	}

	function flush(
		result: ParsedAdvice,
		section: string,
		playerIdx: number,
		block: string,
		enemyTeamPlayers: MatchPlayer[],
		myTeamPlayers: MatchPlayer[]
	) {
		const text = block.trim();
		if (!text) return;

		if (section === 'per_enemy' && playerIdx >= 0 && playerIdx < result.enemyAdvice.length) {
			const dontHitMatch = text.match(/(?:DON'?T\s+HIT|DO NOT HIT)[:\s]*(.*)/is);
			const mainAdvice = dontHitMatch ? text.replace(dontHitMatch[0], '').trim() : text;
			const dontHit = dontHitMatch ? dontHitMatch[1].trim() : undefined;

			result.enemyAdvice[playerIdx] = {
				...result.enemyAdvice[playerIdx],
				advice: mainAdvice,
				dont_hit: dontHit || result.enemyAdvice[playerIdx].dont_hit
			};
		} else if (section === 'per_ally' && playerIdx >= 0 && playerIdx < result.allyAdvice.length) {
			result.allyAdvice[playerIdx] = { advice: text };
		} else if (section === 'focus') {
			result.focusOrder = text;
		} else if (section === 'map') {
			result.mapAdvice = text;
		} else if (section === 'gameplan') {
			result.gameplan = text;
		} else if (section === 'babysit') {
			result.babysit = text;
		} else if (section === 'positioning') {
			result.positioning = text;
		}
	}

	// --- Name highlighting ---
	function buildNameFragments(m: MatchRecord): Set<string> {
		const fragments = new Set<string>();
		for (const p of m.players) {
			const name = p.characterName;
			if (!name || name.startsWith('Unknown Player')) continue;
			fragments.add(name);
			const words = name.split(/\s+/);
			if (words.length > 1) {
				for (const word of words) {
					if (word.length >= 3) fragments.add(word);
				}
			}
		}
		return fragments;
	}

	// Pre-advice name fragments (from PlayerInfo)
	let nameFragmentsScan = $derived.by(() => {
		const allPlayers = [...redTeam, ...blueTeam];
		const fragments = new Set<string>();
		for (const p of allPlayers) {
			const name = p.character_name;
			if (!name || name.startsWith('Unknown Player')) continue;
			fragments.add(name);
			const words = name.split(/\s+/);
			if (words.length > 1) {
				for (const word of words) {
					if (word.length >= 3) fragments.add(word);
				}
			}
		}
		return fragments;
	});

	function splitSentences(text: string): string {
		const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z"'"(])/).map(s => s.trim()).filter(Boolean);
		if (sentences.length <= 1) return `• ${text}`;
		return '<ul class="list-disc list-inside space-y-0.5">' + sentences.map(s => `<li>${s}</li>`).join('') + '</ul>';
	}

	function highlightNames(text: string, fragments: Set<string>): string {
		let result = splitSentences(text);
		result = result.replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold text-(--color-text)">$1</strong>');
		if (fragments.size === 0) return result;
		const sorted = [...fragments].sort((a, b) => b.length - a.length);
		const escaped = sorted.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
		const pattern = new RegExp(`(?<![<\\w])\\b(${escaped.join('|')})\\b(?![\\w>])`, 'gi');
		return result.replace(pattern, '<strong class="font-semibold text-(--color-text)">$1</strong>');
	}

	function highlightNamesScan(text: string): string {
		return highlightNames(text, nameFragmentsScan);
	}

	function getThreatColor(threat: string): string {
		switch (threat) {
			case 'hunt': return 'text-(--color-red) bg-(--color-red)/10';
			case 'respect': return 'text-(--color-amber) bg-(--color-amber)/10';
			case 'avoid': return 'text-(--color-text-tertiary) bg-(--color-surface-raised)';
			default: return 'text-(--color-text-tertiary)';
		}
	}

	function getEnemyAdviceForIdx(advice: ParsedAdvice | null, idx: number) {
		if (!advice) return null;
		const a = advice.enemyAdvice[idx];
		return a?.advice ? a : null;
	}

	function getAllyAdviceForIdx(advice: ParsedAdvice | null, idx: number) {
		if (!advice) return null;
		const a = advice.allyAdvice[idx];
		return a?.advice ? a : null;
	}

	function getTeams(m: MatchRecord) {
		return {
			redTeam: m.players.filter((p) => p.team === 'red'),
			blueTeam: m.players.filter((p) => p.team === 'blue')
		};
	}

	function getEnemyAllyTeams(m: MatchRecord) {
		const myColor = m.userTeamColor ?? 'red';
		const enemyColor = myColor === 'red' ? 'blue' : 'red';
		return {
			myTeamPlayers: m.players.filter((p) => p.team === myColor),
			enemyTeamPlayers: m.players.filter((p) => p.team === enemyColor)
		};
	}

	// --- Upsert players ---
	async function upsertRosterPlayers() {
		const nonUserPlayers = [...redTeam, ...blueTeam].filter((p) => !p.is_user);
		try {
			await fetch('/api/players', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ players: nonUserPlayers })
			});
		} catch {
			// non-critical
		}
	}

	// --- Save match ---
	async function saveMatch(): Promise<string | null> {
		try {
			const res = await fetch('/api/match', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					myTeam,
					enemyTeam,
					map: selectedMap,
					userTeamColor,
					screenshotHash
				})
			});
			if (res.ok) {
				const data = await res.json();
				return data.matchId;
			}
		} catch {
			// non-critical
		}
		return null;
	}

	/** Persist current roster corrections to DB (debounced fire-and-forget) */
	function persistRosterToDB() {
		if (!matchId) return;
		fetch('/api/match', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				matchId,
				map: selectedMap,
				updatePlayers: { myTeam, enemyTeam, userTeamColor }
			})
		}).catch(() => {});
	}

	/** Save advice text progressively during streaming */
	let adviceSaveTimer: ReturnType<typeof setTimeout> | null = null;
	function scheduleAdviceSave() {
		if (adviceSaveTimer) return; // already scheduled
		adviceSaveTimer = setTimeout(() => {
			adviceSaveTimer = null;
			if (matchId && rawAdviceText) {
				fetch('/api/match', {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ matchId, adviceText: rawAdviceText })
				}).catch(() => {});
			}
		}, 3000); // save every 3 seconds during streaming
	}

	// --- Advice ---
	let rawAdviceText = '';

	async function getAdvice() {
		adviceLoading = true;
		adviceError = '';
		adviceElapsed = 0;
		adviceTimer = setInterval(() => { adviceElapsed++; }, 1000);
		rawAdviceText = '';

		// Initialize streaming advice arrays
		streamEnemyAdvice = enemyTeam.map(() => ({ threat: '', advice: '', dont_hit: undefined }));
		streamAllyAdvice = myTeam.map(() => ({ advice: undefined }));
		streamFocusOrder = '';
		streamMapAdvice = '';
		streamGameplan = '';
		streamBabysit = '';
		streamPositioning = '';

		// Ensure match is persisted (may already exist from mount)
		if (!matchId) {
			await upsertRosterPlayers();
			matchId = await saveMatch();
		} else {
			// Persist any corrections made since mount
			persistRosterToDB();
		}

		try {
			const mapInfo = maps.find(m => m.id === selectedMap);
			const res = await fetch('/api/advice', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					myTeam: myTeam,
					enemyTeam: enemyTeam,
					map: mapInfo,
					userTeamColor
				})
			});

			if (!res.ok) {
				const err = await res.json().catch(() => ({ message: 'Advice request failed' }));
				throw new Error(err.message ?? 'Advice failed');
			}

			const reader = res.body?.getReader();
			if (!reader) throw new Error('No response body');

			const decoder = new TextDecoder();
			let buffer = '';

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() ?? '';

				for (const line of lines) {
					if (line.startsWith('data: ')) {
						const data = line.slice(6);
						if (data === '[DONE]') break;
						try {
							const parsed = JSON.parse(data);
							if (parsed.text) {
								processAdviceToken(parsed.text);
							}
						} catch {
							// skip malformed JSON
						}
					}
				}
			}

			adviceReady = true;

			// Save advice text to the match record and build MatchRecord for display
			if (matchId && rawAdviceText) {
				fetch('/api/match', {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ matchId, adviceText: rawAdviceText })
				}).catch(() => {});

				// Build match record for post-advice display
				match = buildMatchRecord(rawAdviceText);
			} else if (matchId) {
				match = buildMatchRecord(null);
			}
		} catch (err) {
			adviceError = err instanceof Error ? err.message : 'Advice failed';
		} finally {
			if (adviceTimer) clearInterval(adviceTimer);
			adviceTimer = null;
			adviceLoading = false;
		}
	}

	function buildMatchRecord(adviceText: string | null): MatchRecord {
		const allPlayers: MatchPlayer[] = [];
		for (const p of redTeam) {
			allPlayers.push({
				characterName: p.character_name,
				team: 'red',
				profession: p.profession_id,
				spec: p.spec_id,
				role: p.role,
				isUser: p.is_user,
				ratingSkill: null,
				ratingFriendly: null,
				tag: p.tag ?? null
			});
		}
		for (const p of blueTeam) {
			allPlayers.push({
				characterName: p.character_name,
				team: 'blue',
				profession: p.profession_id,
				spec: p.spec_id,
				role: p.role,
				isUser: p.is_user,
				ratingSkill: null,
				ratingFriendly: null,
				tag: p.tag ?? null
			});
		}
		return {
			matchId: matchId!,
			userTeamColor,
			map: selectedMap,
			result: null,
			screenshotHash: screenshotHash,
			screenshotUrl: screenshotUrl,
			adviceText,
			timestamp: new Date().toISOString(),
			players: allPlayers
		};
	}

	function processAdviceToken(text: string) {
		rawAdviceText += text;
		parseStreamingAdvice(rawAdviceText);
		scheduleAdviceSave();
	}

	function parseStreamingAdvice(fullText: string) {
		const lines = fullText.split('\n');
		let section = '';
		let playerIdx = -1;
		let currentBlock = '';

		for (const line of lines) {
			const trimmed = line.trim();
			if (/^-{3,}$|^\*{3,}$|^_{3,}$/.test(trimmed)) continue;

			if (/^(?:#+|\d+\.|\*\*)\s*(TEAM COMP|PER-ENEMY|PER.ALLY|FOCUS ORDER|MAP STRATEGY|GENERAL GAMEPLAN|WHO TO BABYSIT|ENEMY THREATS|TEAMFIGHT POSITION|KEY COOLDOWN)/i.test(trimmed)) {
				flushStream(section, playerIdx, currentBlock);
				currentBlock = '';
				playerIdx = -1;

				if (/PER-ENEMY|ENEMY THREATS/i.test(trimmed)) section = 'per_enemy';
				else if (/PER.ALLY/i.test(trimmed)) section = 'per_ally';
				else if (/FOCUS ORDER/i.test(trimmed)) section = 'focus';
				else if (/MAP STRATEGY/i.test(trimmed)) section = 'map';
				else if (/GENERAL GAMEPLAN/i.test(trimmed)) section = 'gameplan';
				else if (/WHO TO BABYSIT/i.test(trimmed)) section = 'babysit';
				else if (/TEAMFIGHT POSITION/i.test(trimmed)) section = 'positioning';
				else if (/KEY COOLDOWN/i.test(trimmed)) section = 'gameplan';
				else section = 'team_comp';
				continue;
			}

			const playerMatch = trimmed.match(/^(?:#+\s*|\*\*)?(\d+)\.[\s*]*(.+)/);
			if (playerMatch && (section === 'per_enemy' || section === 'per_ally')) {
				flushStream(section, playerIdx, currentBlock);
				currentBlock = '';

				const headerText = playerMatch[2].toLowerCase();
				const team = section === 'per_enemy' ? enemyTeam : myTeam;
				const nameMatchIdx = team.findIndex(p =>
					p.character_name && headerText.includes(p.character_name.toLowerCase())
				);

				if (nameMatchIdx >= 0) {
					playerIdx = nameMatchIdx;
				} else {
					playerIdx = parseInt(playerMatch[1]) - 1;
				}

				if (section === 'per_enemy') {
					const threatMatch = headerText.match(/\b(HUNT|RESPECT|AVOID)\b/i);
					if (threatMatch && playerIdx >= 0 && playerIdx < streamEnemyAdvice.length) {
						streamEnemyAdvice[playerIdx] = { ...streamEnemyAdvice[playerIdx], threat: threatMatch[1].toLowerCase() };
					}
				}
				continue;
			}

			currentBlock += line + '\n';
		}

		flushStream(section, playerIdx, currentBlock);
	}

	function flushStream(section: string, playerIdx: number, block: string) {
		const text = block.trim();
		if (!text) return;

		if (section === 'per_enemy' && playerIdx >= 0 && playerIdx < streamEnemyAdvice.length) {
			const dontHitMatch = text.match(/(?:DON'?T\s+HIT|DO NOT HIT)[:\s]*(.*)/is);
			const mainAdvice = dontHitMatch ? text.replace(dontHitMatch[0], '').trim() : text;
			const dontHit = dontHitMatch ? dontHitMatch[1].trim() : undefined;
			streamEnemyAdvice[playerIdx] = {
				...streamEnemyAdvice[playerIdx],
				advice: mainAdvice,
				dont_hit: dontHit || streamEnemyAdvice[playerIdx].dont_hit
			};
		} else if (section === 'per_ally' && playerIdx >= 0 && playerIdx < streamAllyAdvice.length) {
			streamAllyAdvice[playerIdx] = { advice: text };
		} else if (section === 'focus') {
			streamFocusOrder = text;
		} else if (section === 'map') {
			streamMapAdvice = text;
		} else if (section === 'gameplan') {
			streamGameplan = text;
		} else if (section === 'babysit') {
			streamBabysit = text;
		} else if (section === 'positioning') {
			streamPositioning = text;
		}
	}

	async function reAnalyze() {
		// Reset and re-request advice using existing match data
		adviceReady = false;
		match = null;
		rawAdviceText = '';
		await getAdvice();
	}

	function newScan() {
		sessionStorage.removeItem('scanResult');
		goto('/');
	}

	async function recordResult(result: 'win' | 'loss') {
		recordingResult = true;
		try {
			if (!matchId) {
				matchId = await saveMatch();
			}
			if (matchId) {
				await fetch('/api/match', {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ matchId, result })
				});
				if (match) {
					match = { ...match, result };
				}
			}
		} catch {
			// non-critical
		} finally {
			recordingResult = false;
			newScan();
		}
	}

	function correctSpecFromCandidate(team: 'red' | 'blue', index: number, profId: string, specId: string) {
		selectSpecScan(team, index, profId, specId);
	}

	function correctName(team: 'red' | 'blue', index: number, value: string) {
		const players = team === 'red' ? redTeam : blueTeam;
		const trimmed = value.trim();
		if (trimmed) {
			players[index] = {
				...players[index],
				character_name: trimmed,
				name_confidence: 100
			};
		}
	}
</script>

<svelte:window onclick={handleWindowClick} onkeydown={handleWindowKeydown} />

<!-- ============ PRE-ADVICE: Scan result with correction panel ============ -->
{#if scanResult && !adviceReady && !match}

	{#snippet playerRowScan(player: PlayerInfo, team: 'red' | 'blue', index: number, side: 'my' | 'enemy')}
		{@const rowLevel = rowConfidenceLevel(player)}
		{@const specLevel = specConfidenceLevel(player)}
		{@const nameLevel = nameConfidenceLevel(player)}
		{@const isEditing = editingName?.matchId === `scan-${team}` && editingName?.characterName === String(index)}
		{@const isPickerOpen = specPickerOpen?.matchId === `scan-${team}-${index}` && specPickerOpen?.characterName === String(index)}
		{@const eAdvice = side === 'enemy' && adviceLoading ? streamEnemyAdvice[index] : null}
		{@const historyBadge = getHistoryBadge(player)}
		{@const wlRecord = side === 'enemy' ? getWLRecord(player) : null}

		<div
			class="relative rounded-lg border-l-3 px-3 py-2 transition-all
				{rowLevel === 'low'
					? 'border-l-(--color-red) bg-(--color-red)/5'
					: rowLevel === 'medium'
						? 'border-l-(--color-amber) bg-(--color-amber)/5'
						: player.is_user
							? 'border-l-(--color-amber)/30'
							: ''}"
			style="{rowLevel === 'high' ? `${!player.is_user ? `border-left-color: ${getProfessionColor(player.profession_id)};` : ''} background-color: color-mix(in srgb, ${getProfessionColor(player.profession_id)} 6%, transparent);` : ''}"
			data-player-row="{team}-{index}"
		>
			<div class="flex items-center gap-2.5">
				<!-- Spec icon (clickable) -->
				<button
					class="spec-icon-btn relative flex-shrink-0 cursor-pointer rounded-md p-0.5 transition-all hover:bg-(--color-surface-hover)
						{specLevel === 'low' ? 'ring-1 ring-(--color-red)/50 animate-pulse' : specLevel === 'medium' ? 'ring-1 ring-(--color-amber)/40' : 'hover:ring-1 hover:ring-(--color-accent)/30'}"
					onclick={() => handleSpecClickScan(team, index)}
					title="Click to change spec"
				>
					<span
						class="inline-block h-8 w-8"
						style={specIconStyle(player.spec_id, player.profession_id)}
						title={getSpecLabel(player.profession_id, player.spec_id)}
					></span>
				</button>

				<div class="min-w-0 flex-1">
					<!-- Line 1: Name + badges -->
					<div class="flex items-center gap-2">
						{#if isEditing}
							<input
								id="name-input-{team}-{index}"
								type="text"
								value={player.character_name}
								class="w-full rounded bg-(--color-bg) px-2 py-0.5 font-mono text-sm text-(--color-text) border border-(--color-accent) outline-none"
								onblur={(e) => commitNameEditScan(team, index, (e.currentTarget as HTMLInputElement).value)}
								onkeydown={(e) => handleNameKeydownScan(e)}
							/>
						{:else}
							<button
								class="truncate font-mono text-sm font-bold cursor-pointer transition-colors"
								style="color: {getProfessionColor(player.profession_id)};"
								onclick={() => startNameEditScan(team, index)}
								title="Click to edit name"
							>
								{player.character_name}
							</button>
							{#if player.is_user}
								<span class="shrink-0 text-[10px] font-medium text-(--color-amber)/70">you</span>
							{/if}
							{#if historyBadge}
								<span class="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium {historyBadge.color}">
									{historyBadge.label}
								</span>
							{/if}
							{#if wlRecord}
								<span class="shrink-0 text-[9px] font-mono text-(--color-text-tertiary)">
									{wlRecord}
								</span>
							{/if}
						{/if}

						{#if eAdvice?.threat}
							<span class="ml-auto shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider {getThreatColor(eAdvice.threat)}">
								{eAdvice.threat}
							</span>
						{/if}
					</div>

					<!-- Line 2: Spec label + role -->
					<div class="flex items-center gap-1.5 mt-0.5">
						<span class="text-xs" style="color: {getProfessionColor(player.profession_id)}; opacity: 0.7;">
							{getSpecLabel(player.profession_id, player.spec_id)}
						</span>
						{#if player.spec_source === 'history'}
							<span class="text-[9px] text-(--color-accent)/60">(from history)</span>
						{/if}
						<span class="text-xs text-(--color-text-tertiary)">&middot;</span>
						{#if hasRoleToggle(player)}
							<button
								class="text-xs font-medium text-(--color-text-secondary) hover:text-(--color-accent) transition-colors cursor-pointer"
								onclick={() => handleRoleToggle(team, index)}
								title="Click to toggle role"
							>
								{player.role}
							</button>
						{:else}
							<span class="text-xs text-(--color-text-tertiary)">{player.role}</span>
						{/if}
						{#if side === 'enemy' && userProfession === 'thief'}
							{@const stolen = getStolenSkill(player.profession_id)}
							{#if stolen}
								<span class="text-xs text-(--color-text-tertiary)">&middot;</span>
								<span class="stolen-skill group relative cursor-default">
									<span class="inline-flex items-center gap-1 text-[10px] text-(--color-accent)/70">
										<img src={stolen.icon} alt="" class="inline h-3.5 w-3.5" />
										{stolen.name}
									</span>
									<span class="pointer-events-none absolute bottom-full left-1/2 z-40 mb-2 -translate-x-1/2 opacity-0 transition-opacity group-hover:opacity-100">
										<span class="flex items-start gap-2.5 rounded-lg border border-(--color-border-strong) bg-(--color-surface-raised) px-3 py-2 shadow-xl whitespace-nowrap">
											<img src={stolen.icon} alt="" class="h-8 w-8 flex-shrink-0 mt-0.5" />
											<span class="flex flex-col gap-0.5">
												<span class="text-xs font-bold text-(--color-text)">{stolen.name}</span>
												<span class="text-[10px] text-(--color-text-secondary) whitespace-normal max-w-48">{stolen.description}</span>
												<span class="text-[9px] font-medium text-(--color-accent)/60 mt-0.5">{stolen.tip}</span>
											</span>
										</span>
									</span>
								</span>
							{/if}
						{/if}
					</div>
				</div>
			</div>

			<!-- Spec picker popup -->
			{#if isPickerOpen}
				{@const profList = Object.entries(specs.professions)}
				{@const selectedProf = pickerProfession || player.profession_id}
				{@const profSpecs = getSpecsForProfession(selectedProf)}
				<div class="spec-picker absolute left-0 top-full z-30 mt-1 rounded-xl border border-(--color-border-strong) bg-(--color-surface-raised) p-3 shadow-lg min-w-64 animate-slide-up">
					<div class="flex flex-wrap gap-1 mb-2 pb-2 border-b border-(--color-border)/50">
						{#each profList as [profId, prof]}
							<button
								class="rounded-md px-1.5 py-1 transition-all cursor-pointer
									{profId === selectedProf
										? 'bg-(--color-accent)/15 ring-1 ring-(--color-accent)/50'
										: 'hover:bg-(--color-surface-hover)'}"
								onclick={() => (pickerProfession = profId)}
								title={prof.label}
							>
								<span class="inline-block h-6 w-6" style={specIconStyle(profId, profId)} title={prof.label}></span>
							</button>
						{/each}
					</div>
					<p class="mb-2 text-[10px] font-bold uppercase tracking-wider text-(--color-text-tertiary)">
						{getProfessionLabel(selectedProf)}
					</p>
					<div class="flex flex-wrap gap-2">
						{#each profSpecs as spec}
							<button
								class="flex flex-col items-center gap-1 rounded-lg p-2 transition-all cursor-pointer
									{spec.id === player.spec_id && selectedProf === player.profession_id
										? 'bg-(--color-accent)/15 ring-1 ring-(--color-accent)/50'
										: 'hover:bg-(--color-surface-hover)'}"
								onclick={() => selectSpecScan(team, index, selectedProf, spec.id)}
							>
								<span
									class="inline-block h-10 w-10"
									style={specIconStyle(spec.id === 'core' ? selectedProf : spec.id, selectedProf)}
									title={spec.label}
								></span>
								<span class="text-[10px] text-(--color-text-secondary) max-w-16 text-center leading-tight">
									{spec.id === 'core' ? 'Core' : spec.label}
								</span>
							</button>
						{/each}
					</div>
				</div>
			{/if}
		</div>
	{/snippet}

	<div>
		<!-- Profile switch notice -->
		{#if profileSwitchNotice}
			<div class="mb-3 rounded-lg bg-(--color-accent)/10 border border-(--color-accent)/30 px-4 py-2 text-sm text-(--color-accent) flex items-center justify-between">
				<span>{profileSwitchNotice}</span>
				<button class="opacity-60 hover:opacity-100 cursor-pointer" onclick={() => (profileSwitchNotice = '')}>&#10005;</button>
			</div>
		{/if}

		<!-- Screenshot (100% width) -->
		{#if screenshotUrl}
			<div class="mb-4">
				<button class="w-full cursor-pointer rounded-xl overflow-hidden border border-(--color-border) hover:border-(--color-accent)/50 transition-colors"
					onclick={() => (zoomedScreenshot = screenshotUrl)}>
					<img src={screenshotUrl} alt="Match screenshot" class="w-full h-auto" />
				</button>
			</div>
		{/if}

		<!-- Map selector -->
		<div class="mb-4 flex items-center gap-2 rounded-lg border border-(--color-border) bg-(--color-surface) px-4 py-2.5">
			<label for="map-select" class="text-xs font-bold uppercase tracking-wider text-(--color-text-tertiary)">
				Map
			</label>
			{#if mapAutoDetected}
				<span class="rounded-full bg-(--color-green)/10 px-2 py-0.5 text-[10px] text-(--color-green)">detected</span>
			{/if}
			<select
				id="map-select"
				bind:value={selectedMap}
				onchange={() => (mapAutoDetected = false)}
				class="flex-1 rounded-lg bg-(--color-bg) px-3 py-1.5 text-sm text-(--color-text) border border-(--color-border) focus:border-(--color-accent) focus:outline-none"
			>
				{#each maps as map}
					<option value={map.id}>{map.name} — {map.mechanic}</option>
				{/each}
			</select>
		</div>

		<!-- Issues panel (spec issues first, then name issues, disappear when corrected) -->
		{#if flaggedIssues.length > 0}
			<div class="mb-4 rounded-xl border border-(--color-amber)/30 bg-(--color-amber)/5 p-4">
				<div class="flex items-center gap-2 mb-3">
					<span class="inline-flex h-5 w-5 items-center justify-center rounded-full bg-(--color-amber)/15 text-[10px] font-bold text-(--color-amber)">
						{flaggedIssues.length}
					</span>
					<span class="text-sm text-(--color-amber)/80">
						{flaggedIssues.length === 1 ? 'item' : 'items'} flagged for review — <kbd class="rounded bg-(--color-surface) px-1 py-0.5 text-[10px] font-mono border border-(--color-border)">Tab</kbd> to cycle
					</span>
				</div>
				<div class="flex flex-col gap-2">
					{#each flaggedIssues as issue}
						<div class="flex items-center gap-2 rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2">
							{#if issue.type === 'spec'}
								<!-- SPEC ISSUE: crop → "pick correct spec" → top 3 candidate icons → picker button -->
								{#if issue.meta.icon_crop_base64}
									<div class="shrink-0 rounded-lg border border-(--color-border) overflow-hidden bg-(--color-bg)">
										<img src="data:image/png;base64,{issue.meta.icon_crop_base64}" alt="Scanned" class="h-10 w-10 object-contain" />
									</div>
								{/if}
								<span class="text-[10px] text-(--color-amber) shrink-0">pick correct spec &#8594;</span>
								{#if issue.meta.top_candidates && issue.meta.top_candidates.length > 0}
									{#each issue.meta.top_candidates.slice(0, 3) as candidate}
										<button
											class="shrink-0 cursor-pointer rounded-lg p-1 transition-all hover:bg-(--color-surface-hover) hover:ring-1 hover:ring-(--color-accent)/30"
											onclick={() => correctSpecFromCandidate(issue.team, issue.index, candidate.professionId, candidate.specId)}
											title={getSpecLabel(candidate.professionId, candidate.specId)}
										>
											<span
												class="inline-block h-10 w-10"
												style={specIconStyle(candidate.specId, candidate.professionId)}
											></span>
										</button>
									{/each}
								{/if}
								<button
									class="shrink-0 cursor-pointer rounded-lg border border-dashed border-(--color-border) p-1 transition-all hover:border-(--color-accent)/50 hover:text-(--color-accent) text-(--color-text-tertiary)"
									onclick={() => handleSpecClickScan(issue.team, issue.index)}
									title="Browse all specs"
								>
									<span class="inline-flex h-10 w-10 items-center justify-center text-lg">...</span>
								</button>

							{:else}
								<!-- NAME ISSUE: spec icon + player name input -->
								<div class="shrink-0 rounded-lg p-0.5">
									<span class="inline-block h-8 w-8" style={specIconStyle(issue.player.spec_id, issue.player.profession_id)}></span>
								</div>
								<span class="text-xs shrink-0" style="color: {getProfessionColor(issue.player.profession_id)};">
									{getSpecLabel(issue.player.profession_id, issue.player.spec_id).split(' · ').pop()}
								</span>
								<input
									type="text"
									value={issue.player.character_name.startsWith('Unknown Player') ? '' : (issue.guessedName ?? issue.player.character_name)}
									placeholder={issue.player.character_name.startsWith('Unknown Player') ? 'Enter player name...' : ''}
									class="flex-1 rounded bg-(--color-bg) px-2 py-1 font-mono text-sm border outline-none focus:border-(--color-accent)
										{issue.player.character_name.startsWith('Unknown Player')
											? 'text-(--color-text-tertiary) border-(--color-red)/50 placeholder:text-(--color-text-tertiary)/50'
											: 'text-(--color-text) border-(--color-amber)/50'}"
									onblur={(e) => correctName(issue.team, issue.index, (e.currentTarget as HTMLInputElement).value)}
									onkeydown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }}
								/>
							{/if}
						</div>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Get Advice -->
		<div class="mb-5">
			{#if issueCount === 0}
				<div class="mb-2 flex items-center gap-2 text-sm text-(--color-green)">
					<span>&#10003;</span>
					<span>All confirmed</span>
				</div>
			{/if}
			<button
				class="w-full rounded-xl py-3 text-base font-bold transition-all cursor-pointer
					{adviceLoading
						? 'bg-(--color-accent)/50 text-white/70'
						: 'bg-(--color-accent) text-white shadow-lg shadow-(--color-accent)/20 hover:bg-(--color-accent-hover)'}"
				disabled={adviceLoading}
				onclick={getAdvice}
			>
				{#if adviceLoading}
					<span class="flex items-center justify-center gap-2">
						<span class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></span>
						Generating advice... {adviceElapsed}s
					</span>
				{:else}
					Get Advice
				{/if}
			</button>
			{#if adviceError}
				<p class="mt-2 text-xs text-(--color-red)">{adviceError}</p>
			{/if}
		</div>

		<!-- Streaming advice cards (shown during loading) -->
		{#if adviceLoading && (streamFocusOrder || streamMapAdvice || streamGameplan || streamBabysit || streamPositioning)}
			<div class="mb-4 flex flex-col gap-2">
				{#if streamFocusOrder}
					<div class="rounded-lg border border-(--color-border) bg-(--color-surface) p-3 border-l-3 border-l-(--color-red)/60">
						<p class="text-[10px] font-bold uppercase tracking-wider text-(--color-red)/70 mb-1">Focus Order</p>
						<p class="text-sm text-(--color-text) leading-relaxed">{@html highlightNamesScan(streamFocusOrder)}</p>
					</div>
				{/if}
				{#if streamBabysit}
					<div class="rounded-lg border border-(--color-border) bg-(--color-surface) p-3 border-l-3 border-l-(--color-accent)/50">
						<p class="text-[10px] font-bold uppercase tracking-wider text-(--color-accent)/70 mb-1">Babysit</p>
						<p class="text-xs leading-relaxed text-(--color-text-secondary) whitespace-pre-line">{@html highlightNamesScan(streamBabysit)}</p>
					</div>
				{/if}
				{#if streamMapAdvice}
					<div class="rounded-lg border border-(--color-border) bg-(--color-surface) p-3 border-l-3 border-l-(--color-amber)/60">
						<p class="text-[10px] font-bold uppercase tracking-wider text-(--color-amber)/70 mb-1">Map Opening</p>
						<p class="text-xs leading-relaxed text-(--color-text-secondary) whitespace-pre-line">{@html highlightNamesScan(streamMapAdvice)}</p>
					</div>
				{/if}
				{#if streamGameplan}
					<div class="rounded-lg border border-(--color-border) bg-(--color-surface) p-3 border-l-3 border-l-(--color-green)/60">
						<p class="text-[10px] font-bold uppercase tracking-wider text-(--color-green)/70 mb-1">Gameplan</p>
						<p class="text-xs leading-relaxed text-(--color-text-secondary) whitespace-pre-line">{@html highlightNamesScan(streamGameplan)}</p>
					</div>
				{/if}
				{#if streamPositioning}
					<div class="rounded-lg border border-(--color-border) bg-(--color-surface) p-3 border-l-3 border-l-(--color-text-tertiary)/50">
						<p class="text-[10px] font-bold uppercase tracking-wider text-(--color-text-tertiary)/70 mb-1">Positioning</p>
						<p class="text-xs leading-relaxed text-(--color-text-secondary) whitespace-pre-line">{@html highlightNamesScan(streamPositioning)}</p>
					</div>
				{/if}
			</div>
		{/if}

		<!-- Teams: Red left, Blue right -->
		<div class="grid grid-cols-2 gap-4">
			<div>
				<div class="mb-2 flex items-center gap-2">
					<div class="h-2 w-2 rounded-full bg-(--color-team-red)"></div>
					<h2 class="text-xs font-bold uppercase tracking-widest text-(--color-text-secondary)">
						Red Team
						{#if userTeamColor === 'red'}<span class="font-normal text-(--color-amber)/60 ml-1">(you)</span>{/if}
					</h2>
				</div>
				<div class="flex flex-col gap-1.5">
					{#each redTeam as player, i}
						{@render playerRowScan(player, 'red', i, userTeamColor === 'red' ? 'my' : 'enemy')}
					{/each}
				</div>
			</div>
			<div>
				<div class="mb-2 flex items-center gap-2">
					<div class="h-2 w-2 rounded-full bg-(--color-team-blue)"></div>
					<h2 class="text-xs font-bold uppercase tracking-widest text-(--color-text-secondary)">
						Blue Team
						{#if userTeamColor === 'blue'}<span class="font-normal text-(--color-amber)/60 ml-1">(you)</span>{/if}
					</h2>
				</div>
				<div class="flex flex-col gap-1.5">
					{#each blueTeam as player, i}
						{@render playerRowScan(player, 'blue', i, userTeamColor === 'blue' ? 'my' : 'enemy')}
					{/each}
				</div>
			</div>
		</div>
	</div>
{/if}

<!-- ============ POST-ADVICE: History-style display ============ -->
{#if match && adviceReady}
	{@const { redTeam: redTeamMatch, blueTeam: blueTeamMatch } = getTeams(match)}
	{@const { myTeamPlayers, enemyTeamPlayers } = getEnemyAllyTeams(match)}
	{@const advice = parseAdvice(match)}
	{@const nameFrags = buildNameFragments(match)}

	{#snippet playerRowWithAdvice(p: MatchPlayer, m: MatchRecord, side: 'my' | 'enemy', playerIdx: number, adv: ParsedAdvice | null, nFrags: Set<string>)}
		{@const isEditingName = editingName?.matchId === m.matchId && editingName?.characterName === p.characterName}
		{@const isPickerOpen = specPickerOpen?.matchId === m.matchId && specPickerOpen?.characterName === p.characterName}
		{@const selectedProf = pickerProfession || p.profession}
		{@const eAdvice = side === 'enemy' ? getEnemyAdviceForIdx(adv, playerIdx) : null}
		{@const aAdvice = side === 'my' ? getAllyAdviceForIdx(adv, playerIdx) : null}
		<div class="group relative rounded-lg border-l-3 px-3 py-2
			{p.isUser ? 'border-l-(--color-amber)/30' : ''}"
			style="{!p.isUser ? `border-left-color: ${getProfessionColor(p.profession)};` : ''} background-color: color-mix(in srgb, {getProfessionColor(p.profession)} 6%, transparent);"
		>
			<div class="flex items-center gap-2.5">
				<!-- Spec icon (clickable to change) -->
				<button
					class="history-spec-icon-btn relative flex-shrink-0 cursor-pointer rounded-md p-0.5 transition-all hover:bg-(--color-surface-hover) hover:ring-1 hover:ring-(--color-accent)/30"
					onclick={() => openSpecPicker(p)}
					title="Click to change spec"
				>
					<span
						class="inline-block h-8 w-8"
						style={specIconStyle(p.spec, p.profession)}
						title={getSpecLabel(p.profession, p.spec)}
					></span>
				</button>

				<div class="min-w-0 flex-1">
					<!-- Line 1: Name + threat badge -->
					<div class="flex items-center gap-2">
						{#if isEditingName}
							<input
								id="name-edit-{m.matchId}-{p.characterName}"
								type="text"
								value={p.characterName}
								class="w-48 rounded bg-(--color-bg) px-2 py-0.5 font-mono text-sm text-(--color-text) border border-(--color-accent) outline-none"
								onblur={(e) => commitNameEdit(p.characterName, (e.currentTarget as HTMLInputElement).value)}
								onkeydown={(e) => handleNameKeydown(e, p.characterName)}
							/>
						{:else}
							<button
								class="truncate font-mono text-sm font-bold cursor-pointer transition-colors"
								style="color: {getProfessionColor(p.profession)};"
								onclick={() => startNameEdit(p.characterName)}
								title="Click to edit name"
							>
								{p.characterName}
							</button>
						{/if}
						{#if p.isUser}
							<span class="shrink-0 text-[10px] font-medium text-(--color-amber)/70">you</span>
						{/if}
						{#if eAdvice?.threat}
							<span class="ml-auto shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider {getThreatColor(eAdvice.threat)}">
								{eAdvice.threat}
							</span>
						{/if}
					</div>
					<!-- Line 2: Spec label + role -->
					<div class="flex items-center gap-1.5 mt-0.5">
						<span class="text-xs" style="color: {getProfessionColor(p.profession)}; opacity: 0.7;">
							{getSpecLabel(p.profession, p.spec)}
						</span>
						<span class="text-xs text-(--color-text-tertiary)">&middot;</span>
						<span class="text-xs text-(--color-text-tertiary)">{p.role}</span>
					</div>
				</div>

				<!-- Right side: 3-row ratings + tags block -->
				{#if !p.isUser}
					<div class="shrink-0 flex flex-col opacity-60 group-hover:opacity-100 transition-opacity">
						<!-- Row 1: Skill -->
						<div class="flex items-center justify-between h-4">
							<span class="text-[8px] font-bold uppercase tracking-wider text-(--color-amber)/50 mr-2">Skill</span>
							<div class="flex items-center gap-px">
								{#each [1, 2, 3, 4, 5] as star}
									<button
										class="text-[11px] leading-none cursor-pointer transition-colors {p.ratingSkill !== null && star <= (p.ratingSkill ?? 0) ? 'text-(--color-amber)' : 'text-(--color-text-tertiary)/20 hover:text-(--color-amber)/50'}"
										onclick={() => setPlayerRating(p.characterName, 'ratingSkill', star)}
									>&#9733;</button>
								{/each}
							</div>
						</div>
						<!-- Row 2: Vibe -->
						<div class="flex items-center justify-between h-4">
							<span class="text-[8px] font-bold uppercase tracking-wider text-(--color-green)/50 mr-2">Vibe</span>
							<div class="flex items-center gap-px">
								{#each [1, 2, 3, 4, 5] as star}
									<button
										class="text-[11px] leading-none cursor-pointer transition-colors {p.ratingFriendly !== null && star <= (p.ratingFriendly ?? 0) ? 'text-(--color-green)' : 'text-(--color-text-tertiary)/20 hover:text-(--color-green)/50'}"
										onclick={() => setPlayerRating(p.characterName, 'ratingFriendly', star)}
									>&#9733;</button>
								{/each}
							</div>
						</div>
						<!-- Row 3: Friend | Avoid -->
						<div class="flex items-center gap-0.5 h-4">
							<button
								class="flex-1 rounded-full px-1.5 text-[8px] font-bold uppercase tracking-wider cursor-pointer transition-colors border leading-none text-center
									{p.tag === 'friend'
										? 'text-(--color-green) bg-(--color-green)/15 border-(--color-green)/30'
										: 'text-(--color-text-tertiary)/30 border-transparent hover:text-(--color-green)/60 hover:border-(--color-green)/20'}"
								onclick={() => toggleTag(p.characterName, 'friend')}
							>Friend</button>
							<button
								class="flex-1 rounded-full px-1.5 text-[8px] font-bold uppercase tracking-wider cursor-pointer transition-colors border leading-none text-center
									{p.tag === 'avoid'
										? 'text-(--color-red) bg-(--color-red)/15 border-(--color-red)/30'
										: 'text-(--color-text-tertiary)/30 border-transparent hover:text-(--color-red)/60 hover:border-(--color-red)/20'}"
								onclick={() => toggleTag(p.characterName, 'avoid')}
							>Avoid</button>
						</div>
					</div>
				{/if}
			</div>

			<!-- Inline advice (collapsible, open by default) -->
			{#if eAdvice?.advice}
				<details open class="mt-2">
					<summary class="text-[9px] font-bold uppercase tracking-wider text-(--color-text-tertiary)/50 cursor-pointer hover:text-(--color-text-tertiary) select-none">Advice</summary>
					<div class="mt-1 pl-1 border-l-2 border-(--color-border)/50 ml-1">
						<p class="text-xs leading-relaxed text-(--color-text-secondary) whitespace-pre-line">{@html highlightNames(eAdvice.advice, nFrags)}</p>
						{#if eAdvice.dont_hit}
							<p class="mt-1 text-xs font-medium text-(--color-amber)">&#9888; DON'T HIT: {@html highlightNames(eAdvice.dont_hit, nFrags)}</p>
						{/if}
					</div>
				</details>
			{/if}
			{#if aAdvice?.advice}
				<details open class="mt-2">
					<summary class="text-[9px] font-bold uppercase tracking-wider text-(--color-text-tertiary)/50 cursor-pointer hover:text-(--color-text-tertiary) select-none">Ally Note</summary>
					<div class="mt-1 pl-1 border-l-2 border-(--color-border)/50 ml-1">
						<p class="text-xs leading-relaxed text-(--color-text-secondary) whitespace-pre-line">{@html highlightNames(aAdvice.advice, nFrags)}</p>
					</div>
				</details>
			{/if}

			<!-- Spec picker popup -->
			{#if isPickerOpen}
				{@const profList = Object.entries(specs.professions)}
				{@const profSpecs = getSpecsForProfession(selectedProf)}
				<div class="history-spec-picker absolute left-0 top-full z-30 mt-1 rounded-xl border border-(--color-border-strong) bg-(--color-surface-raised) p-3 shadow-lg min-w-64 animate-slide-up">
					<div class="flex flex-wrap gap-1 mb-2 pb-2 border-b border-(--color-border)/50">
						{#each profList as [profId, prof]}
							<button
								class="rounded-md px-1.5 py-1 transition-all cursor-pointer
									{profId === selectedProf
										? 'bg-(--color-accent)/15 ring-1 ring-(--color-accent)/50'
										: 'hover:bg-(--color-surface-hover)'}"
								onclick={() => (pickerProfession = profId)}
								title={prof.label}
							>
								<span class="inline-block h-6 w-6" style={specIconStyle(profId, profId)} title={prof.label}></span>
							</button>
						{/each}
					</div>
					<p class="mb-2 text-[10px] font-bold uppercase tracking-wider text-(--color-text-tertiary)">
						{getProfessionLabel(selectedProf)}
					</p>
					<div class="flex flex-wrap gap-2">
						{#each profSpecs as spec}
							<button
								class="flex flex-col items-center gap-1 rounded-lg p-2 transition-all cursor-pointer
									{spec.id === p.spec && selectedProf === p.profession
										? 'bg-(--color-accent)/15 ring-1 ring-(--color-accent)/50'
										: 'hover:bg-(--color-surface-hover)'}"
								onclick={() => selectSpec(p.characterName, selectedProf, spec.id)}
							>
								<span
									class="inline-block h-10 w-10"
									style={specIconStyle(spec.id === 'core' ? selectedProf : spec.id, selectedProf)}
									title={spec.label}
								></span>
								<span class="text-[10px] text-(--color-text-secondary) max-w-16 text-center leading-tight">
									{spec.id === 'core' ? 'Core' : spec.label}
								</span>
							</button>
						{/each}
					</div>
				</div>
			{/if}
		</div>
	{/snippet}

	<div>
		<!-- Header bar: screenshot + result/map controls (carbon copy from history lines 798-871) -->
		<div class="mb-4 flex items-center gap-4 rounded-xl border border-(--color-border) bg-(--color-bg) p-3">
			{#if match.screenshotUrl}
				<button
					class="shrink-0 cursor-pointer rounded-lg overflow-hidden border border-(--color-border) hover:border-(--color-accent)/50 transition-colors w-32"
					onclick={() => (zoomedScreenshot = match?.screenshotUrl ?? null)}
				>
					<img src={match.screenshotUrl} alt="Match screenshot" class="w-full h-auto" />
				</button>
			{/if}
			<div class="flex-1 min-w-0">
				<div class="flex items-center gap-2 mb-1.5">
					<span class="text-[10px] font-bold uppercase tracking-wider text-(--color-text-tertiary)">Result</span>
					<button
						class="rounded-lg px-3 py-1 text-xs font-bold transition-colors cursor-pointer
							{match.result === 'win'
								? 'bg-(--color-green) text-white'
								: 'border border-(--color-green)/30 text-(--color-green) hover:bg-(--color-green)/10'}"
						disabled={updatingResult}
						onclick={() => setResult(match?.result === 'win' ? null : 'win')}
					>Win</button>
					<button
						class="rounded-lg px-3 py-1 text-xs font-bold transition-colors cursor-pointer
							{match.result === 'loss'
								? 'bg-(--color-red) text-white'
								: 'border border-(--color-red)/30 text-(--color-red) hover:bg-(--color-red)/10'}"
						disabled={updatingResult}
						onclick={() => setResult(match?.result === 'loss' ? null : 'loss')}
					>Loss</button>
				</div>
				<div class="flex items-center gap-2">
					<span class="text-[10px] font-bold uppercase tracking-wider text-(--color-text-tertiary)">Map</span>
					{#if editingMap}
						<select
							class="rounded-lg bg-(--color-surface) border border-(--color-border) px-2 py-1 text-xs text-(--color-text) outline-none"
							value={match.map ?? ''}
							onchange={(e) => setMap((e.currentTarget as HTMLSelectElement).value)}
							onblur={() => (editingMap = false)}
						>
							<optgroup label="Conquest">
								{#each maps.filter(m => m.mode === 'conquest' && !m.is_default) as m}
									<option value={m.id}>{m.name}</option>
								{/each}
							</optgroup>
							<optgroup label="Push">
								{#each maps.filter(m => m.mode === 'push') as m}
									<option value={m.id}>{m.name}</option>
								{/each}
							</optgroup>
							<optgroup label="Stronghold">
								{#each maps.filter(m => m.mode === 'stronghold') as m}
									<option value={m.id}>{m.name}</option>
								{/each}
							</optgroup>
						</select>
					{:else}
						<button
							class="text-xs text-(--color-text-secondary) hover:text-(--color-accent) transition-colors cursor-pointer border-b border-dashed border-(--color-text-tertiary)/40 hover:border-(--color-accent)"
							onclick={() => (editingMap = true)}
							title="Click to change map"
						>
							{getMapName(match.map)}
						</button>
					{/if}
				</div>
			</div>
			<div class="shrink-0 flex flex-col gap-1">
				<button
					class="rounded-lg px-3 py-1.5 text-xs text-(--color-accent) hover:bg-(--color-accent)/10 transition-colors cursor-pointer"
					onclick={reAnalyze}
				>
					Re-analyze
				</button>
				<button
					class="rounded-lg px-3 py-1.5 text-xs text-(--color-text-tertiary) hover:text-(--color-accent) transition-colors cursor-pointer"
					onclick={newScan}
				>
					New Scan
				</button>
			</div>
		</div>

		<!-- Strategy advice cards (carbon copy from history lines 874-906) -->
		{#if advice && (advice.focusOrder || advice.mapAdvice || advice.gameplan || advice.babysit || advice.positioning)}
			<div class="mb-4 flex flex-col gap-2">
				{#if advice.focusOrder}
					<div class="rounded-lg border border-(--color-border) bg-(--color-surface) p-3 border-l-3 border-l-(--color-red)/60">
						<p class="text-[10px] font-bold uppercase tracking-wider text-(--color-red)/70 mb-1">Focus Order</p>
						<p class="text-sm text-(--color-text) leading-relaxed">{@html highlightNames(advice.focusOrder, nameFrags)}</p>
					</div>
				{/if}
				{#if advice.babysit}
					<div class="rounded-lg border border-(--color-border) bg-(--color-surface) p-3 border-l-3 border-l-(--color-accent)/50">
						<p class="text-[10px] font-bold uppercase tracking-wider text-(--color-accent)/70 mb-1">Babysit</p>
						<p class="text-xs leading-relaxed text-(--color-text-secondary) whitespace-pre-line">{@html highlightNames(advice.babysit, nameFrags)}</p>
					</div>
				{/if}
				{#if advice.mapAdvice}
					<div class="rounded-lg border border-(--color-border) bg-(--color-surface) p-3 border-l-3 border-l-(--color-amber)/60">
						<p class="text-[10px] font-bold uppercase tracking-wider text-(--color-amber)/70 mb-1">Map Opening</p>
						<p class="text-xs leading-relaxed text-(--color-text-secondary) whitespace-pre-line">{@html highlightNames(advice.mapAdvice, nameFrags)}</p>
					</div>
				{/if}
				{#if advice.gameplan}
					<div class="rounded-lg border border-(--color-border) bg-(--color-surface) p-3 border-l-3 border-l-(--color-green)/60">
						<p class="text-[10px] font-bold uppercase tracking-wider text-(--color-green)/70 mb-1">Gameplan</p>
						<p class="text-xs leading-relaxed text-(--color-text-secondary) whitespace-pre-line">{@html highlightNames(advice.gameplan, nameFrags)}</p>
					</div>
				{/if}
				{#if advice.positioning}
					<div class="rounded-lg border border-(--color-border) bg-(--color-surface) p-3 border-l-3 border-l-(--color-text-tertiary)/50">
						<p class="text-[10px] font-bold uppercase tracking-wider text-(--color-text-tertiary)/70 mb-1">Positioning</p>
						<p class="text-xs leading-relaxed text-(--color-text-secondary) whitespace-pre-line">{@html highlightNames(advice.positioning, nameFrags)}</p>
					</div>
				{/if}
			</div>
		{/if}

		<!-- Teams grid: Red left, Blue right (carbon copy from history lines 909-952) -->
		<div class="grid grid-cols-2 gap-4">
			<!-- Red team -->
			<div>
				<div class="mb-2 flex items-center gap-2">
					<div class="h-2 w-2 rounded-full bg-(--color-team-red)"></div>
					<h2 class="text-xs font-bold uppercase tracking-widest text-(--color-text-secondary)">
						Red Team
						{#if match.userTeamColor === 'red'}
							<span class="font-normal text-(--color-amber)/60 ml-1">(you)</span>
						{/if}
					</h2>
				</div>
				<div class="flex flex-col gap-1.5">
					{#each redTeamMatch as p, i}
						{@const side = match.userTeamColor === 'red' ? 'my' : 'enemy'}
						{@const teamPlayers = side === 'my' ? myTeamPlayers : enemyTeamPlayers}
						{@const pIdx = teamPlayers.findIndex(tp => tp.characterName === p.characterName)}
						{@render playerRowWithAdvice(p, match, side, pIdx >= 0 ? pIdx : i, advice, nameFrags)}
					{/each}
				</div>
			</div>

			<!-- Blue team -->
			<div>
				<div class="mb-2 flex items-center gap-2">
					<div class="h-2 w-2 rounded-full bg-(--color-team-blue)"></div>
					<h2 class="text-xs font-bold uppercase tracking-widest text-(--color-text-secondary)">
						Blue Team
						{#if match.userTeamColor === 'blue'}
							<span class="font-normal text-(--color-amber)/60 ml-1">(you)</span>
						{/if}
					</h2>
				</div>
				<div class="flex flex-col gap-1.5">
					{#each blueTeamMatch as p, i}
						{@const side = match.userTeamColor === 'blue' ? 'my' : 'enemy'}
						{@const teamPlayers = side === 'my' ? myTeamPlayers : enemyTeamPlayers}
						{@const pIdx = teamPlayers.findIndex(tp => tp.characterName === p.characterName)}
						{@render playerRowWithAdvice(p, match, side, pIdx >= 0 ? pIdx : i, advice, nameFrags)}
					{/each}
				</div>
			</div>
		</div>

		<!-- Win/Loss sticky bottom bar -->
		<div class="fixed bottom-0 left-0 right-0 z-30 border-t border-(--color-border) bg-(--color-bg)/95 backdrop-blur-sm">
			<div class="mx-auto max-w-5xl flex gap-3 px-6 py-3">
				<button
					class="flex-1 rounded-xl border border-(--color-green)/30 bg-(--color-green)/10 py-2.5 text-sm font-bold text-(--color-green) hover:bg-(--color-green)/20 transition-colors cursor-pointer
						{match.result === 'win' ? 'ring-2 ring-(--color-green)' : ''}"
					disabled={recordingResult}
					onclick={() => recordResult('win')}
				>
					{recordingResult ? '...' : 'Win'}
				</button>
				<button
					class="flex-1 rounded-xl border border-(--color-red)/30 bg-(--color-red)/10 py-2.5 text-sm font-bold text-(--color-red) hover:bg-(--color-red)/20 transition-colors cursor-pointer
						{match.result === 'loss' ? 'ring-2 ring-(--color-red)' : ''}"
					disabled={recordingResult}
					onclick={() => recordResult('loss')}
				>
					{recordingResult ? '...' : 'Loss'}
				</button>
			</div>
		</div>
		<!-- Spacer so content isn't hidden behind sticky bar -->
		<div class="h-16"></div>
	</div>
{/if}

<!-- Screenshot zoom modal -->
{#if zoomedScreenshot}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm cursor-pointer animate-fade-in"
		onclick={() => (zoomedScreenshot = null)}
		role="dialog"
		tabindex="-1"
	>
		<img
			src={zoomedScreenshot}
			alt="Match screenshot (zoomed)"
			class="max-w-[95vw] max-h-[95vh] object-contain rounded-lg shadow-2xl animate-modal-in"
		/>
	</div>
{/if}
