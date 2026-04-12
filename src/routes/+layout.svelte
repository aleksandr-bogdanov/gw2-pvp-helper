<script lang="ts">
	import '../app.css';
	import { applyTheme, theme } from '$lib/theme.svelte.js';

	let { children } = $props();

	$effect(() => {
		// Track theme.current to re-apply on change
		void theme.current;
		applyTheme();
	});
</script>

{@render children()}
