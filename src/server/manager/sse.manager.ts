import { Response } from 'express';
import { logger as _logger } from '@mentra/sdk';

const logger = _logger.child({ service: 'SSEManager' });

/**
 * Manages Server-Sent Events (SSE) connections for real-time streaming
 */
export class SSEManager {
  private connections: Map<string, Set<Response>> = new Map();

  /**
   * Register an SSE connection for a user
   */
  register(userId: string, res: Response): void {
    if (!this.connections.has(userId)) {
      this.connections.set(userId, new Set());
    }
    this.connections.get(userId)!.add(res);
  }

  /**
   * Unregister an SSE connection for a user
   */
  unregister(userId: string, res: Response): void {
    const userConnections = this.connections.get(userId);
    if (userConnections) {
      userConnections.delete(res);
      if (userConnections.size === 0) {
        this.connections.delete(userId);
      }
    }
  }

  /**
   * Get all connections for a user
   */
  getConnections(userId: string): Set<Response> | undefined {
    return this.connections.get(userId);
  }

  /**
   * Check if a user has any active connections
   */
  hasConnections(userId: string): boolean {
    const connections = this.connections.get(userId);
    return !!connections && connections.size > 0;
  }

  /**
   * Broadcast data to all connections for a user
   */
  broadcast(userId: string, data: object): void {
    const connections = this.connections.get(userId);
    if (connections && connections.size > 0) {
      const sseData = `data: ${JSON.stringify(data)}\n\n`;

      connections.forEach((res: Response) => {
        try {
          res.write(sseData);
        } catch (error) {
          logger.error(error, `[SSE] Error broadcasting to ${userId}:`);
        }
      });
    }
  }

  /**
   * Clean up all connections for a user
   */
  cleanup(userId: string): void {
    this.connections.delete(userId);
  }

  /**
   * Get the underlying connections map (for backward compatibility)
   */
  getConnectionsMap(): Map<string, Set<Response>> {
    return this.connections;
  }
}

/**
 * Creates a broadcast function for transcription SSE
 */
export function createTranscriptionBroadcaster(
  sseManager: SSEManager,
  userId: string
): (text: string, isFinal: boolean) => void {
  return (text: string, isFinal: boolean) => {
    sseManager.broadcast(userId, {
      type: 'transcription',
      text,
      isFinal,
      timestamp: new Date().toISOString()
    });
  };
}
