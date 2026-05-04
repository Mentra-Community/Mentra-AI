# Auth by Default: Design

## Context

The SDK auto-mounts `createAuthMiddleware` as a global middleware on
the AppServer's Hono instance. That middleware reads the request's
session cookie or bearer token, validates it, and if valid sets
`c.get("authUserId")` to the user id. It does not 401 on a missing
or invalid token; it just leaves `authUserId` unset and calls
`next()`. This matches Hono's own context-population pattern but
differs from Hono's `bearerAuth` and `jwt` middleware, which both
fail closed.

PR #5 made every handler call a helper to enforce auth:

```ts
export async function getSettings(c: Context) {
  const userId = requireAuth(c);
  if (typeof userId !== "string") return userId;
  // ... handler body
}
```

This is correct but fragile. A new handler that forgets the helper
is a public endpoint.

## Options considered

### A. Path-pattern middleware with allowlist

```ts
const PUBLIC = new Set(["/api/health"]);
api.use("/*", async (c, next) => {
  if (PUBLIC.has(c.req.path) || c.req.path.startsWith("/api/mentra/auth/")) {
    return next();
  }
  if (!c.get("authUserId")) return c.json({ error: "Unauthorized" }, 401);
  return next();
});
```

Pros: one file owns the policy, very Express-like.
Cons: allowlist drift. Adding a public route requires editing two
places (the route and the set).

### B. Sub-app split (chosen)

Two Hono instances mounted at the same prefix, one with auth
middleware applied, one without:

```ts
const publicApi = new Hono();
publicApi.get("/health", getHealth);

const protectedApi = new Hono<{ Variables: AuthVariables }>();
protectedApi.use("*", requireAuthMiddleware);
protectedApi.get("/settings", getSettings);
// ...

app.route("/api", publicApi);
app.route("/api", protectedApi);
```

Pros:
- New routes default to authenticated by virtue of which sub-app
  they are registered on.
- The sub-app's `Variables` generic types `c.get("authUserId")` as
  `string`, not `string | undefined`, inside protected handlers.
- This is the convention in production Hono codebases. It is the
  shape Hono's own `bearerAuth` example uses.
- No allowlist to maintain. The visible distinction in
  `routes.ts` is "this route is on `publicApi`" vs. "this route is
  on `protectedApi`".

Cons:
- Two registrations in `routes.ts` instead of one. Minor.
- The dev-only `/api/debug/*` mount needs to live on the protected
  sub-app, not at the top level, so it inherits the gate. Easy.

### C. Path-prefix convention (`/api/public/*`)

Routes under `/api/public/*` are open; everything else is gated.

Pros: zero config; the URL itself encodes intent.
Cons: ugly URLs, breaks existing endpoints (`/api/health` would
move). Not worth the churn.

### D. SDK change

`createAuthMiddleware({ enforce: true })` or a new
`createAuthGate()` middleware that 401s by default. This is the
right long-term fix; it makes every miniapp on the SDK fail closed
without each app having to reimplement the pattern. Out of scope
for this PR; tracked separately.

## Chosen design (B in detail)

### Middleware

Two thin middlewares in `utils/auth.ts`. The SDK's
`createAuthMiddleware` runs first (mounted globally by `AppServer`),
populating `authUserId` if a valid token exists. `requireAuth` 401s
if it didn't and re-exposes the id under the friendlier name
`userId`. `requireSession` chains after `requireAuth` on the
session sub-app and 404s if the user is not currently connected.

```ts
// src/server/utils/auth.ts
export const requireAuth: MiddlewareHandler<{
  Variables: { userId: string };
}> = async (c, next) => {
  const userId = c.get("authUserId");
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  c.set("userId", userId);
  await next();
};

export const requireSession: MiddlewareHandler<{
  Variables: { userId: string; user: User };
}> = async (c, next) => {
  const userId = c.get("userId");
  const user = sessions.get(userId);
  if (!user) return c.json({ error: "No active session" }, 404);
  c.set("user", user);
  await next();
};
```

The existing `requireAuth(c)` helper function is removed. Handlers
read `c.get("userId")` or `c.get("user")` directly and trust the
gate.

### Routes

```ts
// src/server/routes/routes.ts
const publicApi = new Hono();
publicApi.get("/health", getHealth);

// Auth-only: works whether or not glasses are connected. DB-backed
// reads/writes go here.
const protectedApi = new Hono<{ Variables: { userId: string } }>();
protectedApi.use("*", requireAuth);
protectedApi.get("/settings", getSettings);
protectedApi.patch("/settings", updateSettings);

// Session-required: every handler below needs a live User, so the
// gate does the lookup once and 404s if glasses are not connected.
const sessionApi = new Hono<{
  Variables: { userId: string; user: User };
}>();
sessionApi.use("*", requireAuth);
sessionApi.use("*", requireSession);

sessionApi.use("/photo-stream", sseHeaders);
sessionApi.use("/transcription-stream", sseHeaders);
sessionApi.use("/chat/stream", sseHeaders);

sessionApi.get("/photo-stream", photoStream);
sessionApi.get("/transcription-stream", transcriptionStream);
sessionApi.get("/chat/stream", chatStream);

sessionApi.post("/speak", speak);
sessionApi.post("/stop-audio", stopAudio);

sessionApi.get("/theme-preference", getThemePreference);
sessionApi.post("/theme-preference", setThemePreference);

sessionApi.get("/latest-photo", getLatestPhoto);
sessionApi.get("/photo/:requestId", getPhotoData);
sessionApi.get("/photo-base64/:requestId", getPhotoBase64);

if (process.env.NODE_ENV === "development") {
  sessionApi.post("/debug/kill-session", killSession);
}

export const api = new Hono();
api.route("/", publicApi);
api.route("/", protectedApi);
api.route("/", sessionApi);
```

`api` is still the single export consumed by `src/index.ts`, so the
top-level wiring does not change.

### Handlers

Two layers of boilerplate disappear: the auth check, and the
"is the user connected" lookup.

```ts
// before
export async function speak(c: Context) {
  const userId = requireAuth(c);
  if (typeof userId !== "string") return userId;

  const { text } = await c.req.json();
  if (!text) return c.json({ error: "text is required" }, 400);

  const user = sessions.get(userId);
  if (!user?.appSession) return c.json({ error: "No active session" }, 404);

  await user.audio.speak(text);
  return c.json({ success: true });
}

// after
export async function speak(c: Context) {
  const user = c.get("user"); // typed as User, never null

  const { text } = await c.req.json();
  if (!text) return c.json({ error: "text is required" }, 400);

  await user.audio.speak(text);
  return c.json({ success: true });
}
```

DB-backed handlers that don't need a live session use `userId`:

```ts
export async function getSettings(c: Context) {
  const userId = c.get("userId"); // typed as string
  return c.json(await UserSettings.findOne({ userId }));
}
```

### Why split userId vs user

Of the protected handlers in this app, most need the live `User`
runtime object (audio, photo, chatHistory hang off it).
`getSettings` and `updateSettings` only need the id (they query
MongoDB and work whether or not glasses are connected).

Putting both behind one middleware would force the settings routes
to either accept "no active session" 404s incorrectly, or to
duplicate the auth check at a finer grain. Splitting into two
sub-apps lets each handler declare what it actually needs, and the
type system enforces it.

### Naming

The SDK exposes `c.get("authUserId")`. We expose the same value as
`c.get("userId")` after the gate, mostly for readability and to
match the convention in our own code (where `userId` is the term
used everywhere except the SDK boundary).

`c.get("user")` for the `User` runtime object reads naturally
because in this app `User` genuinely is the runtime object. It owns
audio, photo, chatHistory, transcription, and storage managers. It
is not a thin "user record" with id and email. If that ever becomes
confusing we can rename to `userSession` or `session`, but `user`
matches the existing usage in `SessionManager` (`sessions.get(userId)`
returns a `User`).

### What stays per-handler

Handlers still own:

- request parsing (`c.req.json()`, query params)
- business logic (calling `user.audio.speak(text)` etc)
- non-auth error responses (e.g. validating `text` is non-empty)

Auth and "is the glasses session live" are now both middleware
concerns.

### Frontend

No frontend changes required by this refactor. The bot-flagged
issues are handled in the same PR but are independent:

- `authFetch` should merge `Request` headers when the input is a
  `Request` object, not just rebuild from `init.headers`.
- SSE connect callers (chat, photo, transcription, debug overlay)
  should early-return if `frontendToken` is null. This avoids an
  initial unauthenticated stream that 401s and triggers the
  reconnect loop while `useMentraAuth()` is still resolving.

### Test fix

`src/server/test/unit-tests/session-disconnect.test.ts` calls
`POST /api/debug/kill-session` with no auth. Under the new gate it
returns 401. The test mints a frontend token from the env API key
using `generateFrontendToken(userId, apiKey)` and sends it as a
bearer header. No dev-only auth bypass is added; the test
authenticates like any other client.

## Migration notes

For any future handler:

1. Pick the sub-app:
   - `publicApi` only if the route is genuinely public. Comment why.
   - `protectedApi` if the route only needs the authenticated id
     (typically DB-backed reads/writes).
   - `sessionApi` if the handler needs the live `User` (audio,
     photo, transcription, chat history, etc).
2. Read `c.get("userId")` or `c.get("user")` directly. No helper
   call. The type system narrows them to non-null inside the right
   sub-app.
3. Do not accept `userId` from query or body. The authenticated id
   wins. If a body field happens to include it, ignore it.

## Open questions

- Long term, push this pattern back into the SDK so every miniapp
  inherits fail-closed behavior without duplicating the setup.
  `createAuthMiddleware({ enforce: true })` plus an optional
  `requireSession` helper would cover this app and others.
