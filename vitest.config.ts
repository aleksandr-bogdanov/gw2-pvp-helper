import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
	plugins: [svelte()],
	test: {
		environment: 'jsdom',
		include: ['tests/**/*.test.ts'],
		fileParallelism: false
	},
	resolve: {
		alias: {
			$lib: path.resolve('./src/lib')
		}
	}
});
