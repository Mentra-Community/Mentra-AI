import type { SessionContext } from "../utils/auth";

/** POST /speak: text-to-speech on the glasses */
export async function speak(c: SessionContext) {
  const user = c.get("user");

  const { text } = await c.req.json();
  if (!text) return c.json({ error: "text is required" }, 400);

  // requireSession proved we have a User, but the User can exist
  // without an attached glasses connection (soft disconnect, grace
  // period). Speaking needs the radio.
  if (!user.appSession) {
    return c.json({ error: "No active session" }, 404);
  }

  try {
    await user.audio.speak(text);
    return c.json({ success: true, message: "Text-to-speech started" });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
}

/** POST /stop-audio: stop audio playback */
export async function stopAudio(c: SessionContext) {
  const user = c.get("user");

  if (!user.appSession) {
    return c.json({ error: "No active session" }, 404);
  }

  try {
    await user.audio.stopAudio();
    return c.json({ success: true, message: "Audio stopped" });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
}
