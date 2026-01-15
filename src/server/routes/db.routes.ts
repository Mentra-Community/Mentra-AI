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

  // DELETE /api/db/settings - Delete user settings
  router.delete('/settings', (req, res) => dbAPI.deleteUserSettings(req, res));

  return router;
}
