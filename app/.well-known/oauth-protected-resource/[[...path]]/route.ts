// RFC 9728 protected resource metadata, served at both
// /.well-known/oauth-protected-resource and /.well-known/oauth-protected-resource/api/mcp
import { baseUrl, corsPreflight, json, SCOPE } from "@/lib/config";

export function GET(req: Request) {
  const base = baseUrl(req);
  return json({
    resource: `${base}/api/mcp`,
    authorization_servers: [base],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "Yahoo Fantasy Football",
  });
}

export const OPTIONS = corsPreflight;
