import { Router } from 'express';
import { TranscriptionAPI } from '../api/transcription.api';

/**
 * Creates transcription routes
 * @param transcriptionAPI - The TranscriptionAPI controller instance
 * @returns Express Router with transcription routes
 */
export function createTranscriptionRoutes(transcriptionAPI: TranscriptionAPI): Router {
  const router = Router();

  // GET /api/transcription/stream - SSE for live transcription
  router.get('/stream', (req, res) => transcriptionAPI.streamTranscription(req, res));

  return router;
}
