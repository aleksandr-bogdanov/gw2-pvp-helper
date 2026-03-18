import * as Sentry from '@sentry/sveltekit';

const dsn = import.meta.env.VITE_SENTRY_DSN;

if (dsn) {
	Sentry.init({
		dsn,
		tracesSampleRate: 1.0,
		replaysSessionSampleRate: 0.1,
		replaysOnErrorSampleRate: 1.0,
		environment: import.meta.env.MODE
	});
}

export const handleError = dsn ? Sentry.handleErrorWithSentry() : undefined;
