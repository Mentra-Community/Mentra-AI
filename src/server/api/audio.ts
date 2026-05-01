import type { Context } from "hono";
import { sessions } from "../manager/SessionManager";
import { requireAuth } from "../utils/auth";

/** POST /speak — text-to-speech on the glasses */
export async function speak(c: Context) {
  const userId = requireAuth(c);
  if (typeof userId !== "string") return userId;

  const { text } = await c.req.json();
  if (!text) return c.json({ error: "text is required" }, 400);

  const user = sessions.get(userId);
  if (!user?.appSession) {
    return c.json({ error: "No active session" }, 404);
  }

  try {
    await user.audio.speak(text);
    return c.json({ success: true, message: "Text-to-speech started" });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
}

/** POST /stop-audio — stop audio playback */
export async function stopAudio(c: Context) {
  const userId = requireAuth(c);
  if (typeof userId !== "string") return userId;

  const user = sessions.get(userId);
  if (!user?.appSession) {
    return c.json({ error: "No active session" }, 404);
  }

  try {
    await user.audio.stopAudio();
    return c.json({ success: true, message: "Audio stopped" });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
}
