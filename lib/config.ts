export const SCOPE = "fantasy:read";

/** Public origin of this deployment. Must match the redirect URI registered with Yahoo. */
export function baseUrl(req: Request): string {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, "");
  if (process.env.VERCEL_ENV === "production" && process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  const u = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? u.host;
  const proto = req.headers.get("x-forwarded-proto") ?? u.protocol.replace(":", "");
  return `${proto}://${host}`;
}

export const yahooRedirectUri = (req: Request) => `${baseUrl(req)}/oauth/callback`;

export function yahooCreds() {
  const id = process.env.YAHOO_CLIENT_ID;
  const secret = process.env.YAHOO_CLIENT_SECRET;
  if (!id || !secret) throw new Error("YAHOO_CLIENT_ID and YAHOO_CLIENT_SECRET must be set");
  return { id, secret };
}

/** Optional allowlist of Yahoo account GUIDs permitted to use this server. */
export function guidAllowed(guid: string): boolean {
  const list = (process.env.ALLOWED_YAHOO_GUIDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length === 0 || list.includes(guid);
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      ...headers,
    },
  });
}

export function oauthError(error: string, description: string, status = 400) {
  return json({ error, error_description: description }, status);
}

export function corsPreflight() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "authorization, content-type, mcp-protocol-version",
      "access-control-max-age": "86400",
    },
  });
}
