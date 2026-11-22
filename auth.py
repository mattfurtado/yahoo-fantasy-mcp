"""One-time Yahoo OAuth2 login. Run this before starting the MCP server."""

import sys
import urllib.parse
import webbrowser

from yahoo_client import AUTH_URL, TOKEN_PATH, client_creds, exchange_code


def main() -> None:
    cid, _, redirect = client_creds()
    url = AUTH_URL + "?" + urllib.parse.urlencode(
        {"client_id": cid, "redirect_uri": redirect, "response_type": "code", "language": "en-us"}
    )
    print("Opening Yahoo login. If no browser opens, visit:\n\n" + url + "\n")
    webbrowser.open(url)
    raw = input("Paste the code Yahoo shows you (or the full redirected URL): ").strip()
    if raw.startswith("http"):
        raw = urllib.parse.parse_qs(urllib.parse.urlparse(raw).query).get("code", [""])[0]
    if not raw:
        sys.exit("No code found.")
    exchange_code(raw)
    print(f"Saved token to {TOKEN_PATH}. You can start the MCP server now.")


if __name__ == "__main__":
    main()
