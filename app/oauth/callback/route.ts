// Yahoo redirects here after login. Exchange Yahoo's code, then hand the MCP
// client its own authorization code (which carries the sealed Yahoo tokens).
import { guidAllowed, yahooRedirectUri } from "@/lib/config";
import { now, open, seal } from "@/lib/seal";
import { exchangeYahooCode } from "@/lib/yahoo";

function page(msg: string, status = 400) {
  return new Response(msg, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const st = open(q.get("state"), "state");
  if (!st) return page("Login expired or invalid. Start the connection again from Claude.");

  const back = (params: Record<string, string>) => {
    const u = new URL(st.redirect_uri);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    if (st.state) u.searchParams.set("state", st.state);
    return Response.redirect(u.toString(), 302);
  };

  if (q.get("error")) return back({ error: "access_denied", error_description: "Yahoo login was cancelled" });
  const code = q.get("code");
  if (!code) return back({ error: "server_error", error_description: "Yahoo returned no code" });

  let tok;
  try {
    tok = await exchangeYahooCode(code, yahooRedirectUri(req));
  } catch (e) {
    console.error(e);
    return back({ error: "server_error", error_description: "Yahoo token exchange failed" });
  }

  const guid = tok.xoauth_yahoo_guid ?? "";
  console.log(`Yahoo login: guid=${guid}`);
  if (!guidAllowed(guid)) {
    return page(
      `This Yahoo account isn't allowed on this server.\n\nIts GUID is ${guid}. ` +
        "If it's yours, add it to ALLOWED_YAHOO_GUIDS in Vercel and redeploy.",
      403,
    );
  }

  const mcpCode = seal({
    typ: "code",
    cid: st.cid,
    redirect_uri: st.redirect_uri,
    challenge: st.challenge,
    ya: tok.access_token,
    yr: tok.refresh_token,
    yexp: now() + Number(tok.expires_in ?? 3600),
    guid,
    exp: now() + 120,
  });
  return back({ code: mcpCode });
}
