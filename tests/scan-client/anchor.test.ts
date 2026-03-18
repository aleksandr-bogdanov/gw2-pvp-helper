/**
 * Tests for client-side anchor detection.
 *
 * NCC template matching is pure math but needs templates loaded via fetch.
 * Tests are skipped for jsdom — real validation is manual testing with screenshots.
 */
import { describe, test } from 'vitest';

describe('scan-client/anchor', () => {
	test.skip('NCC template matching finds anchor in a known test crop', async () => {
		// Requires fetch (for templates) + OffscreenCanvas
		// In a real browser, this would:
		// 1. Load a test screenshot fixture
		// 2. Convert to grayscale RawImage
		// 3. Call findAnchor()
		// 4. Verify anchor position matches expected coordinates
	});

	test.skip('returns null/low confidence when no X button present', async () => {
		// Requires OffscreenCanvas for image processing
		// Would test with a blank or non-scoreboard image
	});

	test.skip('team color validation disambiguates multiple X buttons', async () => {
		// Requires RGB image processing
	});

	test.skip('mode detection: Y > 300 returns push', async () => {
		// Pure math but needs the full findAnchor pipeline
	});
});
