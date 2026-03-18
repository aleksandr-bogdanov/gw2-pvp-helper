import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { resolve } from 'path';

describe('data path resolution', () => {
	const scanDir = resolve(process.cwd(), 'src', 'lib', 'server', 'scan');
	const scanFiles = readdirSync(scanDir).filter((f) => f.endsWith('.ts'));

	it('no __dirname references remain in src/lib/server/scan/', () => {
		for (const file of scanFiles) {
			const content = readFileSync(resolve(scanDir, file), 'utf-8');
			expect(content, `${file} should not contain __dirname`).not.toContain('__dirname');
		}
	});

	it('all data path resolvers use process.cwd() base', () => {
		for (const file of scanFiles) {
			const content = readFileSync(resolve(scanDir, file), 'utf-8');
			// Find all resolve() calls that reference 'data' directory
			const resolveMatches = content.match(/resolve\([^)]*['"]data['"]/g);
			if (resolveMatches) {
				for (const match of resolveMatches) {
					expect(match, `${file}: resolve() with 'data' should use process.cwd()`).toContain(
						'process.cwd()'
					);
				}
			}
		}
	});

	it('data/profession-icons/wiki-big directory exists', () => {
		const dir = resolve(process.cwd(), 'data', 'profession-icons', 'wiki-big');
		expect(existsSync(dir), `${dir} should exist`).toBe(true);
	});

	it('data/x-templates directory exists', () => {
		const dir = resolve(process.cwd(), 'data', 'x-templates');
		expect(existsSync(dir), `${dir} should exist`).toBe(true);
	});

	it('data/minimap-references/thumbs directory exists', () => {
		const dir = resolve(process.cwd(), 'data', 'minimap-references', 'thumbs');
		expect(existsSync(dir), `${dir} should exist`).toBe(true);
	});
});
