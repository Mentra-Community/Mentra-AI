/**
 * Auth helpers for the Hono API layer.
 *
 * The MentraOS AppServer base class auto-applies `createAuthMiddleware`
 * across all routes. After it runs, the authenticated user id is
 * available via `c.get("authUserId")` on every handler. These helpers
 * centralize the unauthorized response so route handlers don't each
 * re-implement the check.
 *
 * Always pull the user id from the authenticated context — never trust
 * a userId passed in the query string or request body.
 */

import type { Context } from "hono";

/**
 * Returns the authenticated user id, or null if the request is not
 * authenticated.
 */
export function getAuthUserId(c: Context): string | null {
  const userId = c.get("authUserId" as never) as string | undefined;
  return userId ?? null;
}

/**
 * Returns the authenticated user id or sends a 401 JSON response.
 * Use as: `const userId = requireAuth(c); if (typeof userId !== "string") return userId;`
 */
export function requireAuth(c: Context): string | Response {
  const userId = getAuthUserId(c);
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  return userId;
}
