// Token endpoint: authorization_code (with PKCE) and refresh_token grants.
// Access tokens wrap the Yahoo access token; refresh tokens wrap Yahoo's refresh token.
import { createHash } from "node:crypto";
import { corsPreflight, guidAllowed, json, oauthError, SCOPE, yahooRedirectUri } from "@/lib/config";
import { now, open, seal } from "@/lib/seal";
import { refreshYahoo } from "@/lib/yahoo";

function issue(ya: string, yr: string, yexp: number, guid: string, cid: string) {
  const exp = Math.min(yexp - 60, now() + 3600);
  return json({
    access_token: seal({ typ: "access", ya, guid, cid, exp }),
    token_type: "Bearer",
    expires_in: Math.max(exp - now(), 60),
    refresh_token: seal({ typ: "refresh", yr, guid, cid }),
    scope: SCOPE,
  });
}

export async function POST(req: Request) {
  const form = new URLSearchParams(await req.text());
  const grant = form.get("grant_type");
  const cid = form.get("client_id") ?? "";

  if (grant === "authorization_code") {
    const c = open(form.get("code"), "code");
    if (!c) return oauthError("invalid_grant", "Code is invalid or expired");
    if (cid && cid !== c.cid) return oauthError("invalid_grant", "Code was issued to another client");
    if ((form.get("redirect_uri") ?? c.redirect_uri) !== c.redirect_uri) {
      return oauthError("invalid_grant", "redirect_uri mismatch");
    }
    const verifier = form.get("code_verifier") ?? "";
    const hashed = createHash("sha256").update(verifier).digest("base64url");
    if (!verifier || hashed !== c.challenge) return oauthError("invalid_grant", "PKCE verification failed");
    return issue(c.ya, c.yr, c.yexp, c.guid, c.cid);
  }

  if (grant === "refresh_token") {
    const r = open(form.get("refresh_token"), "refresh");
    if (!r) return oauthError("invalid_grant", "Refresh token is invalid");
    if (cid && cid !== r.cid) return oauthError("invalid_grant", "Token was issued to another client");
    if (!guidAllowed(r.guid)) return oauthError("invalid_grant", "Account no longer allowed");
    try {
      const t = await refreshYahoo(r.yr, yahooRedirectUri(req));
      return issue(t.access_token, t.refresh_token ?? r.yr, now() + Number(t.expires_in ?? 3600), r.guid, r.cid);
    } catch (e) {
      console.error(e);
      return oauthError("invalid_grant", "Yahoo refused to refresh; reconnect the connector");
    }
  }

  return oauthError("unsupported_grant_type", "Use authorization_code or refresh_token");
}

export const OPTIONS = corsPreflight;
