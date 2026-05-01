/**
 * Debug API — dev-only endpoints for testing session lifecycle.
 *
 * Even in dev mode, the user can only act on their own session — the
 * id is taken from the authenticated context, not from the request.
 */

import type { Context } from "hono";
import { sessions } from "../manager/SessionManager";
import { broadcastChatEvent, clearPendingEvents } from "./chat";
import { requireAuth } from "../utils/auth";

/**
 * POST /api/debug/kill-session?mode=soft|hard
 *
 * Simulates MentraAI.onStop() for the authenticated user.
 * - mode=soft (default): grace period, keeps session alive for 60s
 * - mode=hard: immediate destroy, wipes everything
 */
export async function killSession(c: Context) {
  const userId = requireAuth(c);
  if (typeof userId !== "string") return userId;

  const mode = c.req.query("mode") || "soft";

  const user = sessions.get(userId);
  if (!user) return c.json({ error: "No active session" }, 404);

  if (mode === "hard") {
    // Hard kill — immediate destroy (old behavior)
    broadcastChatEvent(userId, {
      type: "session_ended",
      reason: "debug-hard-kill",
      timestamp: new Date().toISOString(),
    });
    clearPendingEvents(userId);
    sessions.remove(userId);

    return c.json({
      success: true,
      mode: "hard",
      message: "Session hard-killed",
    });
  }

  // Soft kill — grace period (matches real onStop behavior)
  broadcastChatEvent(userId, {
    type: "session_reconnecting",
    reason: "debug-soft-kill",
    timestamp: new Date().toISOString(),
  });
  sessions.softRemove(userId);

  return c.json({
    success: true,
    mode: "soft",
    message: "Session soft-killed (60s grace period)",
  });
}
