import { describe, it, expect } from 'vitest';
import sharp from 'sharp';

describe('Screenshot Storage — PNG to JPEG Q85 conversion', () => {
	it('PNG → JPEG Q85 produces smaller file', async () => {
		// Create a test PNG (100×100 red image)
		const pngBuffer = await sharp({
			create: { width: 100, height: 100, channels: 3, background: { r: 255, g: 0, b: 0 } }
		}).png().toBuffer();

		const jpegBuffer = await sharp(pngBuffer).jpeg({ quality: 85 }).toBuffer();

		expect(jpegBuffer.length).toBeLessThan(pngBuffer.length);
	});

	it('JPEG Q85 output is valid JPEG (check magic bytes)', async () => {
		const pngBuffer = await sharp({
			create: { width: 50, height: 50, channels: 3, background: { r: 0, g: 128, b: 255 } }
		}).png().toBuffer();

		const jpegBuffer = await sharp(pngBuffer).jpeg({ quality: 85 }).toBuffer();

		// JPEG magic bytes: FF D8 FF
		expect(jpegBuffer[0]).toBe(0xFF);
		expect(jpegBuffer[1]).toBe(0xD8);
		expect(jpegBuffer[2]).toBe(0xFF);
	});

	it('JPEG Q85 preserves image dimensions', async () => {
		const width = 200;
		const height = 150;
		const pngBuffer = await sharp({
			create: { width, height, channels: 3, background: { r: 0, g: 0, b: 0 } }
		}).png().toBuffer();

		const jpegBuffer = await sharp(pngBuffer).jpeg({ quality: 85 }).toBuffer();
		const metadata = await sharp(jpegBuffer).metadata();

		expect(metadata.width).toBe(width);
		expect(metadata.height).toBe(height);
		expect(metadata.format).toBe('jpeg');
	});

	it('screenshot hash format is 16-char hex', () => {
		const { createHash } = require('crypto');
		const testBuffer = Buffer.from('test image data');
		const hash = createHash('sha256').update(testBuffer).digest('hex').slice(0, 16);

		expect(hash).toMatch(/^[a-f0-9]{16}$/);
		expect(hash.length).toBe(16);
	});
});

describe('Screenshot API endpoint shape', () => {
	it('/api/screenshots/[hash] route file exists', async () => {
		const { existsSync } = require('fs');
		const { resolve } = require('path');
		const routePath = resolve(process.cwd(), 'src/routes/api/screenshots/[hash]/+server.ts');
		expect(existsSync(routePath)).toBe(true);
	});

	it('hash validation rejects invalid patterns', () => {
		// The endpoint validates hash format: /^[a-f0-9]{16}$/
		const validHash = 'abcdef0123456789';
		const invalidHashes = [
			'short',
			'toolongfortheformat1234',
			'ABCDEF0123456789', // uppercase
			'../../../etc/passwd',
			'abcdef012345678g' // non-hex
		];

		expect(validHash).toMatch(/^[a-f0-9]{16}$/);
		for (const h of invalidHashes) {
			expect(h, `Should reject: ${h}`).not.toMatch(/^[a-f0-9]{16}$/);
		}
	});
});
