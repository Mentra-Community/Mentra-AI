import { Request, Response } from 'express';
import { ChatManager } from '../manager/chat.manager';
import { logger as _logger } from '@mentra/sdk';

const logger = _logger.child({ service: 'ChatAPI' });

/**
 * Chat API controller - handles the core logic for chat endpoints
 */
export class ChatAPI {
  private chatManager: ChatManager;

  constructor(chatManager: ChatManager) {
    this.chatManager = chatManager;
  }

  /**
   * POST /api/chat/message
   * Send a chat message
   */
  async sendMessage(req: Request, res: Response): Promise<void> {
    try {
      const { userId, message } = req.body;

      if (!userId || !message) {
        res.status(400).json({ error: 'userId and message are required' });
        return;
      }

      // Process message asynchronously
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
   * Get chat history for a user
   */
  getHistory(req: Request, res: Response): void {
    try {
      const userId = req.query.userId as string;

      if (!userId) {
        res.status(400).json({ error: 'userId is required' });
        return;
      }

      const messages = this.chatManager.getChatHistory(userId);
      console.log("GETTING history");
      res.json({ messages });
    } catch (error) {
      logger.error(error as Error, 'Error in getHistory:');
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * DELETE /api/chat/clear
   * Clear chat history for a user
   */
  clearHistory(req: Request, res: Response): void {
    try {
      const userId = req.query.userId as string;

      if (!userId) {
        res.status(400).json({ error: 'userId is required' });
        return;
      }

      logger.info(`🗑️ Clearing chat data for user ${userId}`);
      this.chatManager.cleanupUserOnDisconnect(userId);

      res.json({ success: true, message: 'Chat history cleared' });
    } catch (error) {
      logger.error(error as Error, 'Error in clearHistory:');
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * GET /api/chat/stream
   * Server-Sent Events endpoint for real-time chat updates
   */
  streamChat(req: Request, res: Response): void {
    const userId = req.query.userId as string;

    if (!userId) {
      res.status(400).json({ error: 'userId is required' });
      return;
    }

    console.log(`[SSE] 📡 Setting up event stream for user ${userId}`);

    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    // Register this SSE connection with ChatManager
    this.chatManager.registerSSE(userId, res);

    // Send initial history
    const history = this.chatManager.getChatHistory(userId);
    res.write(`data: ${JSON.stringify({ type: 'history', messages: history })}\n\n`);

    // Keepalive ping every 30 seconds
    const keepAlive = setInterval(() => {
      res.write(`: keepalive\n\n`);
    }, 30000);

    // Cleanup on disconnect
    req.on('close', () => {
      clearInterval(keepAlive);
      this.chatManager.unregisterSSE(userId, res);
      console.log(`[SSE] 🔌 Connection closed for user ${userId}`);
    });
  }
}
