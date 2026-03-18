import type { RequestHandler } from './$types.js';
import { error } from '@sveltejs/kit';
import { existsSync, createReadStream } from 'fs';
import { resolve } from 'path';
import { Readable } from 'stream';

const SCREENSHOTS_DIR = process.env.SCREENSHOTS_DIR || resolve('static', 'screenshots');

export const GET: RequestHandler = async ({ params }) => {
	const { hash } = params;

	if (!hash || !/^[a-f0-9]{16}$/.test(hash)) {
		throw error(400, 'Invalid screenshot hash');
	}

	// Try JPEG first (preferred after migration), then PNG (legacy)
	for (const ext of ['jpg', 'jpeg', 'png'] as const) {
		const filePath = resolve(SCREENSHOTS_DIR, `${hash}.${ext}`);
		if (existsSync(filePath)) {
			const contentType = ext === 'png' ? 'image/png' : 'image/jpeg';
			const stream = createReadStream(filePath);
			const webStream = Readable.toWeb(stream) as ReadableStream;

			return new Response(webStream, {
				headers: {
					'Content-Type': contentType,
					'Cache-Control': 'public, max-age=86400'
				}
			});
		}
	}

	throw error(404, 'Screenshot not found');
};
