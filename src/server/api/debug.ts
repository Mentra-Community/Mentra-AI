/**
 * Debug API
 *
 * Dev-only endpoints for testing session lifecycle. Mounted on
 * the session sub-app, so a valid auth token AND a live User are
 * required just like any other route there.
 */

import { sessions } from "../manager/SessionManager";
import type { SessionContext } from "../utils/auth";

import { broadcastChatEvent, clearPendingEvents } from "./chat";

/**
 * POST /api/debug/kill-session?mode=soft|hard
 *
 * Simulates MentraAI.onStop() for the authenticated user.
 * - mode=soft (default): grace period, keeps session alive for 60s
 * - mode=hard: immediate destroy, wipes everything
 */
export async function killSession(c: SessionContext) {
  const userId = c.get("userId");
  const mode = c.req.query("mode") || "soft";

  if (mode === "hard") {
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

  // Soft kill: grace period (matches real onStop behavior)
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
