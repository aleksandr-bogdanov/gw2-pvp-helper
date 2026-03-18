/**
 * Image preprocessing utilities using Sharp.
 * All operations produce raw pixel buffers for downstream CV operations.
 */

import sharp from 'sharp';
import type { RawImage } from './types.js';

/**
 * Load an image from a base64 string or Buffer into a raw grayscale buffer.
 */
export async function loadImageGrayscale(input: string | Buffer): Promise<RawImage> {
	const buf = typeof input === 'string' ? Buffer.from(input, 'base64') : input;
	const image = sharp(buf).grayscale();
	const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
	return {
		data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
		width: info.width,
		height: info.height,
		channels: 1
	};
}

/**
 * Load an image preserving color channels (RGB).
 */
export async function loadImageRGB(input: string | Buffer): Promise<RawImage> {
	const buf = typeof input === 'string' ? Buffer.from(input, 'base64') : input;
	const image = sharp(buf).removeAlpha().toColorspace('srgb');
	const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
	return {
		data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
		width: info.width,
		height: info.height,
		channels: 3
	};
}

/**
 * Extract a rectangular region from a raw single-channel image.
 * Pure array math — no Sharp call needed.
 */
export function extractROI(
	image: RawImage,
	x: number,
	y: number,
	width: number,
	height: number
): RawImage {
	// Clamp to image bounds
	const x1 = Math.max(0, Math.min(x, image.width));
	const y1 = Math.max(0, Math.min(y, image.height));
	const x2 = Math.max(0, Math.min(x + width, image.width));
	const y2 = Math.max(0, Math.min(y + height, image.height));
	const w = x2 - x1;
	const h = y2 - y1;
	const ch = image.channels;

	const data = new Uint8Array(w * h * ch);
	for (let row = 0; row < h; row++) {
		const srcOffset = ((y1 + row) * image.width + x1) * ch;
		const dstOffset = row * w * ch;
		data.set(image.data.subarray(srcOffset, srcOffset + w * ch), dstOffset);
	}

	return { data, width: w, height: h, channels: ch };
}

/**
 * Resize a raw grayscale image using Sharp.
 *
 * IMPORTANT: Sharp silently promotes single-channel raw input to 3-channel sRGB on resize.
 * The .grayscale() call after .resize() is critical to force output back to 1 channel.
 * Without it, the returned buffer is 3× the expected size (interleaved RGB) while
 * channels is hardcoded to 1, causing downstream HOG to read garbage data.
 */
export async function resizeGrayscale(
	image: RawImage,
	targetWidth: number,
	targetHeight: number
): Promise<RawImage> {
	const { data, info } = await sharp(Buffer.from(image.data), {
		raw: { width: image.width, height: image.height, channels: 1 }
	})
		.resize(targetWidth, targetHeight, { kernel: 'lanczos3' })
		.grayscale()
		.raw()
		.toBuffer({ resolveWithObject: true });

	return {
		data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
		width: info.width,
		height: info.height,
		channels: 1
	};
}

/**
 * Load a template image from file as grayscale.
 */
export async function loadTemplateFromFile(filePath: string): Promise<RawImage> {
	const { data, info } = await sharp(filePath)
		.grayscale()
		.raw()
		.toBuffer({ resolveWithObject: true });
	return {
		data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
		width: info.width,
		height: info.height,
		channels: 1
	};
}

/**
 * Convert a raw grayscale image to a base64-encoded PNG string.
 */
export async function rawImageToBase64PNG(image: RawImage): Promise<string> {
	const buf = await sharp(Buffer.from(image.data), {
		raw: { width: image.width, height: image.height, channels: image.channels as 1 | 3 }
	})
		.png()
		.toBuffer();
	return buf.toString('base64');
}

/**
 * Load a reference icon (white-on-transparent) as white-on-black grayscale.
 * Alpha > 128 → white (255), else → black (0).
 */
export async function loadReferenceIcon(
	filePath: string,
	targetSize: number = 32
): Promise<RawImage> {
	const { data, info } = await sharp(filePath)
		.resize(targetSize, targetSize, { kernel: 'lanczos3' })
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });

	const rgba = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
	const gray = new Uint8Array(targetSize * targetSize);

	for (let i = 0; i < targetSize * targetSize; i++) {
		const alpha = rgba[i * 4 + 3];
		// Binary: opaque pixels → 255, transparent → 0
		// Matches Python: gray[alpha > 128] = 255
		gray[i] = alpha > 128 ? 255 : 0;
	}

	return { data: gray, width: targetSize, height: targetSize, channels: 1 };
}
