import { Router } from 'express';
import express from 'express';
import { ChatAPI } from '../api/chat.api';

/**
 * Creates chat routes
 * @param chatAPI - The ChatAPI controller instance
 * @returns Express Router with chat routes
 */
export function createChatRoutes(chatAPI: ChatAPI): Router {
  const router = Router();
  const jsonParser = express.json();

  // POST /api/chat/message - Send a chat message
  router.post('/message', jsonParser, (req, res) => chatAPI.sendMessage(req, res));

  // GET /api/chat/history - Get chat history
  router.get('/history', (req, res) => chatAPI.getHistory(req, res));

  // DELETE /api/chat/clear - Clear chat history
  router.delete('/clear', (req, res) => chatAPI.clearHistory(req, res));

  // GET /api/chat/stream - SSE for real-time updates
  router.get('/stream', (req, res) => chatAPI.streamChat(req, res));

  return router;
}
