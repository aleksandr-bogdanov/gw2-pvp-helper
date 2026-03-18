import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { decodeBuildTemplate, formatBuildForPrompt } from '$lib/server/build-decode.js';

export const POST: RequestHandler = async ({ request }) => {
	const { buildCode } = await request.json();

	if (!buildCode || typeof buildCode !== 'string') {
		throw error(400, 'Missing buildCode');
	}

	try {
		const build = await decodeBuildTemplate(buildCode);
		return json({
			build,
			formatted: formatBuildForPrompt(build)
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to decode build code';
		throw error(400, message);
	}
};
