/**
 * Save a screenshot as a test fixture via the running dev server.
 *
 * Usage:
 *   npx tsx tests/save-fixture.ts <fixture-name>
 *
 * Then paste a screenshot (Ctrl+V) into the terminal prompt.
 * Or provide a file path as second argument:
 *   npx tsx tests/save-fixture.ts skyhammer /path/to/screenshot.png
 */

import { copyFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const name = process.argv[2];
const srcPath = process.argv[3];

if (!name || !srcPath) {
	console.log('Usage: npx tsx tests/save-fixture.ts <name> <path-to-screenshot.png>');
	console.log('Example: npx tsx tests/save-fixture.ts skyhammer ~/Desktop/screenshot.png');
	process.exit(1);
}

const dest = resolve(__dirname, 'fixtures', `${name}.png`);
copyFileSync(srcPath, dest);
console.log(`Saved: ${dest}`);
