import { Request, Response } from 'express';
import { ChatManager } from '../manager/chat.manager';
import { logger as _logger } from '@mentra/sdk';

const logger = _logger.child({ service: 'ChatAPI' });

/**
 * Chat & Transcription API controller
 * Handles chat endpoints, SSE streaming, and live transcription streaming
 */
export class ChatAPI {
  private chatManager: ChatManager;
  private transcriptionSSEConnections: Map<string, Set<Response>>;

  constructor(chatManager: ChatManager, transcriptionSSEConnections?: Map<string, Set<Response>>) {
    this.chatManager = chatManager;
    this.transcriptionSSEConnections = transcriptionSSEConnections || new Map();
  }

  /**
   * POST /api/chat/message
   */
  async sendMessage(req: Request, res: Response): Promise<void> {
    try {
      const { userId, message } = req.body;

      if (!userId || !message) {
        res.status(400).json({ error: 'userId and message are required' });
        return;
      }

      this.chatManager.processMessage(userId, message).catch((error: Error) => {
        logger.error(error, 'Error processing chat message:');
      });

      res.json({ success: true });
    } catch (error) {
      logger.error(error as Error, 'Error in sendMessage:');
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * GET /api/chat/history
   */
  getHistory(req: Request, res: Response): void {
    try {
      const userId = req.query.userId as string;

      if (!userId) {
        res.status(400).json({ error: 'userId is required' });
        return;
      }

      const messages = this.chatManager.getChatHistory(userId);
      res.json({ messages });
    } catch (error) {
      logger.error(error as Error, 'Error in getHistory:');
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * DELETE /api/chat/clear
   */
  clearHistory(req: Request, res: Response): void {
    try {
      const userId = req.query.userId as string;

      if (!userId) {
        res.status(400).json({ error: 'userId is required' });
        return;
      }

      logger.info(`Clearing chat data for user ${userId}`);
      this.chatManager.cleanupUserOnDisconnect(userId);

      res.json({ success: true, message: 'Chat history cleared' });
    } catch (error) {
      logger.error(error as Error, 'Error in clearHistory:');
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * GET /api/chat/stream
   * SSE endpoint for real-time chat updates
   */
  streamChat(req: Request, res: Response): void {
    const userId = req.query.userId as string;

    if (!userId) {
      res.status(400).json({ error: 'userId is required' });
      return;
    }

    console.log(`[SSE] Setting up event stream for user ${userId}`);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    this.chatManager.registerSSE(userId, res);

    const history = this.chatManager.getChatHistory(userId);
    res.write(`data: ${JSON.stringify({ type: 'history', messages: history })}\n\n`);

    const keepAlive = setInterval(() => {
      res.write(`: keepalive\n\n`);
    }, 30000);

    req.on('close', () => {
      clearInterval(keepAlive);
      this.chatManager.unregisterSSE(userId, res);
      console.log(`[SSE] Connection closed for user ${userId}`);
    });
  }

  /**
   * GET /api/transcription/stream
   * SSE endpoint for live transcription streaming
   */
  streamTranscription(req: Request, res: Response): void {
    const userId = req.query.userId as string;

    if (!userId) {
      res.status(400).json({ error: 'userId is required' });
      return;
    }

    console.log(`[TRANSCRIPTION SSE] Setting up transcription stream for user ${userId}`);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    if (!this.transcriptionSSEConnections.has(userId)) {
      this.transcriptionSSEConnections.set(userId, new Set());
    }
    this.transcriptionSSEConnections.get(userId)!.add(res);

    res.write(`data: ${JSON.stringify({ type: 'connected', message: 'Transcription stream connected' })}\n\n`);

    const keepAlive = setInterval(() => {
      res.write(`: keepalive\n\n`);
    }, 30000);

    req.on('close', () => {
      clearInterval(keepAlive);
      const connections = this.transcriptionSSEConnections.get(userId);
      if (connections) {
        connections.delete(res);
        if (connections.size === 0) {
          this.transcriptionSSEConnections.delete(userId);
        }
      }
      console.log(`[TRANSCRIPTION SSE] Connection closed for user ${userId}`);
    });
  }
}
