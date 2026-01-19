import { Router } from 'express';
import express from 'express';
import { DatabaseAPI } from '../api/db.api';

/**
 * Creates database routes for user settings
 * @param dbAPI - The DatabaseAPI controller instance
 * @returns Express Router with database routes
 */
export function createDbRoutes(dbAPI: DatabaseAPI): Router {
  const router = Router();
  const jsonParser = express.json();

  // GET /api/db/settings - Get user settings
  router.get('/settings', (req, res) => dbAPI.getUserSettings(req, res));

  // POST /api/db/settings - Create or update user settings
  router.post('/settings', jsonParser, (req, res) => dbAPI.upsertUserSettings(req, res));

  // PATCH /api/db/settings/personality - Update personality only
  router.patch('/settings/personality', jsonParser, (req, res) => dbAPI.updatePersonality(req, res));

  // PATCH /api/db/settings/theme - Update theme only
  router.patch('/settings/theme', jsonParser, (req, res) => dbAPI.updateTheme(req, res));

  // PATCH /api/db/settings/follow-up - Update followUpEnabled only
  router.patch('/settings/follow-up', jsonParser, (req, res) => dbAPI.updateFollowUpEnabled(req, res));

  // PATCH /api/db/settings/chat-history - Update chatHistoryEnabled only
  router.patch('/settings/chat-history', jsonParser, (req, res) => dbAPI.updateChatHistoryEnabled(req, res));

  // DELETE /api/db/settings - Delete user settings
  router.delete('/settings', (req, res) => dbAPI.deleteUserSettings(req, res));

  // ==================== CONVERSATION ROUTES ====================

  // GET /api/db/conversations - Get all conversations for a user
  router.get('/conversations', (req, res) => dbAPI.getUserConversations(req, res));

  // GET /api/db/conversations/:date - Get conversation by date
  router.get('/conversations/:date', (req, res) => dbAPI.getConversationByDate(req, res));

  // PATCH /api/db/conversations/:date/read - Mark conversation as read
  router.patch('/conversations/:date/read', jsonParser, (req, res) => dbAPI.markConversationRead(req, res));

  return router;
}
