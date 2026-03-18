import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('scan pipeline configuration', () => {
	it('NUM_WORKERS constant equals 2 in ocr.ts', () => {
		// Read the file directly to avoid importing Tesseract/Sharp side effects
		const ocrSource = readFileSync(
			resolve(process.cwd(), 'src', 'lib', 'server', 'scan', 'ocr.ts'),
			'utf-8'
		);

		// Match the constant declaration
		const match = ocrSource.match(/const\s+NUM_WORKERS\s*=\s*(\d+)/);
		expect(match, 'NUM_WORKERS declaration should exist in ocr.ts').not.toBeNull();
		expect(parseInt(match![1], 10)).toBe(2);
	});
});
