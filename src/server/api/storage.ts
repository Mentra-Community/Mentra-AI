import type { Context } from "hono";
import { sessions } from "../manager/SessionManager";

/** GET /theme-preference */
export async function getThemePreference(c: Context) {
  const userId = c.get("authUserId") as string;

  const user = sessions.get(userId);
  if (!user?.appSession) {
    return c.json({ error: "No active session" }, 404);
  }

  try {
    const theme = await user.storage.getTheme();
    return c.json({ theme });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
}

/** POST /theme-preference */
export async function setThemePreference(c: Context) {
  const userId = c.get("authUserId") as string;

  const { theme } = await c.req.json();
  if (!theme || (theme !== "dark" && theme !== "light")) {
    return c.json({ error: 'theme must be "dark" or "light"' }, 400);
  }

  const user = sessions.get(userId);
  if (!user?.appSession) {
    return c.json({ error: "No active session" }, 404);
  }

  try {
    await user.storage.setTheme(theme);
    return c.json({ success: true, theme });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
}
