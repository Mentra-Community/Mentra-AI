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

A small middleware that 401s if `authUserId` is not set. The SDK's
`createAuthMiddleware` still runs first (it is mounted globally by
`AppServer`'s constructor), so by the time this gate runs the
context is already populated if a valid token was present.

```ts
// src/server/utils/auth.ts
export const requireAuthMiddleware: MiddlewareHandler = async (c, next) => {
  if (!c.get("authUserId")) return c.json({ error: "Unauthorized" }, 401);
  await next();
};
```

The existing `requireAuth(c)` helper is removed. Handlers read
`c.get("authUserId")` directly and trust it.

### Routes

```ts
// src/server/routes/routes.ts
const publicApi = new Hono();
publicApi.get("/health", getHealth);

const protectedApi = new Hono<{ Variables: AuthVariables }>();
protectedApi.use("*", requireAuthMiddleware);

// SSE buffering headers stay on the protected sub-app.
protectedApi.use("/photo-stream", sseHeaders);
protectedApi.use("/transcription-stream", sseHeaders);
protectedApi.use("/chat/stream", sseHeaders);

protectedApi.get("/photo-stream", photoStream);
protectedApi.get("/transcription-stream", transcriptionStream);
protectedApi.get("/chat/stream", chatStream);

protectedApi.post("/speak", speak);
protectedApi.post("/stop-audio", stopAudio);

protectedApi.get("/theme-preference", getThemePreference);
protectedApi.post("/theme-preference", setThemePreference);

protectedApi.get("/settings", getSettings);
protectedApi.patch("/settings", updateSettings);

protectedApi.get("/latest-photo", getLatestPhoto);
protectedApi.get("/photo/:requestId", getPhotoData);
protectedApi.get("/photo-base64/:requestId", getPhotoBase64);

if (process.env.NODE_ENV === "development") {
  protectedApi.post("/debug/kill-session", killSession);
}

export const api = new Hono();
api.route("/", publicApi);
api.route("/", protectedApi);
```

`api` is still the single export consumed by `src/index.ts`, so the
top-level wiring does not change.

### Handlers

Per-handler boilerplate is removed:

```ts
// before
export async function getSettings(c: Context) {
  const userId = requireAuth(c);
  if (typeof userId !== "string") return userId;
  // ...
}

// after
export async function getSettings(c: Context) {
  const userId = c.get("authUserId");
  // ...
}
```

The `Context` type alone gives `authUserId` as `string | undefined`,
which is fine: by the time the handler runs the gate has guaranteed
it is set, but TypeScript does not know that. We accept the
non-null assertion or read it with confidence and move on.

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

1. Register on `protectedApi` (default) unless the route is
   genuinely public, in which case use `publicApi` and make the
   "why" obvious in a comment.
2. Read `c.get("authUserId")` directly. No helper call.
3. Do not accept `userId` from query or body. The authenticated id
   wins. If a body field happens to include it, ignore it.

## Open questions

- Should we add a runtime assertion in protected handlers that
  `authUserId` is set, just to surface bugs loudly if someone
  accidentally registers a route on the wrong sub-app? Probably
  yes, as a thin wrapper utility, but kept minimal.
- Long term, push this pattern back into the SDK so every miniapp
  inherits fail-closed behavior without duplicating the setup.
