import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
	const key = process.env.BYOK_ENCRYPTION_KEY;
	if (!key) throw new Error('BYOK_ENCRYPTION_KEY environment variable is required');
	// Accept hex-encoded 32-byte key (64 hex chars) or raw 32-byte string
	if (key.length === 64 && /^[0-9a-f]+$/i.test(key)) {
		return Buffer.from(key, 'hex');
	}
	const buf = Buffer.from(key, 'utf-8');
	if (buf.length !== 32) {
		throw new Error('BYOK_ENCRYPTION_KEY must be exactly 32 bytes (or 64 hex chars)');
	}
	return buf;
}

/** Encrypt a string with AES-256-GCM. Returns base64-encoded iv:ciphertext:tag */
export function encrypt(plaintext: string): string {
	const key = getEncryptionKey();
	const iv = randomBytes(IV_LENGTH);
	const cipher = createCipheriv(ALGORITHM, key, iv);
	const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	// Store as base64: iv + encrypted + tag concatenated
	return Buffer.concat([iv, encrypted, tag]).toString('base64');
}

/** Decrypt an AES-256-GCM encrypted string */
export function decrypt(encoded: string): string {
	const key = getEncryptionKey();
	const data = Buffer.from(encoded, 'base64');
	const iv = data.subarray(0, IV_LENGTH);
	const tag = data.subarray(data.length - TAG_LENGTH);
	const ciphertext = data.subarray(IV_LENGTH, data.length - TAG_LENGTH);
	const decipher = createDecipheriv(ALGORITHM, key, iv);
	decipher.setAuthTag(tag);
	return decipher.update(ciphertext) + decipher.final('utf-8');
}
