import { warmupClassifier, warmupOCR, warmupMinimap } from '$lib/server/scan/index.js';

// Pre-warm CV pipeline on server start to avoid cold start on first scan
Promise.all([warmupClassifier(), warmupOCR(), warmupMinimap()]).catch(console.error);
