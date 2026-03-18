import { warmupClassifier, warmupOCR, warmupMinimap, terminateOCR } from '$lib/server/scan/index.js';

// Pre-warm CV pipeline on server start to avoid cold start on first scan
Promise.all([warmupClassifier(), warmupOCR(), warmupMinimap()]).catch(console.error);

// Graceful shutdown — clean up OCR worker pool on SIGTERM
process.on('SIGTERM', async () => {
	console.log('[shutdown] SIGTERM received, cleaning up...');
	await terminateOCR().catch(console.error);
	console.log('[shutdown] Cleanup complete, exiting.');
	process.exit(0);
});
