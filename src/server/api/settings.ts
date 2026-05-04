/**
 * User Settings API
 *
 * Handles user settings like theme and chat history preferences.
 * The user id always comes from the authenticated context. Auth is
 * enforced at the sub-app level (see routes.ts), so handlers can
 * read c.get("authUserId") directly.
 */

import type { Context } from "hono";
import { UserSettings } from "../db/schemas/user-settings.schema";

/**
 * Get user settings
 */
export async function getSettings(c: Context) {
  const userId = c.get("authUserId") as string;

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
  const userId = c.get("authUserId") as string;

  try {
    const body = await c.req.json();
    // Strip any client-supplied userId. The authenticated id always wins.
    const { userId: _ignored, ...updates } = body;

    const settings = await UserSettings.findOneAndUpdate(
      { userId },
      { $set: updates },
      { returnDocument: "after", upsert: true },
    );

    return c.json(settings);
  } catch (error) {
    console.error("Error updating settings:", error);
    return c.json({ error: "Failed to update settings" }, 500);
  }
}
