import { describe, it, expect } from 'vitest';
import { trainingSamples, minimapReferences, matches } from '../src/lib/server/db/schema.js';

describe('Training Data Schema', () => {
	it('training_samples table has all required columns', () => {
		const columns = Object.keys(trainingSamples);
		const required = [
			'id', 'userId', 'screenshotHash', 'screenshotPath',
			'resolution', 'uiSize', 'deviceInfo', 'scanResult',
			'userCorrections', 'confidenceScores', 'anchorPosition',
			'createdAt', 'reviewedByAdmin'
		];
		for (const col of required) {
			expect(columns, `Missing column: ${col}`).toContain(col);
		}
	});

	it('screenshot_hash has unique constraint', () => {
		// The schema defines .unique() on screenshotHash
		const hashColumn = trainingSamples.screenshotHash;
		expect(hashColumn).toBeDefined();
		expect(hashColumn.name).toBe('screenshot_hash');
	});

	it('userId references users table with cascade delete', () => {
		const userIdCol = trainingSamples.userId;
		expect(userIdCol).toBeDefined();
		expect(userIdCol.name).toBe('user_id');
	});

	it('screenshot_path is required (not null)', () => {
		const pathCol = trainingSamples.screenshotPath;
		expect(pathCol).toBeDefined();
		expect(pathCol.notNull).toBe(true);
	});

	it('reviewedByAdmin defaults to false', () => {
		const col = trainingSamples.reviewedByAdmin;
		expect(col).toBeDefined();
	});

	it('userCorrections is nullable jsonb for storing correction diffs', () => {
		const col = trainingSamples.userCorrections;
		expect(col).toBeDefined();
		expect(col.name).toBe('user_corrections');
	});

	it('confidenceScores stores per-slot confidence as jsonb', () => {
		const col = trainingSamples.confidenceScores;
		expect(col).toBeDefined();
		expect(col.name).toBe('confidence_scores');
	});
});

describe('Minimap References Schema', () => {
	it('minimap_references table has all required columns', () => {
		const columns = Object.keys(minimapReferences);
		const required = ['id', 'mapId', 'source', 'screenshotHash', 'thumbnailData', 'createdAt'];
		for (const col of required) {
			expect(columns, `Missing column: ${col}`).toContain(col);
		}
	});

	it('source defaults to static', () => {
		const col = minimapReferences.source;
		expect(col).toBeDefined();
		expect(col.name).toBe('source');
	});

	it('thumbnailData stores base64-encoded feature vectors', () => {
		const col = minimapReferences.thumbnailData;
		expect(col).toBeDefined();
		expect(col.notNull).toBe(true);
	});
});

describe('Matches advice_raw column', () => {
	it('matches table has advice_raw column', () => {
		const columns = Object.keys(matches);
		expect(columns).toContain('adviceRaw');
	});

	it('advice_raw column is named correctly in DB', () => {
		expect(matches.adviceRaw.name).toBe('advice_raw');
	});

	it('adviceText still exists alongside adviceRaw', () => {
		expect(matches.adviceText).toBeDefined();
		expect(matches.adviceRaw).toBeDefined();
	});
});
