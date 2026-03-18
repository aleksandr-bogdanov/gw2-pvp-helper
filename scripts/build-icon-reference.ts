/**
 * Builds a labeled reference image of all GW2 profession/spec overhead icons.
 * Groups by base profession, shows all specs per row.
 *
 * Output: data/profession-icons/reference.png
 */
import sharp from 'sharp';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const ICONS_DIR = resolve(ROOT, 'data/profession-icons/wiki-big');

const specsData = JSON.parse(readFileSync(resolve(ROOT, 'src/lib/specs.json'), 'utf-8'));

const ICON_SIZE = 64;
const LABEL_HEIGHT = 20;
const ROW_HEIGHT = ICON_SIZE + LABEL_HEIGHT + 10;
const COL_WIDTH = ICON_SIZE + 10;
const PADDING = 20;
const PROF_LABEL_WIDTH = 120;

const professions = Object.entries(specsData.professions) as [string, { label: string; specs: { id: string; label: string }[] }][];

async function main() {
	const numRows = professions.length;
	const maxCols = Math.max(...professions.map(([_, p]) => p.specs.length));

	const width = PROF_LABEL_WIDTH + maxCols * COL_WIDTH + PADDING * 2;
	const height = numRows * ROW_HEIGHT + PADDING * 2;

	// Create SVG text labels and composite icons
	const composites: sharp.OverlayOptions[] = [];

	// Background
	const bgSvg = `<svg width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#1a1d27"/></svg>`;

	let y = PADDING;
	for (const [profId, prof] of professions) {
		// Profession label
		const labelSvg = Buffer.from(
			`<svg width="${PROF_LABEL_WIDTH}" height="${ROW_HEIGHT}">
				<text x="5" y="${ICON_SIZE / 2 + 5}" font-family="monospace" font-size="11" fill="#e2e4ea">${prof.label}</text>
			</svg>`
		);
		composites.push({ input: labelSvg, top: y, left: PADDING });

		let x = PADDING + PROF_LABEL_WIDTH;
		for (const spec of prof.specs) {
			const iconFile = resolve(ICONS_DIR, `${spec.id === 'core' ? profId : spec.id}.png`);
			try {
				const iconBuf = readFileSync(iconFile);
				composites.push({ input: iconBuf, top: y, left: x });
			} catch {
				// Missing icon — draw placeholder
			}

			// Spec label below icon
			const specLabel = spec.id === 'core' ? 'core' : spec.id;
			const truncLabel = specLabel.length > 10 ? specLabel.slice(0, 9) + '…' : specLabel;
			const specLabelSvg = Buffer.from(
				`<svg width="${COL_WIDTH}" height="${LABEL_HEIGHT}">
					<text x="${COL_WIDTH / 2}" y="14" font-family="monospace" font-size="9" fill="#8b8fa3" text-anchor="middle">${truncLabel}</text>
				</svg>`
			);
			composites.push({ input: specLabelSvg, top: y + ICON_SIZE + 2, left: x });

			x += COL_WIDTH;
		}
		y += ROW_HEIGHT;
	}

	const result = await sharp(Buffer.from(bgSvg))
		.composite(composites)
		.png()
		.toFile(resolve(ICONS_DIR, 'reference.png'));

	console.log(`Reference image created: ${result.width}x${result.height}`);
}

main().catch(console.error);
