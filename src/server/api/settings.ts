/**
 * User Settings API
 *
 * Handles user settings like theme and chat history preferences.
 * The user id is always taken from the authenticated context, never
 * from request input.
 */

import type { Context } from "hono";
import { UserSettings } from "../db/schemas/user-settings.schema";
import { requireAuth } from "../utils/auth";

/**
 * Get user settings
 */
export async function getSettings(c: Context) {
  const userId = requireAuth(c);
  if (typeof userId !== "string") return userId;

  try {
    let settings = await UserSettings.findOne({ userId });

    if (!settings) {
      // Create default settings if not found
      settings = await UserSettings.create({
        userId,
        theme: "dark",
        chatHistoryEnabled: false,
      });
    }

    return c.json(settings);
  } catch (error) {
    console.error("Error fetching settings:", error);
    return c.json({ error: "Failed to fetch settings" }, 500);
  }
}

/**
 * Update user settings (partial update)
 */
export async function updateSettings(c: Context) {
  const userId = requireAuth(c);
  if (typeof userId !== "string") return userId;

  try {
    const body = await c.req.json();
    // Strip any client-supplied userId — the authenticated id always wins.
    const { userId: _ignored, ...updates } = body;

    // Find and update, or create if not exists
    const settings = await UserSettings.findOneAndUpdate(
      { userId },
      { $set: updates },
      { returnDocument: 'after', upsert: true }
    );

    return c.json(settings);
  } catch (error) {
    console.error("Error updating settings:", error);
    return c.json({ error: "Failed to update settings" }, 500);
  }
}
