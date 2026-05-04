/**
 * Auth helpers for the Hono API layer.
 *
 * The MentraOS AppServer base class auto-applies `createAuthMiddleware`
 * across all routes. After it runs, the authenticated user id is
 * available via `c.get("authUserId")` on every handler. The middleware
 * itself does not 401 on a missing token; it just leaves the context
 * variable unset.
 *
 * To make routes fail closed by default, this module exports
 * `requireAuthMiddleware`, mounted on the protected sub-app in
 * routes.ts. After that gate runs, handlers can read
 * `c.get("authUserId")` and trust the value is set.
 *
 * See issues/auth-by-default for the full rationale.
 */

import type { MiddlewareHandler } from "hono";
import type { AuthVariables } from "@mentra/sdk";

/**
 * Mount on a Hono sub-app to require authentication for every route
 * registered on that sub-app. Returns 401 Unauthorized when
 * `c.get("authUserId")` is not set by the SDK auth middleware.
 */
export const requireAuthMiddleware: MiddlewareHandler<{
  Variables: AuthVariables;
}> = async (c, next) => {
  if (!c.get("authUserId")) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
};
