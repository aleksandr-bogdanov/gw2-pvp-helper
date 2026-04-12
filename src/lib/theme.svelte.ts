import { browser } from '$app/environment';

export const themes = [
	{ id: 'legacy', label: 'Legacy' },
	{ id: 'whendoist-light', label: 'Light' },
	{ id: 'whendoist-dark', label: 'Dark' }
] as const;

export type ThemeId = (typeof themes)[number]['id'];

function readSaved(): ThemeId {
	if (!browser) return 'legacy';
	const saved = localStorage.getItem('gw2-theme') as ThemeId | null;
	if (saved && themes.some((t) => t.id === saved)) return saved;
	return 'legacy';
}

export const theme = $state({ current: readSaved() });

export function applyTheme() {
	if (!browser) return;
	const html = document.documentElement;
	if (theme.current === 'legacy') {
		html.removeAttribute('data-theme');
	} else {
		html.setAttribute('data-theme', theme.current);
	}
	localStorage.setItem('gw2-theme', theme.current);
}

export function cycleTheme() {
	const idx = themes.findIndex((t) => t.id === theme.current);
	theme.current = themes[(idx + 1) % themes.length].id;
	applyTheme();
}
