import { Request, Response } from 'express';

/**
 * Transcription API controller - handles the core logic for transcription endpoints
 */
export class TranscriptionAPI {
  private transcriptionSSEConnections: Map<string, Set<Response>>;

  constructor(transcriptionSSEConnections: Map<string, Set<Response>>) {
    this.transcriptionSSEConnections = transcriptionSSEConnections;
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

    console.log(`[TRANSCRIPTION SSE] 📡 Setting up transcription stream for user ${userId}`);

    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    // Register this SSE connection
    if (!this.transcriptionSSEConnections.has(userId)) {
      this.transcriptionSSEConnections.set(userId, new Set());
    }
    this.transcriptionSSEConnections.get(userId)!.add(res);

    // Send initial connection message
    res.write(`data: ${JSON.stringify({ type: 'connected', message: 'Transcription stream connected' })}\n\n`);

    // Keepalive ping every 30 seconds
    const keepAlive = setInterval(() => {
      res.write(`: keepalive\n\n`);
    }, 30000);

    // Cleanup on disconnect
    req.on('close', () => {
      clearInterval(keepAlive);
      const connections = this.transcriptionSSEConnections.get(userId);
      if (connections) {
        connections.delete(res);
        if (connections.size === 0) {
          this.transcriptionSSEConnections.delete(userId);
        }
      }
      console.log(`[TRANSCRIPTION SSE] 🔌 Connection closed for user ${userId}`);
    });
  }
}
