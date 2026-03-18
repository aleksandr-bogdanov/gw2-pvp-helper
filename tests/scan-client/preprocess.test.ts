/**
 * Tests for client-side preprocessing module.
 *
 * NOTE: Most tests are skipped because jsdom doesn't support Canvas/OffscreenCanvas/ImageBitmap.
 * These need to be tested in a real browser or with a canvas polyfill.
 * The real validation is manual testing with actual screenshots.
 */
import { describe, it, expect, test } from 'vitest';

describe('scan-client/preprocess', () => {
	// Pure math function — can test without Canvas
	it('extractROI returns correct dimensions', async () => {
		// extractROI is pure array math, no Canvas needed
		// Import dynamically to avoid OffscreenCanvas errors at module level
		const { extractROI } = await import('$lib/scan-client/preprocess.js');

		const image = {
			data: new Uint8Array(100 * 100), // 100x100 grayscale
			width: 100,
			height: 100,
			channels: 1 as const
		};
		// Fill with pattern
		for (let y = 0; y < 100; y++) {
			for (let x = 0; x < 100; x++) {
				image.data[y * 100 + x] = (x + y) % 256;
			}
		}

		const roi = extractROI(image, 10, 20, 30, 40);
		expect(roi.width).toBe(30);
		expect(roi.height).toBe(40);
		expect(roi.channels).toBe(1);
		expect(roi.data.length).toBe(30 * 40);

		// Verify pixel at (0,0) of ROI = pixel at (10,20) of original
		expect(roi.data[0]).toBe(image.data[20 * 100 + 10]);
	});

	it('extractROI clamps to image bounds', async () => {
		const { extractROI } = await import('$lib/scan-client/preprocess.js');

		const image = {
			data: new Uint8Array(50 * 50),
			width: 50,
			height: 50,
			channels: 1 as const
		};

		// Request ROI that extends beyond image
		const roi = extractROI(image, 40, 40, 30, 30);
		expect(roi.width).toBe(10); // Clamped: 50-40=10
		expect(roi.height).toBe(10);
	});

	it('extractROI works with RGB (3-channel) images', async () => {
		const { extractROI } = await import('$lib/scan-client/preprocess.js');

		const image = {
			data: new Uint8Array(10 * 10 * 3),
			width: 10,
			height: 10,
			channels: 3 as const
		};
		// Fill with R=x, G=y, B=x+y
		for (let y = 0; y < 10; y++) {
			for (let x = 0; x < 10; x++) {
				const idx = (y * 10 + x) * 3;
				image.data[idx] = x;
				image.data[idx + 1] = y;
				image.data[idx + 2] = x + y;
			}
		}

		const roi = extractROI(image, 2, 3, 5, 4);
		expect(roi.width).toBe(5);
		expect(roi.height).toBe(4);
		expect(roi.channels).toBe(3);
		expect(roi.data.length).toBe(5 * 4 * 3);

		// Check first pixel: should be (2, 3) from original → R=2, G=3, B=5
		expect(roi.data[0]).toBe(2);
		expect(roi.data[1]).toBe(3);
		expect(roi.data[2]).toBe(5);
	});

	// Canvas-dependent tests — skip in jsdom
	test.skip('loadImageFromBlob creates valid ImageBitmap from test PNG', async () => {
		// Requires real browser Canvas support
	});

	test.skip('resizeGrayscale produces single-channel output at target size', async () => {
		// Requires OffscreenCanvas
	});

	test.skip('getRawPixels returns Uint8Array of correct length', async () => {
		// Requires OffscreenCanvas
	});

	test.skip('loadReferenceIcon converts RGBA to white-on-black grayscale', async () => {
		// Requires fetch + OffscreenCanvas
	});
});
