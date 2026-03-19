import { sveltekit } from '@sveltejs/kit/vite';
import { sentrySvelteKit } from '@sentry/sveltekit';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sentrySvelteKit({
			sourceMapsUploadOptions: {
				org: process.env.SENTRY_ORG,
				project: process.env.SENTRY_PROJECT,
				authToken: process.env.SENTRY_AUTH_TOKEN
			},
			autoUploadSourceMaps: !!process.env.SENTRY_AUTH_TOKEN
		}),
		tailwindcss(),
		sveltekit()
	],
	server: {
		port: 5174,
		allowedHosts: true
	},
	optimizeDeps: {
		include: ['tesseract.js']
	},
	ssr: {
		external: [
			'@opentelemetry/api',
			'pino',
			'sharp'
		]
	}
});
