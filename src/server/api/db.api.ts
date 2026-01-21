import { Request, Response } from 'express';
import { UserSettings, IUserSettings, Conversation, IConversation } from '../schemas';
import { logger as _logger } from '@mentra/sdk';

const logger = _logger.child({ service: 'DatabaseAPI' });

// Default settings for new users
const DEFAULT_USER_SETTINGS = {
  textModel: 'GPT-4.1-mini',
  visionModel: 'Gemini Flash Latest',
  personality: 'default' as const,
  theme: 'light' as const,
  followUpEnabled: false,
  chatHistoryEnabled: false, // Beta feature - disabled by default
};

/**
 * Database API controller - handles user settings CRUD operations
 */
export class DatabaseAPI {
  // Callback to notify when follow-up setting changes
  private onFollowUpSettingChanged?: (userId: string) => void;

  /**
   * Set callback for when follow-up setting changes
   */
  setFollowUpSettingChangedCallback(callback: (userId: string) => void): void {
    this.onFollowUpSettingChanged = callback;
  }

  /**
   * Initialize user settings with defaults if they don't exist
   * This is an internal method not exposed as a route
   * Uses atomic upsert to prevent race conditions and duplicate documents
   * @returns The user's settings (existing or newly created)
   */
  async initializeUserSettings(userId: string): Promise<IUserSettings> {
    // Use findOneAndUpdate with upsert and setOnInsert to atomically create if not exists
    // This prevents race conditions where multiple sessions try to create at the same time
    const settings = await UserSettings.findOneAndUpdate(
      { userId },
      {
        $setOnInsert: {
          userId,
          ...DEFAULT_USER_SETTINGS,
        }
      },
      {
        upsert: true,  // Create if doesn't exist
        new: true,     // Return the document after update
        runValidators: true
      }
    );

    // Log whether it was created or already existed (we can't tell from the operation itself)
    logger.info({ userId }, '✅ User settings initialized');

    return settings as IUserSettings;
  }

  /**
   * GET /api/db/settings
   * Get user settings by userId
   */
  async getUserSettings(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.query.userId as string;

      if (!userId) {
        res.status(400).json({ error: 'userId is required' });
        return;
      }

      // Use the initialize function to get or create settings
      const settings = await this.initializeUserSettings(userId);
      res.json(settings);
    } catch (error) {
      logger.error(error as Error, 'Error in getUserSettings:');
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * POST /api/db/settings
   * Create or update user settings
   */
  async upsertUserSettings(req: Request, res: Response): Promise<void> {
    try {
      const { userId, textModel, visionModel, personality, theme, followUpEnabled } = req.body;

      if (!userId) {
        res.status(400).json({ error: 'userId is required' });
        return;
      }

      // Validate personality enum
      const validPersonalities = ['default', 'professional', 'friendly', 'candid', 'quirky', 'efficient'];
      if (personality && !validPersonalities.includes(personality)) {
        res.status(400).json({ error: 'Invalid personality value' });
        return;
      }

      // Validate theme enum
      const validThemes = ['light', 'dark'];
      if (theme && !validThemes.includes(theme)) {
        res.status(400).json({ error: 'Invalid theme value' });
        return;
      }

      // Check if user exists
      let settings = await UserSettings.findOne({ userId });

      if (!settings) {
        // Create new user with defaults merged with provided values
        settings = await UserSettings.create({
          userId,
          ...DEFAULT_USER_SETTINGS,
          ...(textModel !== undefined && { textModel }),
          ...(visionModel !== undefined && { visionModel }),
          ...(personality !== undefined && { personality }),
          ...(theme !== undefined && { theme }),
          ...(followUpEnabled !== undefined && { followUpEnabled }),
        });
        logger.info({ userId }, 'Created new user settings with defaults');
      } else {
        // Update existing user (only provided fields)
        const updateData: Partial<IUserSettings> = {};
        if (textModel !== undefined) updateData.textModel = textModel;
        if (visionModel !== undefined) updateData.visionModel = visionModel;
        if (personality !== undefined) updateData.personality = personality;
        if (theme !== undefined) updateData.theme = theme;
        if (followUpEnabled !== undefined) updateData.followUpEnabled = followUpEnabled;

        settings = (await UserSettings.findOneAndUpdate(
          { userId },
          { $set: updateData },
          { new: true, runValidators: true }
        ))!;
        logger.info({ userId, updates: updateData }, 'Updated existing user settings');
      }

      res.json(settings);
    } catch (error) {
      logger.error(error as Error, 'Error in upsertUserSettings:');
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * PATCH /api/db/settings/personality
   * Update only the personality setting
   */
  async updatePersonality(req: Request, res: Response): Promise<void> {
    try {
      const { userId, personality } = req.body;

      if (!userId || !personality) {
        res.status(400).json({ error: 'userId and personality are required' });
        return;
      }

      const validPersonalities = ['default', 'professional', 'friendly', 'candid', 'quirky', 'efficient'];
      if (!validPersonalities.includes(personality)) {
        res.status(400).json({ error: 'Invalid personality value' });
        return;
      }

      let settings = await UserSettings.findOne({ userId });

      if (!settings) {
        // Create with defaults and the specified personality
        settings = await UserSettings.create({
          userId,
          ...DEFAULT_USER_SETTINGS,
          personality,
        });
        logger.info({ userId, personality }, 'Created new user settings with personality');
      } else {
        // Update existing
        settings = (await UserSettings.findOneAndUpdate(
          { userId },
          { $set: { personality } },
          { new: true, runValidators: true }
        ))!;
        logger.info({ userId, personality }, 'Updated personality');
      }

      res.json(settings);
    } catch (error) {
      logger.error(error as Error, 'Error in updatePersonality:');
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * PATCH /api/db/settings/theme
   * Update only the theme setting
   */
  async updateTheme(req: Request, res: Response): Promise<void> {
    try {
      const { userId, theme } = req.body;

      if (!userId || !theme) {
        res.status(400).json({ error: 'userId and theme are required' });
        return;
      }

      const validThemes = ['light', 'dark'];
      if (!validThemes.includes(theme)) {
        res.status(400).json({ error: 'Invalid theme value' });
        return;
      }

      let settings = await UserSettings.findOne({ userId });

      if (!settings) {
        // Create with defaults and the specified theme
        settings = await UserSettings.create({
          userId,
          ...DEFAULT_USER_SETTINGS,
          theme,
        });
        logger.info({ userId, theme }, 'Created new user settings with theme');
      } else {
        // Update existing
        settings = (await UserSettings.findOneAndUpdate(
          { userId },
          { $set: { theme } },
          { new: true, runValidators: true }
        ))!;
        logger.info({ userId, theme }, 'Updated theme');
      }

      res.json(settings);
    } catch (error) {
      logger.error(error as Error, 'Error in updateTheme:');
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * PATCH /api/db/settings/follow-up
   * Update only the followUpEnabled setting
   */
  async updateFollowUpEnabled(req: Request, res: Response): Promise<void> {
    try {
      const { userId, followUpEnabled } = req.body;

      if (!userId || followUpEnabled === undefined) {
        res.status(400).json({ error: 'userId and followUpEnabled are required' });
        return;
      }

      if (typeof followUpEnabled !== 'boolean') {
        res.status(400).json({ error: 'followUpEnabled must be a boolean' });
        return;
      }

      let settings = await UserSettings.findOne({ userId });

      if (!settings) {
        // Create with defaults and the specified followUpEnabled value
        settings = await UserSettings.create({
          userId,
          ...DEFAULT_USER_SETTINGS,
          followUpEnabled,
        });
        logger.info({ userId, followUpEnabled }, 'Created new user settings with followUpEnabled');
      } else {
        // Update existing
        settings = (await UserSettings.findOneAndUpdate(
          { userId },
          { $set: { followUpEnabled } },
          { new: true, runValidators: true }
        ))!;
        logger.info({ userId, followUpEnabled }, 'Updated followUpEnabled');
      }

      // Notify the server to reload the cached setting for active sessions
      if (this.onFollowUpSettingChanged) {
        this.onFollowUpSettingChanged(userId);
      }

      res.json(settings);
    } catch (error) {
      logger.error(error as Error, 'Error in updateFollowUpEnabled:');
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * PATCH /api/db/settings/chat-history
   * Update only the chatHistoryEnabled setting
   */
  async updateChatHistoryEnabled(req: Request, res: Response): Promise<void> {
    try {
      const { userId, chatHistoryEnabled } = req.body;

      if (!userId || chatHistoryEnabled === undefined) {
        res.status(400).json({ error: 'userId and chatHistoryEnabled are required' });
        return;
      }

      if (typeof chatHistoryEnabled !== 'boolean') {
        res.status(400).json({ error: 'chatHistoryEnabled must be a boolean' });
        return;
      }

      let settings = await UserSettings.findOne({ userId });

      if (!settings) {
        // Create with defaults and the specified chatHistoryEnabled value
        settings = await UserSettings.create({
          userId,
          ...DEFAULT_USER_SETTINGS,
          chatHistoryEnabled,
        });
        logger.info({ userId, chatHistoryEnabled }, 'Created new user settings with chatHistoryEnabled');
      } else {
        // Update existing
        settings = (await UserSettings.findOneAndUpdate(
          { userId },
          { $set: { chatHistoryEnabled } },
          { new: true, runValidators: true }
        ))!;
        logger.info({ userId, chatHistoryEnabled }, 'Updated chatHistoryEnabled');
      }

      res.json(settings);
    } catch (error) {
      logger.error(error as Error, 'Error in updateChatHistoryEnabled:');
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * DELETE /api/db/settings
   * Delete user settings
   */
  async deleteUserSettings(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.query.userId as string;

      if (!userId) {
        res.status(400).json({ error: 'userId is required' });
        return;
      }

      await UserSettings.findOneAndDelete({ userId });

      logger.info({ userId }, 'User settings deleted');
      res.json({ success: true, message: 'User settings deleted' });
    } catch (error) {
      logger.error(error as Error, 'Error in deleteUserSettings:');
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  // ==================== CONVERSATION METHODS ====================

  /**
   * Get today's date in YYYY-MM-DD format
   */
  private getTodayDate(): string {
    const now = new Date();
    return now.toISOString().split('T')[0];
  }

  /**
   * Format date string to readable title (e.g., "January 18, 2026")
   */
  private formatDateTitle(dateStr: string): string {
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  }

  /**
   * Initialize today's conversation for a user session.
   * Creates a new conversation if one doesn't exist for today.
   * Does nothing if a conversation already exists for today.
   * @returns The conversation for today (existing or newly created)
   */
  async initializeTodayConversation(userId: string): Promise<IConversation> {
    const today = this.getTodayDate();
    const title = this.formatDateTitle(today);

    // Use findOneAndUpdate with upsert to atomically create if not exists
    const conversation = await Conversation.findOneAndUpdate(
      { userId, date: today },
      {
        $setOnInsert: {
          userId,
          date: today,
          title,
          messages: [],
          hasUnread: false,
        },
      },
      {
        upsert: true,
        new: true,
        runValidators: true,
      }
    );

    logger.info({ userId, date: today }, '✅ Today\'s conversation initialized');
    return conversation as IConversation;
  }

  /**
   * Generate a unique message ID
   */
  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Add a message to today's conversation
   */
  async addMessageToConversation(
    userId: string,
    role: 'user' | 'assistant',
    content: string,
    photoTimestamp?: number
  ): Promise<IConversation | null> {
    const today = this.getTodayDate();
    const messageId = this.generateMessageId();

    // Get current message count to calculate the next message number
    const existingConversation = await Conversation.findOne({ userId, date: today });
    const messageNumber = existingConversation ? existingConversation.messages.length + 1 : 1;

    const conversation = await Conversation.findOneAndUpdate(
      { userId, date: today },
      {
        $push: {
          messages: {
            id: messageId,
            messageNumber,
            role,
            content,
            photoTimestamp,
            timestamp: new Date(),
          },
        },
        $set: {
          hasUnread: role === 'assistant',
        },
      },
      { new: true }
    );

    if (conversation) {
      logger.info({ userId, date: today, role, messageId, messageNumber }, 'Added message to conversation');
    }

    return conversation;
  }

  /**
   * GET /api/db/conversations
   * Get all conversations for a user, sorted by date (newest first)
   */
  async getUserConversations(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.query.userId as string;

      if (!userId) {
        res.status(400).json({ error: 'userId is required' });
        return;
      }

      const conversations = await Conversation.find({ userId })
        .sort({ date: -1 })
        .lean();

      res.json(conversations);
    } catch (error) {
      logger.error(error as Error, 'Error in getUserConversations:');
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * GET /api/db/conversations/:date
   * Get a specific conversation by date
   */
  async getConversationByDate(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.query.userId as string;
      const { date } = req.params;

      if (!userId) {
        res.status(400).json({ error: 'userId is required' });
        return;
      }

      const conversation = await Conversation.findOne({ userId, date }).lean();

      if (!conversation) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }

      res.json(conversation);
    } catch (error) {
      logger.error(error as Error, 'Error in getConversationByDate:');
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * PATCH /api/db/conversations/:date/read
   * Mark a conversation as read
   */
  async markConversationRead(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req.body;
      const { date } = req.params;

      if (!userId) {
        res.status(400).json({ error: 'userId is required' });
        return;
      }

      const conversation = await Conversation.findOneAndUpdate(
        { userId, date },
        { $set: { hasUnread: false } },
        { new: true }
      );

      if (!conversation) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }

      res.json(conversation);
    } catch (error) {
      logger.error(error as Error, 'Error in markConversationRead:');
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}
