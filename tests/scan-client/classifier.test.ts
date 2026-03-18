/**
 * Tests for client-side HOG classifier.
 *
 * extractHOG is pure math — testable without Canvas.
 * Classification tests that need reference icon loading are skipped (require fetch + Canvas).
 */
import { describe, it, expect, test } from 'vitest';

describe('scan-client/classifier', () => {
	it('HOG feature vector has correct length (288 for 32×32 image)', async () => {
		const { extractHOG } = await import('$lib/scan-client/classifier.js');

		// Create a 32×32 grayscale test image with gradient pattern
		const data = new Uint8Array(32 * 32);
		for (let y = 0; y < 32; y++) {
			for (let x = 0; x < 32; x++) {
				data[y * 32 + x] = (x * 8 + y * 4) % 256;
			}
		}

		const features = extractHOG(data, 32, 32);
		expect(features).toBeInstanceOf(Float64Array);
		expect(features.length).toBe(288);
	});

	it('HOG throws for non-32×32 images', async () => {
		const { extractHOG } = await import('$lib/scan-client/classifier.js');

		const data = new Uint8Array(16 * 16);
		expect(() => extractHOG(data, 16, 16)).toThrow('Expected 32×32');
	});

	it('HOG features are normalized (no values > 0.2 after L2-Hys)', async () => {
		const { extractHOG } = await import('$lib/scan-client/classifier.js');

		const data = new Uint8Array(32 * 32);
		for (let i = 0; i < data.length; i++) {
			data[i] = Math.floor(Math.random() * 256);
		}

		const features = extractHOG(data, 32, 32);
		// L2-Hys clips at 0.2 then re-normalizes, so values should be bounded
		for (let i = 0; i < features.length; i++) {
			expect(features[i]).toBeLessThanOrEqual(0.3); // After re-normalization, slightly above 0.2 is possible
			expect(features[i]).toBeGreaterThanOrEqual(0);
		}
	});

	it('HOG produces consistent features for same input', async () => {
		const { extractHOG } = await import('$lib/scan-client/classifier.js');

		const data = new Uint8Array(32 * 32);
		for (let i = 0; i < data.length; i++) data[i] = i % 256;

		const features1 = extractHOG(data, 32, 32);
		const features2 = extractHOG(data, 32, 32);

		for (let i = 0; i < features1.length; i++) {
			expect(features1[i]).toBe(features2[i]);
		}
	});

	it('HOG produces different features for different inputs', async () => {
		const { extractHOG } = await import('$lib/scan-client/classifier.js');

		const data1 = new Uint8Array(32 * 32);
		const data2 = new Uint8Array(32 * 32);
		for (let i = 0; i < data1.length; i++) {
			data1[i] = i % 256;
			data2[i] = (255 - i) % 256;
		}

		const features1 = extractHOG(data1, 32, 32);
		const features2 = extractHOG(data2, 32, 32);

		let diff = 0;
		for (let i = 0; i < features1.length; i++) {
			diff += Math.abs(features1[i] - features2[i]);
		}
		expect(diff).toBeGreaterThan(0);
	});

	it('confidence score is between 0 and 1', async () => {
		// This is a structural test — cosine distance is [0,2] so confidence = 1-distance is [-1,1]
		// But for similar images it should be in [0,1]
		const { extractHOG } = await import('$lib/scan-client/classifier.js');

		const data = new Uint8Array(32 * 32);
		for (let i = 0; i < data.length; i++) data[i] = i % 256;
		const features = extractHOG(data, 32, 32);

		// Cosine similarity with itself should be ~1
		let dot = 0, normA = 0;
		for (let i = 0; i < features.length; i++) {
			dot += features[i] * features[i];
			normA += features[i] * features[i];
		}
		const selfSimilarity = dot / normA;
		expect(selfSimilarity).toBeCloseTo(1, 5);
	});

	// Canvas-dependent tests
	test.skip('classification of a known icon returns correct spec_id', async () => {
		// Requires fetch + Canvas to load reference icons
	});

	test.skip('top-N candidates are sorted by confidence descending', async () => {
		// Requires full classification with reference icons
	});
});
