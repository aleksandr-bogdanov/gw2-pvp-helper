/**
 * Browser-side image preprocessing using Canvas API.
 * Replaces Sharp operations from the server pipeline.
 */
import type { RawImage } from './types.js';

/**
 * Load an image from a Blob into an ImageBitmap.
 */
export async function loadImageFromBlob(blob: Blob): Promise<ImageBitmap> {
	return createImageBitmap(blob);
}

/**
 * Get grayscale raw pixels from an ImageBitmap.
 * Uses OffscreenCanvas with willReadFrequently hint.
 */
export function imageToGrayscale(bitmap: ImageBitmap): RawImage {
	const w = bitmap.width;
	const h = bitmap.height;
	const canvas = new OffscreenCanvas(w, h);
	const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
	ctx.drawImage(bitmap, 0, 0);
	const imageData = ctx.getImageData(0, 0, w, h);
	const rgba = imageData.data;

	const gray = new Uint8Array(w * h);
	for (let i = 0; i < w * h; i++) {
		// ITU-R BT.601 luma formula (matches Sharp .grayscale())
		gray[i] = Math.round(
			0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]
		);
	}

	return { data: gray, width: w, height: h, channels: 1 };
}

/**
 * Get RGB raw pixels from an ImageBitmap.
 */
export function imageToRGB(bitmap: ImageBitmap): RawImage {
	const w = bitmap.width;
	const h = bitmap.height;
	const canvas = new OffscreenCanvas(w, h);
	const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
	ctx.drawImage(bitmap, 0, 0);
	const imageData = ctx.getImageData(0, 0, w, h);
	const rgba = imageData.data;

	const rgb = new Uint8Array(w * h * 3);
	for (let i = 0; i < w * h; i++) {
		rgb[i * 3] = rgba[i * 4];
		rgb[i * 3 + 1] = rgba[i * 4 + 1];
		rgb[i * 3 + 2] = rgba[i * 4 + 2];
	}

	return { data: rgb, width: w, height: h, channels: 3 };
}

/**
 * Extract a rectangular region from a raw image.
 * Pure array math — same as server version.
 */
export function extractROI(
	image: RawImage,
	x: number,
	y: number,
	width: number,
	height: number
): RawImage {
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
 * Resize a grayscale RawImage using Canvas (bilinear interpolation).
 * Uses OffscreenCanvas drawImage for resize, then extracts grayscale.
 */
export function resizeGrayscale(
	image: RawImage,
	targetWidth: number,
	targetHeight: number
): RawImage {
	// First render the grayscale data onto a canvas
	const srcCanvas = new OffscreenCanvas(image.width, image.height);
	const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true })!;
	const srcData = srcCtx.createImageData(image.width, image.height);
	for (let i = 0; i < image.width * image.height; i++) {
		const v = image.data[i];
		srcData.data[i * 4] = v;
		srcData.data[i * 4 + 1] = v;
		srcData.data[i * 4 + 2] = v;
		srcData.data[i * 4 + 3] = 255;
	}
	srcCtx.putImageData(srcData, 0, 0);

	// Draw resized onto target canvas
	const dstCanvas = new OffscreenCanvas(targetWidth, targetHeight);
	const dstCtx = dstCanvas.getContext('2d', { willReadFrequently: true })!;
	dstCtx.drawImage(srcCanvas, 0, 0, targetWidth, targetHeight);
	const dstData = dstCtx.getImageData(0, 0, targetWidth, targetHeight);

	// Extract grayscale
	const gray = new Uint8Array(targetWidth * targetHeight);
	for (let i = 0; i < targetWidth * targetHeight; i++) {
		gray[i] = Math.round(
			0.299 * dstData.data[i * 4] +
			0.587 * dstData.data[i * 4 + 1] +
			0.114 * dstData.data[i * 4 + 2]
		);
	}

	return { data: gray, width: targetWidth, height: targetHeight, channels: 1 };
}

/**
 * Get raw pixel data from a region of a canvas.
 */
export function getRawPixels(
	canvas: OffscreenCanvas,
	x: number,
	y: number,
	w: number,
	h: number
): Uint8Array {
	const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
	const imageData = ctx.getImageData(x, y, w, h);
	return new Uint8Array(imageData.data.buffer);
}

/**
 * Load a reference icon (white-on-transparent RGBA PNG) as white-on-black grayscale.
 * Fetches from static/scan-data/icons/ and converts via Canvas.
 */
export async function loadReferenceIcon(
	url: string,
	targetSize: number = 32
): Promise<RawImage> {
	const response = await fetch(url);
	const blob = await response.blob();
	const bitmap = await createImageBitmap(blob);

	// Draw onto canvas to get RGBA
	const canvas = new OffscreenCanvas(targetSize, targetSize);
	const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
	ctx.drawImage(bitmap, 0, 0, targetSize, targetSize);
	const imageData = ctx.getImageData(0, 0, targetSize, targetSize);
	const rgba = imageData.data;

	// Convert: alpha > 128 → 255 (white), else → 0 (black)
	const gray = new Uint8Array(targetSize * targetSize);
	for (let i = 0; i < targetSize * targetSize; i++) {
		const alpha = rgba[i * 4 + 3];
		gray[i] = alpha > 128 ? 255 : 0;
	}

	bitmap.close();
	return { data: gray, width: targetSize, height: targetSize, channels: 1 };
}

/**
 * Load a template image from URL as grayscale.
 */
export async function loadTemplateFromUrl(url: string): Promise<RawImage> {
	const response = await fetch(url);
	const blob = await response.blob();
	const bitmap = await createImageBitmap(blob);

	const w = bitmap.width;
	const h = bitmap.height;
	const canvas = new OffscreenCanvas(w, h);
	const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
	ctx.drawImage(bitmap, 0, 0);
	const imageData = ctx.getImageData(0, 0, w, h);
	const rgba = imageData.data;

	const gray = new Uint8Array(w * h);
	for (let i = 0; i < w * h; i++) {
		gray[i] = Math.round(
			0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]
		);
	}

	bitmap.close();
	return { data: gray, width: w, height: h, channels: 1 };
}

/**
 * Convert a grayscale RawImage to a base64 PNG string.
 * Uses Canvas to encode.
 */
export function rawImageToBase64PNG(image: RawImage): string {
	const canvas = new OffscreenCanvas(image.width, image.height);
	const ctx = canvas.getContext('2d')!;
	const imageData = ctx.createImageData(image.width, image.height);

	for (let i = 0; i < image.width * image.height; i++) {
		const v = image.channels === 1 ? image.data[i] : image.data[i * 3];
		imageData.data[i * 4] = v;
		imageData.data[i * 4 + 1] = image.channels === 3 ? image.data[i * 3 + 1] : v;
		imageData.data[i * 4 + 2] = image.channels === 3 ? image.data[i * 3 + 2] : v;
		imageData.data[i * 4 + 3] = 255;
	}
	ctx.putImageData(imageData, 0, 0);

	// OffscreenCanvas.convertToBlob is async but we need sync for compatibility
	// Use a temp regular canvas approach — actually OffscreenCanvas doesn't have toDataURL
	// We'll return a blob URL instead, but for compatibility let's just convert
	// Actually the server version returns base64 for icon_crop_base64. Let's do it async.
	// This function needs to be async in browser.
	throw new Error('Use rawImageToBase64PNGAsync instead');
}

/**
 * Convert a grayscale RawImage to a base64 PNG string (async browser version).
 */
export async function rawImageToBase64PNGAsync(image: RawImage): Promise<string> {
	const canvas = new OffscreenCanvas(image.width, image.height);
	const ctx = canvas.getContext('2d')!;
	const imgData = ctx.createImageData(image.width, image.height);

	for (let i = 0; i < image.width * image.height; i++) {
		if (image.channels === 1) {
			const v = image.data[i];
			imgData.data[i * 4] = v;
			imgData.data[i * 4 + 1] = v;
			imgData.data[i * 4 + 2] = v;
		} else {
			imgData.data[i * 4] = image.data[i * 3];
			imgData.data[i * 4 + 1] = image.data[i * 3 + 1];
			imgData.data[i * 4 + 2] = image.data[i * 3 + 2];
		}
		imgData.data[i * 4 + 3] = 255;
	}
	ctx.putImageData(imgData, 0, 0);

	const blob = await canvas.convertToBlob({ type: 'image/png' });
	const buffer = await blob.arrayBuffer();
	const bytes = new Uint8Array(buffer);
	let binary = '';
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}
