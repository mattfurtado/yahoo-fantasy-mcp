// End-to-end OAuth flow against the route handlers, with Yahoo's endpoints mocked.
import { strict as assert } from "node:assert";
import { createHash, randomBytes } from "node:crypto";
import { before, test } from "node:test";

process.env.TOKEN_SECRET = "test-secret-0123456789-abcdefghijklmnop";
process.env.YAHOO_CLIENT_ID = "yid";
process.env.YAHOO_CLIENT_SECRET = "ysecret";
process.env.PUBLIC_URL = "https://fantasy.example.com";

const yahooCalls: URLSearchParams[] = [];
before(() => {
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith("https://api.login.yahoo.com/oauth2/get_token")) {
      const body = new URLSearchParams(String(init?.body));
      yahooCalls.push(body);
      assert.equal((init?.headers as any).authorization, "Basic " + Buffer.from("yid:ysecret").toString("base64"));
      const n = yahooCalls.length;
      return Response.json({
        access_token: `ya-${n}`,
        refresh_token: body.get("grant_type") === "refresh_token" ? body.get("refresh_token") : "yr-1",
        expires_in: 3600,
        xoauth_yahoo_guid: "GUID123",
      });
    }
    throw new Error("unexpected fetch " + u);
  }) as typeof fetch;
});

const base = "https://fantasy.example.com";
const redirect = "https://claude.ai/api/mcp/auth_callback";

test("full authorization code + PKCE + refresh flow", async () => {
  const { GET: asMeta } = await import("../app/.well-known/oauth-authorization-server/route.ts");
  const meta = await asMeta(new Request(`${base}/.well-known/oauth-authorization-server`)).json();
  assert.equal(meta.token_endpoint, `${base}/oauth/token`);

  const { GET: prMeta } = await import("../app/.well-known/oauth-protected-resource/[[...path]]/route.ts");
  const pr = await prMeta(new Request(`${base}/.well-known/oauth-protected-resource/api/mcp`)).json();
  assert.equal(pr.resource, `${base}/api/mcp`);

  // 1. Dynamic client registration
  const { POST: register } = await import("../app/oauth/register/route.ts");
  const reg = await register(new Request(`${base}/oauth/register`, {
    method: "POST",
    body: JSON.stringify({ redirect_uris: [redirect], client_name: "Claude" }),
  }));
  assert.equal(reg.status, 201);
  const { client_id } = await reg.json();

  const bad = await register(new Request(`${base}/oauth/register`, {
    method: "POST", body: JSON.stringify({ redirect_uris: ["http://evil.com/cb"] }),
  }));
  assert.equal(bad.status, 400);

  // 2. Authorize -> redirect to Yahoo
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const { GET: authorize } = await import("../app/oauth/authorize/route.ts");
  const q = new URLSearchParams({
    response_type: "code", client_id, redirect_uri: redirect, state: "xyz",
    code_challenge: challenge, code_challenge_method: "S256", scope: "fantasy:read",
  });
  const a = await authorize(new Request(`${base}/oauth/authorize?${q}`));
  assert.equal(a.status, 302);
  const yUrl = new URL(a.headers.get("location")!);
  assert.equal(yUrl.host, "api.login.yahoo.com");
  assert.equal(yUrl.searchParams.get("redirect_uri"), `${base}/oauth/callback`);

  const wrongRedirect = await authorize(new Request(`${base}/oauth/authorize?${new URLSearchParams({ ...Object.fromEntries(q), redirect_uri: "https://evil.com/cb" })}`));
  assert.equal(wrongRedirect.status, 400);

  // 3. Yahoo -> callback -> redirect to client with code
  const { GET: callback } = await import("../app/oauth/callback/route.ts");
  const cb = await callback(new Request(`${base}/oauth/callback?code=yc&state=${yUrl.searchParams.get("state")}`));
  assert.equal(cb.status, 302);
  const back = new URL(cb.headers.get("location")!);
  assert.equal(back.origin + back.pathname, redirect);
  assert.equal(back.searchParams.get("state"), "xyz");
  const code = back.searchParams.get("code")!;
  assert.equal(yahooCalls[0].get("code"), "yc");

  // 4. Token exchange (wrong verifier fails, right one succeeds)
  const { POST: token } = await import("../app/oauth/token/route.ts");
  const tokReq = (v: string) => new Request(`${base}/oauth/token`, {
    method: "POST",
    body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: v, client_id, redirect_uri: redirect }),
  });
  assert.equal((await token(tokReq("nope"))).status, 400);
  const t = await token(tokReq(verifier));
  assert.equal(t.status, 200);
  const tj = await t.json();
  assert.equal(tj.token_type, "Bearer");

  const { open } = await import("../lib/seal.ts");
  assert.equal(open(tj.access_token, "access")?.ya, "ya-1");
  assert.equal(open(tj.access_token, "refresh"), null, "access token must not work as refresh token");
  assert.equal(open(tj.access_token.slice(0, -2) + "AA", "access"), null, "tampered token rejected");

  // 5. Refresh
  const r = await token(new Request(`${base}/oauth/token`, {
    method: "POST",
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: tj.refresh_token, client_id }),
  }));
  const rj = await r.json();
  assert.equal(r.status, 200);
  assert.equal(open(rj.access_token, "access")?.ya, "ya-2");
  assert.equal(yahooCalls[1].get("refresh_token"), "yr-1");
});

test("allowlist blocks other Yahoo accounts", async () => {
  process.env.ALLOWED_YAHOO_GUIDS = "SOMEONE_ELSE";
  const { seal, now } = await import("../lib/seal.ts");
  const { GET: callback } = await import("../app/oauth/callback/route.ts");
  const state = seal({ typ: "state", cid: "c", redirect_uri: redirect, challenge: "x", exp: now() + 60 });
  const res = await callback(new Request(`${base}/oauth/callback?code=yc&state=${state}`));
  assert.equal(res.status, 403);
  assert.match(await res.text(), /GUID123/);
  delete process.env.ALLOWED_YAHOO_GUIDS;
});
