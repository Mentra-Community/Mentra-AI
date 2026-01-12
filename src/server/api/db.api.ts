import { Request, Response } from 'express';
import { UserSettings, IUserSettings } from '../schemas';
import { logger as _logger } from '@mentra/sdk';

const logger = _logger.child({ service: 'DatabaseAPI' });

// Default settings for new users
const DEFAULT_USER_SETTINGS = {
  textModel: 'GPT-4.1-mini',
  visionModel: 'Gemini Flash Latest',
  personality: 'default' as const,
  theme: 'light' as const,
};

/**
 * Database API controller - handles user settings CRUD operations
 */
export class DatabaseAPI {
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
      const { userId, textModel, visionModel, personality, theme } = req.body;

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
        });
        logger.info({ userId }, 'Created new user settings with defaults');
      } else {
        // Update existing user (only provided fields)
        const updateData: Partial<IUserSettings> = {};
        if (textModel !== undefined) updateData.textModel = textModel;
        if (visionModel !== undefined) updateData.visionModel = visionModel;
        if (personality !== undefined) updateData.personality = personality;
        if (theme !== undefined) updateData.theme = theme;

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
}
