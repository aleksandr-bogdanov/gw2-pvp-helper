declare module 'tesseract-wasm' {
	export class OCREngine {
		static create(): Promise<OCREngine>;
		loadImage(imageData: ImageData): void;
		getText(): string;
	}

	export class OCRClient {
		loadModel(url: string): Promise<void>;
		loadImage(imageData: ImageData): void;
		getText(): string;
	}
}
