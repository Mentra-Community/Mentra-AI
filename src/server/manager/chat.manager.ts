import { WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { MiraAgent } from '../agents';
import type { Response } from 'express';

interface ChatMessage {
  id: string;
  senderId: string;
  recipientId: string;
  content: string;
  timestamp: Date;
  image?: string; // Base64 encoded image data
}

interface ConversationData {
  messages: ChatMessage[];
}

interface UserConnectionData {
  ws: Set<WebSocket>;
  sse: Set<Response>; // Server-Sent Events connections
}

/**
 * Manages user-to-user chat sessions with in-memory storage
 * Messages are stored per conversation (between two users)
 * Each user only sees their own conversations with Mira
 */
export class ChatManager {
  // Store conversations by conversationId (format: "userId1:userId2" where userId1 < userId2)
  private conversations = new Map<string, ConversationData>();

  // Store user connections separately (for broadcasting)
  private userConnections = new Map<string, UserConnectionData>();

  private agents = new Map<string, MiraAgent>();
  private serverUrl: string;

  constructor(serverUrl: string) {
    this.serverUrl = serverUrl;
  }

  /**
   * Generate a consistent conversation ID for two users
   */
  private getConversationId(userId1: string, userId2: string): string {
    return userId1 < userId2 ? `${userId1}:${userId2}` : `${userId2}:${userId1}`;
  }

  /**
   * Get or create MiraAgent for a user
   */
  private getAgentForUser(userId: string): MiraAgent {
    if (!this.agents.has(userId)) {
      const agent = new MiraAgent(this.serverUrl, userId);
      this.agents.set(userId, agent);
    }
    return this.agents.get(userId)!;
  }

  /**
   * Register a WebSocket connection for a user
   */
  registerWebSocket(userId: string, ws: WebSocket): void {
    if (!this.userConnections.has(userId)) {
      this.userConnections.set(userId, {
        ws: new Set(),
        sse: new Set()
      });
    }

    const userData = this.userConnections.get(userId)!;
    userData.ws.add(ws);

    ws.on('close', () => {
      userData.ws.delete(ws);
    });
  }

  /**
   * Get chat history for a conversation between two users
   * Returns the last 40 messages (most recent)
   * @param userId1 - First user ID
   * @param userId2 - Second user ID (defaults to 'mira-assistant' for AI conversations)
   */
  getChatHistory(userId1: string, userId2: string = 'mira-assistant'): ChatMessage[] {
    const conversationId = this.getConversationId(userId1, userId2);
    const messages = this.conversations.get(conversationId)?.messages || [];

    // Return last 40 messages if there are more than 40
    if (messages.length > 40) {
      return messages.slice(-40);
    }

    return messages;
  }

  /**
   * Add a message to the conversation and broadcast to both users
   */
  private addMessage(senderId: string, recipientId: string, content: string, image?: string): void {
    const conversationId = this.getConversationId(senderId, recipientId);

    if (!this.conversations.has(conversationId)) {
      this.conversations.set(conversationId, {
        messages: []
      });
    }

    const message: ChatMessage = {
      id: uuidv4(),
      senderId,
      recipientId,
      content,
      timestamp: new Date(),
      image
    };

    const conversationData = this.conversations.get(conversationId)!;
    conversationData.messages.push(message);

    // Broadcast to both sender and recipient
    this.broadcastMessage(senderId, message);
    this.broadcastMessage(recipientId, message);
  }

  /**
   * Broadcast a message to all connections of a specific user
   */
  private broadcastMessage(userId: string, message: ChatMessage, isUpdate: boolean = false): void {
    const userData = this.userConnections.get(userId);
    if (!userData) {
      return;
    }

    // Broadcast to WebSocket connections
    const messageData = JSON.stringify({
      type: isUpdate ? 'message_update' : 'message',
      id: message.id,
      senderId: message.senderId,
      recipientId: message.recipientId,
      content: message.content,
      timestamp: message.timestamp,
      image: message.image
    });

    userData.ws.forEach((ws: WebSocket) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(messageData);
      }
    });

    // Broadcast to SSE connections
    const sseData = `data: ${messageData}\n\n`;
    userData.sse.forEach((res: Response) => {
      try {
        res.write(sseData);
      } catch (error) {
        console.error('[ChatManager] Error writing to SSE:', error);
      }
    });
  }

  /**
   * Process a user message and generate a response (for AI agent)
   */
  async processMessage(userId: string, messageContent: string): Promise<void> {
    // This is for AI responses - we'll treat the AI as a "recipient"
    const aiRecipientId = 'mira-assistant';

    // Add user message
    this.addMessage(userId, aiRecipientId, messageContent);

    try {
      // Get agent for this user
      const agent = this.getAgentForUser(userId);

      // Process the message with MiraAgent
      const response = await agent.handleContext({
        query: messageContent,
        photo: null // No photo support in web chat for now
      });

      // Add assistant response
      const responseContent = typeof response === 'string' ? response : 'I processed your request.';
      this.addMessage(aiRecipientId, userId, responseContent);
    } catch (error) {
      console.error('Error processing message:', error);

      // Add error message
      this.addMessage(aiRecipientId, userId, 'Sorry, I encountered an error processing your message. Please try again.');
    }
  }

  /**
   * Send a message from one user to another
   */
  sendUserMessage(senderId: string, recipientId: string, content: string, image?: string): void {
    this.addMessage(senderId, recipientId, content, image);
  }

  /**
   * Add a user message (from voice query) to the chat
   * Returns the message ID for potential updates
   */
  addUserMessage(userId: string, content: string, image?: string): string {
    const aiRecipientId = 'mira-assistant';
    const conversationId = this.getConversationId(userId, aiRecipientId);

    if (!this.conversations.has(conversationId)) {
      this.conversations.set(conversationId, {
        messages: []
      });
    }

    const message: ChatMessage = {
      id: uuidv4(),
      senderId: userId,
      recipientId: aiRecipientId,
      content,
      timestamp: new Date(),
      image
    };

    const conversationData = this.conversations.get(conversationId)!;
    conversationData.messages.push(message);

    // Broadcast to both sender and recipient
    this.broadcastMessage(userId, message);
    this.broadcastMessage(aiRecipientId, message);

    return message.id;
  }

  /**
   * Update an existing user message (e.g., to add a photo after initial send)
   */
  updateUserMessage(userId: string, messageId: string, content: string, image?: string): boolean {
    const aiRecipientId = 'mira-assistant';
    const conversationId = this.getConversationId(userId, aiRecipientId);

    const conversationData = this.conversations.get(conversationId);
    if (!conversationData) {
      console.warn(`[ChatManager] ⚠️ No conversation found for ${conversationId}`);
      return false;
    }

    const messageIndex = conversationData.messages.findIndex(m => m.id === messageId);
    if (messageIndex === -1) {
      console.warn(`[ChatManager] ⚠️ Message ${messageId} not found in conversation ${conversationId}`);
      return false;
    }

    // Update the message (keep original timestamp to avoid re-ordering)
    conversationData.messages[messageIndex] = {
      ...conversationData.messages[messageIndex],
      content,
      image
      // Note: NOT updating timestamp to preserve message order
    };

    const updatedMessage = conversationData.messages[messageIndex];

    // Broadcast the updated message with isUpdate flag
    this.broadcastMessage(userId, updatedMessage, true);
    this.broadcastMessage(aiRecipientId, updatedMessage, true);

    return true;
  }

  /**
   * Add an assistant message (Mira's response) to the chat
   */
  addAssistantMessage(userId: string, content: string): void {
    const aiSenderId = 'mira-assistant';
    this.addMessage(aiSenderId, userId, content);
  }

  /**
   * Set processing state to show/hide loading indicator
   */
  setProcessing(userId: string, isProcessing: boolean): void {
    const userData = this.userConnections.get(userId);
    if (!userData) {
      return;
    }

    const processingData = JSON.stringify({
      type: isProcessing ? 'processing' : 'idle'
    });

    userData.ws.forEach((ws: WebSocket) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(processingData);
      }
    });

    const sseData = `data: ${processingData}\n\n`;
    userData.sse.forEach((res: Response) => {
      try {
        res.write(sseData);
      } catch (error) {
        console.error('[ChatManager] Error writing processing state to SSE:', error);
      }
    });
  }

  /**
   * Register an SSE connection for a user
   */
  registerSSE(userId: string, res: Response): void {
    if (!this.userConnections.has(userId)) {
      this.userConnections.set(userId, {
        ws: new Set(),
        sse: new Set()
      });
    }

    const userData = this.userConnections.get(userId)!;
    userData.sse.add(res);
  }

  /**
   * Unregister an SSE connection for a user
   */
  unregisterSSE(userId: string, res: Response): void {
    const userData = this.userConnections.get(userId);
    if (userData) {
      userData.sse.delete(res);
    }
  }

  /**
   * Clear chat history for a conversation
   */
  clearChatHistory(userId1: string, userId2: string): void {
    const conversationId = this.getConversationId(userId1, userId2);
    const conversationData = this.conversations.get(conversationId);
    if (conversationData) {
      conversationData.messages = [];
    }
  }

  /**
   * Clean up user data when they disconnect (clear messages and remove connections)
   */
  cleanupUserOnDisconnect(userId: string): void {
    const aiRecipientId = 'mira-assistant';
    const conversationId = this.getConversationId(userId, aiRecipientId);

    if (this.conversations.has(conversationId)) {
      this.conversations.delete(conversationId);
    }

    if (this.userConnections.has(userId)) {
      const userData = this.userConnections.get(userId)!;

      userData.ws.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
      });

      userData.sse.forEach(res => {
        try {
          res.end();
        } catch (error) {
          console.error('[ChatManager] Error closing SSE:', error);
        }
      });

      this.userConnections.delete(userId);
    }

    if (this.agents.has(userId)) {
      this.agents.delete(userId);
    }
  }
}
