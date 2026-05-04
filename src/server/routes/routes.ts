/**
 * API Route Definitions
 *
 * Two sub-apps are mounted at `/api`:
 *
 *   publicApi    routes that are reachable without auth
 *   protectedApi routes gated by `requireAuthMiddleware`
 *
 * New routes default to authenticated by being registered on
 * `protectedApi`. Public routes are deliberate and listed in one
 * place so the surface is easy to audit. See
 * issues/auth-by-default for the rationale.
 */

import { Hono } from "hono";
import type { AuthVariables } from "@mentra/sdk";

import { getHealth } from "../api/health";
import { photoStream, transcriptionStream } from "../api/stream";
import { speak, stopAudio } from "../api/audio";
import { getThemePreference, setThemePreference } from "../api/storage";
import { getLatestPhoto, getPhotoData, getPhotoBase64 } from "../api/photo";
import { getSettings, updateSettings } from "../api/settings";
import { chatStream } from "../api/chat";
import { killSession } from "../api/debug";
import { requireAuthMiddleware } from "../utils/auth";

// SSE streams need proxy buffering disabled so Nginx/ingress forwards
// data immediately. Without this, heartbeats get stuck in Nginx's
// response buffer and the proxy considers the connection idle after
// its read timeout (~60s), killing the SSE.
const sseHeaders = async (c: any, next: any) => {
  c.header("X-Accel-Buffering", "no");
  c.header("Cache-Control", "no-cache, no-transform");
  await next();
};

// ── Public routes ──────────────────────────────────────────────────
//
// Reachable without an auth token. Keep this list short and
// deliberate. Anything that touches user state belongs on
// protectedApi.

const publicApi = new Hono();
publicApi.get("/health", getHealth);

// ── Protected routes ───────────────────────────────────────────────
//
// Every route below this point is gated by requireAuthMiddleware.
// Inside handlers, c.get("authUserId") is guaranteed to be set.

const protectedApi = new Hono<{ Variables: AuthVariables }>();
protectedApi.use("*", requireAuthMiddleware);

protectedApi.use("/photo-stream", sseHeaders);
protectedApi.use("/transcription-stream", sseHeaders);
protectedApi.use("/chat/stream", sseHeaders);
protectedApi.get("/photo-stream", photoStream);
protectedApi.get("/transcription-stream", transcriptionStream);
protectedApi.get("/chat/stream", chatStream);

// Audio
protectedApi.post("/speak", speak);
protectedApi.post("/stop-audio", stopAudio);

// Storage / preferences
protectedApi.get("/theme-preference", getThemePreference);
protectedApi.post("/theme-preference", setThemePreference);

// User settings
protectedApi.get("/settings", getSettings);
protectedApi.patch("/settings", updateSettings);

// Photos
protectedApi.get("/latest-photo", getLatestPhoto);
protectedApi.get("/photo/:requestId", getPhotoData);
protectedApi.get("/photo-base64/:requestId", getPhotoBase64);

// Debug (dev only). Still requires auth, just like every other route.
if (process.env.NODE_ENV === "development") {
  protectedApi.post("/debug/kill-session", killSession);
}

export const api = new Hono();
api.route("/", publicApi);
api.route("/", protectedApi);
