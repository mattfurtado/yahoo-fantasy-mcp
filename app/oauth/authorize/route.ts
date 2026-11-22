// Validates the MCP client's request, then sends the user to Yahoo to log in.
import { yahooRedirectUri } from "@/lib/config";
import { now, open, seal } from "@/lib/seal";
import { yahooAuthorizeUrl } from "@/lib/yahoo";

function fail(msg: string) {
  return new Response(`Authorization error: ${msg}`, {
    status: 400,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const cid = q.get("client_id") ?? "";
  const client = open(cid, "client");
  if (!client) return fail("unknown client_id. Re-add the connector.");

  const redirect_uri = q.get("redirect_uri") ?? client.redirect_uris[0];
  if (!client.redirect_uris.includes(redirect_uri)) return fail("redirect_uri not registered for this client.");

  // From here on, errors go back to the client per RFC 6749 §4.1.2.1.
  const back = (error: string, description: string) => {
    const u = new URL(redirect_uri);
    u.searchParams.set("error", error);
    u.searchParams.set("error_description", description);
    if (q.get("state")) u.searchParams.set("state", q.get("state")!);
    return Response.redirect(u.toString(), 302);
  };

  if (q.get("response_type") !== "code") return back("unsupported_response_type", "Only 'code' is supported");
  const challenge = q.get("code_challenge");
  if (!challenge || q.get("code_challenge_method") !== "S256") {
    return back("invalid_request", "PKCE with S256 is required");
  }

  const state = seal({
    typ: "state",
    cid,
    redirect_uri,
    state: q.get("state") ?? undefined,
    challenge,
    exp: now() + 600,
  });
  return Response.redirect(yahooAuthorizeUrl(yahooRedirectUri(req), state), 302);
}
