// RFC 8414 authorization server metadata. This deployment is its own authorization
// server: it brokers the user's Yahoo login and issues sealed MCP tokens.
import { baseUrl, corsPreflight, json, SCOPE } from "@/lib/config";

export function GET(req: Request) {
  const base = baseUrl(req);
  return json({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [SCOPE],
  });
}

export const OPTIONS = corsPreflight;
