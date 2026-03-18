import { describe, it, expect } from 'vitest';
import { minimapReferences } from '../src/lib/server/db/schema.js';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

describe('Minimap References DB Schema', () => {
	it('minimap_references table has correct columns', () => {
		const columns = Object.keys(minimapReferences);
		expect(columns).toContain('id');
		expect(columns).toContain('mapId');
		expect(columns).toContain('source');
		expect(columns).toContain('screenshotHash');
		expect(columns).toContain('thumbnailData');
		expect(columns).toContain('createdAt');
	});

	it('source column defaults to static', () => {
		expect(minimapReferences.source.name).toBe('source');
	});

	it('thumbnailData is not nullable (required for feature storage)', () => {
		expect(minimapReferences.thumbnailData.notNull).toBe(true);
	});

	it('screenshotHash is nullable (static refs have no hash)', () => {
		expect(minimapReferences.screenshotHash.notNull).toBeFalsy();
	});
});

describe('Minimap manifest seeding data', () => {
	const manifestPath = resolve(process.cwd(), 'data', 'minimap-references', 'thumbs', 'manifest.json');

	it('manifest.json exists in thumbs directory', () => {
		expect(existsSync(manifestPath)).toBe(true);
	});

	it('manifest has correct shape (mapId + file entries)', () => {
		const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
		expect(Array.isArray(manifest)).toBe(true);
		expect(manifest.length).toBeGreaterThan(0);

		for (const entry of manifest) {
			expect(entry).toHaveProperty('mapId');
			expect(entry).toHaveProperty('file');
			expect(typeof entry.mapId).toBe('string');
			expect(typeof entry.file).toBe('string');
		}
	});

	it('manifest contains expected number of entries (16 references)', () => {
		const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
		expect(manifest.length).toBe(16);
	});

	it('all referenced thumbnail files exist', () => {
		const thumbDir = resolve(process.cwd(), 'data', 'minimap-references', 'thumbs');
		const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

		for (const entry of manifest) {
			const filePath = resolve(thumbDir, entry.file);
			expect(existsSync(filePath), `Missing: ${entry.file}`).toBe(true);
		}
	});

	it('manifest covers multiple maps', () => {
		const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
		const uniqueMaps = new Set(manifest.map((e: { mapId: string }) => e.mapId));
		expect(uniqueMaps.size).toBeGreaterThan(3);
	});
});

describe('Minimap DB integration in minimap.ts', () => {
	it('minimap.ts imports from DB schema', () => {
		const minimapPath = resolve(process.cwd(), 'src', 'lib', 'server', 'scan', 'minimap.ts');
		const content = readFileSync(minimapPath, 'utf-8');

		expect(content).toContain('minimapReferences');
		expect(content).toContain("from '$lib/server/db/schema.js'");
		expect(content).toContain("from '$lib/server/db/index.js'");
	});

	it('minimap.ts exports seedMinimapReferences function', () => {
		const minimapPath = resolve(process.cwd(), 'src', 'lib', 'server', 'scan', 'minimap.ts');
		const content = readFileSync(minimapPath, 'utf-8');

		expect(content).toContain('export async function seedMinimapReferences');
	});

	it('minimap.ts has memory cache with invalidation', () => {
		const minimapPath = resolve(process.cwd(), 'src', 'lib', 'server', 'scan', 'minimap.ts');
		const content = readFileSync(minimapPath, 'utf-8');

		expect(content).toContain('let references: MinimapReference[] | null = null');
		expect(content).toContain('export function invalidateMinimapCache');
	});

	it('learnMinimapReference writes to DB not filesystem', () => {
		const minimapPath = resolve(process.cwd(), 'src', 'lib', 'server', 'scan', 'minimap.ts');
		const content = readFileSync(minimapPath, 'utf-8');

		// Should NOT write to filesystem learned dir
		expect(content).not.toContain('LEARNED_DIR');
		// Should write to DB
		expect(content).toContain('db.insert(minimapReferences)');
	});
});
