// RFC 7591 dynamic client registration. Stateless: the client_id is a sealed
// record of the client's redirect URIs, so nothing needs to be stored.
import { corsPreflight, json, oauthError } from "@/lib/config";
import { seal } from "@/lib/seal";

function validRedirect(u: unknown): u is string {
  if (typeof u !== "string") return false;
  try {
    const url = new URL(u);
    if (url.hash) return false;
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    return url.protocol === "https:" || (url.protocol === "http:" && loopback);
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return oauthError("invalid_client_metadata", "Body must be JSON");
  }
  const uris = body?.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > 10 || !uris.every(validRedirect)) {
    return oauthError("invalid_redirect_uri", "redirect_uris must be https (or http loopback) URLs");
  }
  const name = typeof body.client_name === "string" ? body.client_name.slice(0, 100) : undefined;
  const client_id = seal({ typ: "client", redirect_uris: uris, name });
  return json(
    {
      client_id,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: name,
      redirect_uris: uris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    201,
  );
}

export const OPTIONS = corsPreflight;
