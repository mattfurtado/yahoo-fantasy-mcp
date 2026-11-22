import { yahooCreds } from "./config";

const AUTH_URL = "https://api.login.yahoo.com/oauth2/request_auth";
const TOKEN_URL = "https://api.login.yahoo.com/oauth2/get_token";
const API_BASE = "https://fantasysports.yahooapis.com/fantasy/v2";

// ---------- OAuth ----------

export interface YahooTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  xoauth_yahoo_guid?: string;
}

export function yahooAuthorizeUrl(redirectUri: string, state: string): string {
  const { id } = yahooCreds();
  const q = new URLSearchParams({
    client_id: id,
    redirect_uri: redirectUri,
    response_type: "code",
    language: "en-us",
    state,
  });
  return `${AUTH_URL}?${q}`;
}

async function tokenRequest(params: Record<string, string>): Promise<YahooTokens> {
  const { id, secret } = yahooCreds();
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params),
  });
  if (!r.ok) throw new Error(`Yahoo token endpoint ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return (await r.json()) as YahooTokens;
}

export const exchangeYahooCode = (code: string, redirectUri: string) =>
  tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri });

export const refreshYahoo = (refreshToken: string, redirectUri: string) =>
  tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken, redirect_uri: redirectUri });

// ---------- API ----------

export class YahooAuthError extends Error {}

export async function yget(path: string, accessToken: string): Promise<any> {
  const url = `${API_BASE}/${path.replace(/^\//, "")}${path.includes("?") ? "&" : "?"}format=json`;
  const r = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  if (r.status === 401) throw new YahooAuthError("Yahoo access token expired or revoked");
  if (!r.ok) throw new Error(`Yahoo API ${r.status} for ${path}: ${(await r.text()).slice(0, 500)}`);
  return (await r.json()).fantasy_content;
}

// ---------- Yahoo JSON normalizing ----------
// Entities come as lists of single-key objects (sometimes nested lists);
// collections come as {"0": {...}, "1": {...}, "count": N}.

export function merge(x: any): any {
  if (!Array.isArray(x)) return x;
  const out: Record<string, any> = {};
  for (const el of x) {
    if (Array.isArray(el)) Object.assign(out, merge(el));
    else if (el && typeof el === "object") Object.assign(out, el);
  }
  return out;
}

export function items(coll: any, name: string): any[] {
  if (Array.isArray(coll)) coll = merge(coll);
  if (!coll || typeof coll !== "object") return [];
  return Object.entries(coll)
    .filter(([k, v]) => k !== "count" && v && typeof v === "object" && name in (v as any))
    .map(([, v]) => merge((v as any)[name]));
}

export const numbered = (d: any) => (d && typeof d === "object" && "0" in d ? d["0"] : d);

export function num(v: any): any {
  const f = Number(v);
  if (v === null || v === undefined || v === "" || Number.isNaN(f)) return v;
  return Number.isInteger(f) ? f : Math.round(f * 100) / 100;
}

const compact = <T extends Record<string, any>>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "")) as T;

export function teamSummary(t: any) {
  const out: Record<string, any> = {
    team_key: t.team_key,
    name: t.name,
    manager: items(t.managers, "manager")[0]?.nickname,
    is_my_team: Boolean(Number(t.is_owned_by_current_login ?? 0)),
  };
  if (t.team_points) out.points = num(t.team_points.total);
  if (t.team_projected_points) out.projected = num(t.team_projected_points.total);
  if (t.team_standings) {
    const s = t.team_standings;
    const ot = s.outcome_totals ?? {};
    Object.assign(out, {
      rank: num(s.rank),
      wins: num(ot.wins),
      losses: num(ot.losses),
      ties: num(ot.ties),
      points_for: num(s.points_for),
      points_against: num(s.points_against),
      streak: s.streak ? `${s.streak.type ?? ""}${s.streak.value ?? ""}` : undefined,
    });
  }
  if (t.waiver_priority !== undefined) out.waiver_priority = num(t.waiver_priority);
  if (t.faab_balance !== undefined) out.faab_balance = num(t.faab_balance);
  return compact(out);
}

export function playerSummary(p: any) {
  const out: Record<string, any> = {
    player_key: p.player_key,
    name: p.name?.full,
    pos: p.display_position,
    nfl_team: p.editorial_team_abbr,
    bye: p.bye_weeks?.week,
    status: p.status_full ?? p.status,
    injury_note: p.injury_note,
  };
  if (p.selected_position) out.slot = merge(p.selected_position).position;
  if (p.player_points) out.points = num(p.player_points.total);
  if (p.player_projected_points) out.projected = num(p.player_projected_points.total);
  if (p.percent_owned) {
    const po = Array.isArray(p.percent_owned) ? merge(p.percent_owned) : p.percent_owned;
    out.pct_owned = num(po.value);
  }
  if (p.ownership) out.owner = p.ownership.owner_team_name ?? p.ownership.ownership_type;
  return compact(out);
}
