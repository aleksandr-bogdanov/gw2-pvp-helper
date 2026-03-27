/**
 * Player name OCR using Tesseract.js.
 *
 * 4-worker pool with PSM SINGLE_LINE mode and GW2 character whitelist.
 * Preprocessing: scale 3x → negate → threshold 128 → trim black borders → re-pad white.
 *
 * The trim step is critical: after negate+threshold, dark scoreboard background becomes
 * large black regions. Without trimming, Tesseract gets confused by black blocks adjacent
 * to white padding and returns empty strings for short names.
 *
 * Accuracy: ~80% on labeled fixtures. Known limitations:
 * - Spurious spaces in short letter clusters ("xtx" → "xt x")
 * - Lowercase l/i confusion in small fonts ("Dlc" → "Dic")
 * - Very short names (<5 chars) occasionally fail
 * These are acceptable since the app has manual correction UI.
 *
 * Performance: ~3s for 10 names (warm), ~4s cold start (worker init).
 */

import Tesseract from 'tesseract.js';
import sharp from 'sharp';
import type { RawImage } from './types.js';

const NUM_WORKERS = 2;
const SCALE_FACTOR = 3; // Scale up small crops for better OCR accuracy

let scheduler: Tesseract.Scheduler | null = null;
let schedulerInit: Promise<Tesseract.Scheduler> | null = null;

async function getScheduler(): Promise<Tesseract.Scheduler> {
	if (scheduler) return scheduler;
	if (!schedulerInit) {
		schedulerInit = initScheduler().catch((err) => {
			// Clear the cached promise so the next call retries initialization
			// instead of returning the same rejected promise forever.
			schedulerInit = null;
			throw err;
		});
	}
	return schedulerInit;
}

async function initScheduler(): Promise<Tesseract.Scheduler> {
	const s = Tesseract.createScheduler();

	for (let i = 0; i < NUM_WORKERS; i++) {
		const worker = await Tesseract.createWorker('eng', undefined, {
			// Suppress console logging
			logger: () => {}
		});

		await worker.setParameters({
			// Single text line mode — critical for name crops
			tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE,
			// Character whitelist for GW2 names
			// GW2 allows: letters (including accented), spaces, hyphens, apostrophes, periods
			tessedit_char_whitelist:
				"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 '-.\u00C0\u00C1\u00C2\u00C3\u00C4\u00C5\u00C6\u00C7\u00C8\u00C9\u00CA\u00CB\u00CC\u00CD\u00CE\u00CF\u00D0\u00D1\u00D2\u00D3\u00D4\u00D5\u00D6\u00D8\u00D9\u00DA\u00DB\u00DC\u00DD\u00DE\u00DF\u00E0\u00E1\u00E2\u00E3\u00E4\u00E5\u00E6\u00E7\u00E8\u00E9\u00EA\u00EB\u00EC\u00ED\u00EE\u00EF\u00F0\u00F1\u00F2\u00F3\u00F4\u00F5\u00F6\u00F8\u00F9\u00FA\u00FB\u00FC\u00FD\u00FE\u00FF"
		});

		s.addWorker(worker);
	}

	scheduler = s;
	return s;
}

/**
 * Preprocess a name crop for OCR:
 * 1. Convert to grayscale
 * 2. Scale up 3x for better accuracy
 * 3. Threshold to get clean black text on white background
 * 4. Add white border padding
 */
async function preprocessNameCrop(crop: RawImage): Promise<Buffer> {
	// Convert raw grayscale to sharp buffer
	const buf = Buffer.from(crop.data);

	// Step 1: Scale up, invert, threshold to get clean black text on white background
	const binarized = await sharp(buf, {
		raw: { width: crop.width, height: crop.height, channels: 1 }
	})
		.resize(crop.width * SCALE_FACTOR, crop.height * SCALE_FACTOR, {
			kernel: 'lanczos3'
		})
		.negate()
		.threshold(128)
		.png()
		.toBuffer();

	// Step 2: Trim black borders (scoreboard background becomes black after negate+threshold),
	// then re-pad with white. Without this, Tesseract gets confused by large black regions.
	const processed = await sharp(binarized)
		.trim({ background: '#000000', threshold: 10 })
		.extend({
			top: 15,
			bottom: 15,
			left: 15,
			right: 15,
			background: { r: 255, g: 255, b: 255 }
		})
		.withMetadata({ density: 150 })
		.png()
		.toBuffer();

	return processed;
}

/** OCR result with confidence */
export interface OCRResult {
	text: string;
	/** Tesseract confidence 0–100 */
	confidence: number;
}

/**
 * Recognize a single name from a crop.
 */
export async function recognizeName(crop: RawImage): Promise<OCRResult> {
	const s = await getScheduler();
	const processed = await preprocessNameCrop(crop);

	const result = await s.addJob('recognize', processed);
	return {
		text: result.data.text.trim(),
		confidence: result.data.confidence
	};
}

/**
 * Recognize all 10 player names in parallel using the worker pool.
 */
export async function recognizeNames(crops: RawImage[]): Promise<OCRResult[]> {
	const s = await getScheduler();

	// Preprocess all crops
	const processed = await Promise.all(crops.map((crop) => preprocessNameCrop(crop)));

	// Submit all to scheduler (it distributes across workers automatically)
	const results = await Promise.all(processed.map((buf) => s.addJob('recognize', buf)));

	return results.map((r) => ({
		text: r.data.text.trim(),
		confidence: r.data.confidence
	}));
}

/**
 * Pre-warm the OCR engine by initializing the worker pool.
 * Call this at server startup to avoid cold start on first scan.
 */
export async function warmupOCR(): Promise<void> {
	await getScheduler();
}

/**
 * Clean up the OCR worker pool.
 */
export async function terminateOCR(): Promise<void> {
	if (scheduler) {
		await scheduler.terminate();
		scheduler = null;
		schedulerInit = null;
	}
}
