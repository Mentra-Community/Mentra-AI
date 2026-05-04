# Auth by Default

## Goal

Every HTTP route in this app should be authenticated unless it is
explicitly declared public. Adding a new route should default to
"authenticated"; opting out should be a deliberate, visible step.

## Why

The first cut of the auth work in PR #5 swapped client-supplied
`userId` for the authenticated id from `c.get("authUserId")` and
added a per-handler helper:

```ts
const userId = requireAuth(c);
if (typeof userId !== "string") return userId;
```

That works, but it makes "authenticated" a thing each handler has to
remember to do. If a future handler forgets the two lines, the route
silently becomes a public endpoint that reads or writes user state.
That is the same class of mistake the original code made, just at a
finer grain.

We want the failure mode to be the opposite: forgetting auth makes a
route inaccessible, not insecure.

## Non-goals

- Changing `@mentra/sdk`. The SDK ships `createAuthMiddleware` as a
  context-populating middleware (it sets `authUserId` if present and
  passes the request through either way). A future SDK change could
  flip that default; that is out of scope for this PR. See
  `design.md` for what that change might look like.
- Changing the supported token types. We continue to accept signed
  user token, temp token, frontend token, and session cookie via the
  same middleware.
- Per-route role/permission checks. Every authenticated user has the
  same access to their own data; cross-user access is already
  prevented by the fact that the handler keys data by the
  authenticated id.

## Behavior

After this change:

| Path                     | Auth required | Active session required |
| ------------------------ | ------------- | ----------------------- |
| `/api/health`            | no            | no                      |
| `/api/mentra/auth/*`     | no            | no                      |
| `/api/settings`          | yes           | no                      |
| every other `/api/*`     | yes           | yes                     |
| `/api/debug/*`           | yes (dev only)| yes                     |

A request hitting an auth-required route without a valid token
returns `401 Unauthorized`. A request hitting a session-required
route while authenticated but with no active glasses session
returns `404 No active session`. The handler never runs in either
case.

Inside a session-required handler, `c.get("user")` is guaranteed
to be a non-null `User`. Inside an auth-only handler,
`c.get("userId")` is guaranteed to be a non-empty string. Handlers
no longer need to do `sessions.get(userId)` themselves or
null-check the result.

## Acceptance

- New routes added to the protected sub-app are gated automatically
  by auth.
- New routes added to the session sub-app are additionally gated by
  an active glasses session.
- Handlers reading `c.get("user")` never have to null-check it; the
  gate guarantees it.
- Handlers reading `c.get("userId")` get a typed string, no cast.
- Public routes are listed in one place (`routes.ts`), making it
  easy to audit what is reachable without auth.
- `/api/health` still answers `200 OK` with no token.
- Bot review feedback on PR #5 is addressed (cubic SSE-token guard,
  cubic Request headers merge, Codex disconnect test).
