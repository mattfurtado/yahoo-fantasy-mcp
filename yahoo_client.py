"""Thin Yahoo Fantasy Sports API client: OAuth2 token handling + JSON normalizing."""

from __future__ import annotations

import base64
import json
import os
import time
from pathlib import Path
from typing import Any

import httpx

AUTH_URL = "https://api.login.yahoo.com/oauth2/request_auth"
TOKEN_URL = "https://api.login.yahoo.com/oauth2/get_token"
API_BASE = "https://fantasysports.yahooapis.com/fantasy/v2"

TOKEN_PATH = Path(
    os.environ.get("YAHOO_TOKEN_PATH", Path.home() / ".yahoo-fantasy-mcp" / "token.json")
)


def client_creds() -> tuple[str, str, str]:
    try:
        cid = os.environ["YAHOO_CLIENT_ID"]
        secret = os.environ["YAHOO_CLIENT_SECRET"]
    except KeyError as e:
        raise RuntimeError(f"Missing env var {e}. Set YAHOO_CLIENT_ID and YAHOO_CLIENT_SECRET.")
    redirect = os.environ.get("YAHOO_REDIRECT_URI", "oob")
    return cid, secret, redirect


def _basic_auth(cid: str, secret: str) -> str:
    return "Basic " + base64.b64encode(f"{cid}:{secret}".encode()).decode()


def save_token(tok: dict) -> None:
    tok["expires_at"] = time.time() + int(tok.get("expires_in", 3600)) - 60
    TOKEN_PATH.parent.mkdir(parents=True, exist_ok=True)
    TOKEN_PATH.write_text(json.dumps(tok, indent=2))
    os.chmod(TOKEN_PATH, 0o600)


def load_token() -> dict:
    if not TOKEN_PATH.exists():
        raise RuntimeError(f"No token at {TOKEN_PATH}. Run `python auth.py` once first.")
    return json.loads(TOKEN_PATH.read_text())


def exchange_code(code: str) -> dict:
    cid, secret, redirect = client_creds()
    r = httpx.post(
        TOKEN_URL,
        headers={"Authorization": _basic_auth(cid, secret)},
        data={"grant_type": "authorization_code", "code": code, "redirect_uri": redirect},
    )
    r.raise_for_status()
    tok = r.json()
    save_token(tok)
    return tok


async def _refresh(client: httpx.AsyncClient, tok: dict) -> dict:
    cid, secret, redirect = client_creds()
    r = await client.post(
        TOKEN_URL,
        headers={"Authorization": _basic_auth(cid, secret)},
        data={
            "grant_type": "refresh_token",
            "refresh_token": tok["refresh_token"],
            "redirect_uri": redirect,
        },
    )
    r.raise_for_status()
    new = r.json()
    new.setdefault("refresh_token", tok["refresh_token"])
    save_token(new)
    return new


class YahooClient:
    def __init__(self) -> None:
        self._http = httpx.AsyncClient(timeout=30)
        self._tok: dict | None = None

    async def get(self, path: str) -> dict:
        """GET a Fantasy API resource path (e.g. 'league/449.l.123/standings')."""
        if self._tok is None:
            self._tok = load_token()
        if time.time() >= self._tok.get("expires_at", 0):
            self._tok = await _refresh(self._http, self._tok)
        url = f"{API_BASE}/{path.lstrip('/')}"
        params = {"format": "json"}
        for attempt in range(2):
            r = await self._http.get(
                url, params=params, headers={"Authorization": f"Bearer {self._tok['access_token']}"}
            )
            if r.status_code == 401 and attempt == 0:
                self._tok = await _refresh(self._http, self._tok)
                continue
            if r.status_code >= 400:
                raise RuntimeError(f"Yahoo API {r.status_code} for {path}: {r.text[:500]}")
            return r.json()["fantasy_content"]
        raise RuntimeError("unreachable")


# ---------- Yahoo JSON normalizing ----------
# Yahoo's JSON encodes entities as lists of single-key dicts (sometimes nested lists),
# and collections as {"0": {...}, "1": {...}, "count": N}.


def merge(x: Any) -> Any:
    """Flatten Yahoo's list-of-single-key-dicts into one dict."""
    if isinstance(x, list):
        out: dict = {}
        for el in x:
            if isinstance(el, list):
                out.update(merge(el))
            elif isinstance(el, dict):
                out.update(el)
        return out
    return x


def items(coll: Any, name: str) -> list:
    """Extract entities from a Yahoo numbered collection."""
    if isinstance(coll, list):  # some wrappers are [ {name+'s': {...}} ]
        coll = merge(coll)
    if not isinstance(coll, dict):
        return []
    out = []
    for k, v in coll.items():
        if k == "count" or not isinstance(v, dict) or name not in v:
            continue
        out.append(merge(v[name]))
    return out


def numbered(d: Any) -> Any:
    """Return d['0'] when d is a single-entry numbered wrapper, else d."""
    if isinstance(d, dict) and "0" in d:
        return d["0"]
    return d
