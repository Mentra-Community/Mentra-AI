import { Router } from 'express';
import { ChatAPI } from '../api/chat.api';

/**
 * Creates transcription routes
 * @param chatAPI - The ChatAPI controller instance (handles transcription streaming too)
 */
export function createTranscriptionRoutes(chatAPI: ChatAPI): Router {
  const router = Router();

  // GET /api/transcription/stream - SSE for live transcription
  router.get('/stream', (req, res) => chatAPI.streamTranscription(req, res));

  return router;
}
