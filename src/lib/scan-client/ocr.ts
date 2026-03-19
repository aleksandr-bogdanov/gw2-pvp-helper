/**
 * Browser-side OCR using Tesseract.js (browser mode).
 *
 * Tesseract.js is already a project dependency and works in browsers natively.
 * Uses a single worker with SINGLE_LINE PSM mode optimized for GW2 player names.
 * The worker downloads ~15MB of training data on first use (cached by browser).
 */
import type { RawImage } from './types.js';

/** OCR result with confidence */
export interface OCRResult {
	text: string;
	/** Confidence 0–100 */
	confidence: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ocrWorker: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ocrLoading: Promise<any> | null = null;

/** Progress callback type */
export type OCRProgressCallback = (message: string) => void;

let progressCallback: OCRProgressCallback | null = null;

/**
 * Set the progress callback for OCR initialization.
 */
export function setOCRProgressCallback(cb: OCRProgressCallback | null): void {
	progressCallback = cb;
}

/**
 * Initialize the Tesseract.js worker for browser-side OCR.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function initOCR(): Promise<any> {
	progressCallback?.('Downloading OCR engine (one-time)...');

	const Tesseract = await import(/* @vite-ignore */ 'tesseract.js');

	const worker = await Tesseract.createWorker('eng', undefined, {
		logger: () => {}
	});

	await worker.setParameters({
		tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE,
		tessedit_char_whitelist:
			"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 '-.\u00C0\u00C1\u00C2\u00C3\u00C4\u00C5\u00C6\u00C7\u00C8\u00C9\u00CA\u00CB\u00CC\u00CD\u00CE\u00CF\u00D0\u00D1\u00D2\u00D3\u00D4\u00D5\u00D6\u00D8\u00D9\u00DA\u00DB\u00DC\u00DD\u00DE\u00DF\u00E0\u00E1\u00E2\u00E3\u00E4\u00E5\u00E6\u00E7\u00E8\u00E9\u00EA\u00EB\u00EC\u00ED\u00EE\u00EF\u00F0\u00F1\u00F2\u00F3\u00F4\u00F5\u00F6\u00F8\u00F9\u00FA\u00FB\u00FC\u00FD\u00FE\u00FF"
	});

	progressCallback?.('OCR engine ready');
	return worker;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getOCR(): Promise<any> {
	if (ocrWorker) return ocrWorker;
	if (!ocrLoading) {
		ocrLoading = initOCR().then((w) => {
			ocrWorker = w;
			return w;
		});
	}
	return ocrLoading;
}

const SCALE_FACTOR = 3;

/**
 * Preprocess a name crop for OCR:
 * Scale up 3x, negate + threshold to get black text on white background.
 * Uses Canvas instead of Sharp.
 */
function preprocessNameCrop(crop: RawImage): OffscreenCanvas {
	const sw = crop.width * SCALE_FACTOR;
	const sh = crop.height * SCALE_FACTOR;

	// Render source grayscale onto canvas
	const srcCanvas = new OffscreenCanvas(crop.width, crop.height);
	const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true })!;
	const srcData = srcCtx.createImageData(crop.width, crop.height);
	for (let i = 0; i < crop.width * crop.height; i++) {
		const v = crop.data[i];
		srcData.data[i * 4] = v;
		srcData.data[i * 4 + 1] = v;
		srcData.data[i * 4 + 2] = v;
		srcData.data[i * 4 + 3] = 255;
	}
	srcCtx.putImageData(srcData, 0, 0);

	// Scale up
	const dstCanvas = new OffscreenCanvas(sw, sh);
	const dstCtx = dstCanvas.getContext('2d', { willReadFrequently: true })!;
	dstCtx.drawImage(srcCanvas, 0, 0, sw, sh);
	const scaled = dstCtx.getImageData(0, 0, sw, sh);

	// Negate + threshold: scoreboard text is white-on-dark → invert → threshold
	for (let i = 0; i < sw * sh; i++) {
		const gray = Math.round(
			0.299 * scaled.data[i * 4] +
			0.587 * scaled.data[i * 4 + 1] +
			0.114 * scaled.data[i * 4 + 2]
		);
		const inverted = 255 - gray;
		const thresholded = inverted > 128 ? 0 : 255;
		scaled.data[i * 4] = thresholded;
		scaled.data[i * 4 + 1] = thresholded;
		scaled.data[i * 4 + 2] = thresholded;
	}

	// Add white padding (15px border)
	const pad = 15;
	const pw = sw + pad * 2;
	const ph = sh + pad * 2;
	const padCanvas = new OffscreenCanvas(pw, ph);
	const padCtx = padCanvas.getContext('2d', { willReadFrequently: true })!;
	padCtx.fillStyle = 'white';
	padCtx.fillRect(0, 0, pw, ph);
	dstCtx.putImageData(scaled, 0, 0);
	padCtx.drawImage(dstCanvas, pad, pad);

	return padCanvas;
}

/**
 * Recognize a single name from a crop.
 */
export async function recognizeName(crop: RawImage): Promise<OCRResult> {
	const worker = await getOCR();
	const canvas = preprocessNameCrop(crop);
	const blob = await canvas.convertToBlob({ type: 'image/png' });

	const result = await worker.recognize(blob);
	return {
		text: result.data.text.trim(),
		confidence: result.data.confidence
	};
}

/**
 * Recognize all 10 player names.
 * Sequential in browser (single worker, no pool).
 */
export async function recognizeNames(crops: RawImage[]): Promise<OCRResult[]> {
	const results: OCRResult[] = [];
	for (const crop of crops) {
		results.push(await recognizeName(crop));
	}
	return results;
}
