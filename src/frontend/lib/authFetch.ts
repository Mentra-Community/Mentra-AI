/**
 * authFetch — authenticated fetch wrapper.
 *
 * Attaches the MentraOS frontendToken as a Bearer token on every
 * request so the SDK auth middleware can identify the user via
 * c.get("authUserId").
 *
 * For SSE/EventSource (which can't set custom headers) use
 * `withAuthSseUrl` to append the token as a query param.
 */

export function createAuthFetch(frontendToken: string | null) {
  return function authFetch(
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> {
    const headers = new Headers(init?.headers);

    if (frontendToken) {
      headers.set("Authorization", `Bearer ${frontendToken}`);
    }

    return fetch(input, { ...init, headers });
  };
}

/**
 * Append the frontend token to a URL as a query string parameter.
 * Use this for EventSource (SSE) connections, which cannot send
 * custom headers.
 */
export function withAuthSseUrl(
  url: string,
  frontendToken: string | null,
): string {
  if (!frontendToken) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}aos_frontend_token=${encodeURIComponent(frontendToken)}`;
}
