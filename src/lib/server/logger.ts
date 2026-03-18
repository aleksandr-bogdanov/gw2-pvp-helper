import pino from 'pino';

export const logger = pino({
	level: process.env.LOG_LEVEL ?? 'info',
	formatters: {
		level(label) {
			return { level: label };
		}
	},
	timestamp: pino.stdTimeFunctions.isoTime
});

/**
 * Create a child logger scoped to a specific event/request context.
 * Every log line from a child includes the bound fields automatically.
 */
export function createRequestLogger(fields: { event?: string; userId?: number | null; requestId?: string }) {
	return logger.child(fields);
}
