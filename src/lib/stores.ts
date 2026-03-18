import type { ScanResult, PlayerInfo } from './types.js';

// Module-level reactive state using Svelte 5 runes is not supported outside .svelte files.
// Instead, we use a simple module-level store pattern with getters/setters
// that components can import and use within their own $state.

// This file exports helper functions. Actual reactive state lives in components
// or is passed via SvelteKit's page data / URL state.

export function enrichPlayerWithDefaults(player: PlayerInfo): PlayerInfo {
	return {
		...player,
		spec_source: player.spec_source ?? 'detected'
	};
}

export function enrichScanResult(result: ScanResult): ScanResult {
	return {
		...result,
		red_team: result.red_team.map(enrichPlayerWithDefaults),
		blue_team: result.blue_team.map(enrichPlayerWithDefaults)
	};
}
