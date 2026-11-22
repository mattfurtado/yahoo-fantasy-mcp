"""Yahoo Fantasy Football MCP server (read-only)."""

from __future__ import annotations

import os
from typing import Any

try:  # MCP Python SDK v2
    from mcp.server.mcpserver import MCPServer as FastMCP
except ImportError:  # SDK v1
    from mcp.server.fastmcp import FastMCP

from yahoo_client import YahooClient, items, merge, numbered

mcp = FastMCP("yahoo-fantasy")
yc = YahooClient()

DEFAULT_LEAGUE = os.environ.get("YAHOO_LEAGUE_ID")  # e.g. "123456" or "461.l.123456"
_game_key_cache: str | None = None


# ---------- helpers ----------

async def _nfl_game_key() -> str:
    global _game_key_cache
    if _game_key_cache is None:
        fc = await yc.get("game/nfl")
        _game_key_cache = str(merge(fc["game"])["game_key"])
    return _game_key_cache


async def _league_key(league: str | None) -> str:
    league = league or DEFAULT_LEAGUE
    if not league:
        raise ValueError("No league given and YAHOO_LEAGUE_ID not set. Call list_my_leagues first.")
    if ".l." in league:
        return league
    return f"{await _nfl_game_key()}.l.{league}"


def _num(v: Any) -> Any:
    try:
        f = float(v)
        return int(f) if f.is_integer() else round(f, 2)
    except (TypeError, ValueError):
        return v


def _team_summary(t: dict) -> dict:
    out = {
        "team_key": t.get("team_key"),
        "name": t.get("name"),
        "manager": (items(t.get("managers"), "manager") or [{}])[0].get("nickname"),
        "is_my_team": bool(t.get("is_owned_by_current_login")),
    }
    if "team_points" in t:
        out["points"] = _num(t["team_points"].get("total"))
    if "team_projected_points" in t:
        out["projected"] = _num(t["team_projected_points"].get("total"))
    if "team_standings" in t:
        s = t["team_standings"]
        ot = s.get("outcome_totals", {})
        out.update(
            rank=_num(s.get("rank")),
            wins=_num(ot.get("wins")),
            losses=_num(ot.get("losses")),
            ties=_num(ot.get("ties")),
            points_for=_num(s.get("points_for")),
            points_against=_num(s.get("points_against")),
            streak=f"{s.get('streak', {}).get('type', '')}{s.get('streak', {}).get('value', '')}" or None,
        )
    if "waiver_priority" in t:
        out["waiver_priority"] = _num(t["waiver_priority"])
    if "faab_balance" in t:
        out["faab_balance"] = _num(t["faab_balance"])
    return {k: v for k, v in out.items() if v not in (None, "")}


def _player_summary(p: dict) -> dict:
    out = {
        "player_key": p.get("player_key"),
        "name": (p.get("name") or {}).get("full"),
        "pos": p.get("display_position"),
        "nfl_team": p.get("editorial_team_abbr"),
        "bye": (p.get("bye_weeks") or {}).get("week"),
        "status": p.get("status_full") or p.get("status"),
        "injury_note": p.get("injury_note"),
    }
    if "selected_position" in p:
        out["slot"] = merge(p["selected_position"]).get("position")
    if "player_points" in p:
        out["points"] = _num(p["player_points"].get("total"))
    if "player_projected_points" in p:
        out["projected"] = _num(p["player_projected_points"].get("total"))
    if "percent_owned" in p:
        po = merge(p["percent_owned"]) if isinstance(p["percent_owned"], list) else p["percent_owned"]
        out["pct_owned"] = _num(po.get("value"))
    if "ownership" in p:
        o = p["ownership"]
        out["owner"] = o.get("owner_team_name") or o.get("ownership_type")
    return {k: v for k, v in out.items() if v not in (None, "")}


# ---------- tools ----------

@mcp.tool()
async def list_my_leagues(season: int | None = None) -> list[dict]:
    """List the logged-in user's Yahoo NFL fantasy leagues (current season by default)."""
    sel = f"game_codes=nfl;seasons={season}" if season else "game_keys=nfl"
    fc = await yc.get(f"users;use_login=1/games;{sel}/leagues")
    user = items(fc["users"], "user")[0]
    out = []
    for g in items(user.get("games"), "game"):
        for lg in items(g.get("leagues"), "league"):
            out.append({
                "league_key": lg.get("league_key"),
                "league_id": lg.get("league_id"),
                "name": lg.get("name"),
                "season": lg.get("season"),
                "num_teams": lg.get("num_teams"),
                "current_week": lg.get("current_week"),
                "scoring_type": lg.get("scoring_type"),
            })
    return out


@mcp.tool()
async def get_league_settings(league: str | None = None) -> dict:
    """Scoring rules, roster slots, playoffs, waivers and trade deadline for a league."""
    lk = await _league_key(league)
    lg = merge((await yc.get(f"league/{lk}/settings"))["league"])
    s = merge(lg.get("settings"))
    cats = {
        str(c["stat"]["stat_id"]): c["stat"].get("display_name") or c["stat"].get("name")
        for c in (s.get("stat_categories") or {}).get("stats", [])
    }
    mods = {
        cats.get(str(m["stat"]["stat_id"]), m["stat"]["stat_id"]): _num(m["stat"]["value"])
        for m in (s.get("stat_modifiers") or {}).get("stats", [])
    }
    roster = [
        f"{r['roster_position']['position']} x{r['roster_position'].get('count', 1)}"
        for r in s.get("roster_positions", [])
    ]
    keep = ["draft_type", "uses_faab", "waiver_type", "waiver_rule", "trade_end_date",
            "playoff_start_week", "num_playoff_teams", "uses_playoff", "max_teams"]
    return {
        "name": lg.get("name"),
        "league_key": lk,
        "num_teams": lg.get("num_teams"),
        "current_week": lg.get("current_week"),
        "scoring_type": lg.get("scoring_type"),
        "roster_positions": roster,
        "scoring": mods,
        **{k: s[k] for k in keep if k in s},
    }


@mcp.tool()
async def get_standings(league: str | None = None) -> list[dict]:
    """League standings: rank, record, points for/against, streak, waiver priority."""
    lk = await _league_key(league)
    lg = merge((await yc.get(f"league/{lk}/standings"))["league"])
    teams = [_team_summary(t) for t in items(merge(lg.get("standings")).get("teams"), "team")]
    return sorted(teams, key=lambda t: t.get("rank") or 99)


@mcp.tool()
async def get_scoreboard(week: int | None = None, league: str | None = None) -> dict:
    """Matchups for a week (current week by default) with actual and projected points."""
    lk = await _league_key(league)
    path = f"league/{lk}/scoreboard" + (f";week={week}" if week else "")
    lg = merge((await yc.get(path))["league"])
    sb = lg.get("scoreboard", {})
    matchups = []
    for m in items(numbered(sb).get("matchups"), "matchup"):
        teams = items(numbered(m).get("teams"), "team")
        matchups.append({
            "status": m.get("status"),
            "is_playoffs": m.get("is_playoffs") == "1",
            "winner_team_key": m.get("winner_team_key"),
            "teams": [_team_summary(t) for t in teams],
        })
    return {"week": _num(sb.get("week") or week), "matchups": matchups}


@mcp.tool()
async def get_roster(team_key: str | None = None, week: int | None = None,
                     league: str | None = None) -> dict:
    """A team's roster with lineup slots, injury status, and points for the week.
    Omit team_key for your own team. Team keys look like '461.l.123456.t.3'."""
    lk = await _league_key(league)
    if not team_key:
        teams = await list_teams(league=lk)
        mine = [t for t in teams if t.get("is_my_team")]
        if not mine:
            raise ValueError("Couldn't find your team in this league; pass team_key.")
        team_key = mine[0]["team_key"]
    if not week:
        week = int(merge((await yc.get(f"league/{lk}"))["league"])["current_week"])
    t = merge((await yc.get(f"team/{team_key}/roster;week={week}"))["team"])
    roster = numbered(t.get("roster", {}))
    players = [_player_summary(p) for p in items(roster.get("players"), "player")]
    if players:
        stats = await get_player_stats([p["player_key"] for p in players], week=week, league=lk)
        pts = {s["player_key"]: s.get("points") for s in stats}
        for p in players:
            p["points"] = pts.get(p["player_key"])
    return {"team": t.get("name"), "team_key": team_key, "week": week, "players": players}


@mcp.tool()
async def list_teams(league: str | None = None) -> list[dict]:
    """All teams in the league with team keys and managers (marks your team)."""
    lk = await _league_key(league)
    lg = merge((await yc.get(f"league/{lk}/teams"))["league"])
    return [_team_summary(t) for t in items(lg.get("teams"), "team")]


@mcp.tool()
async def get_free_agents(position: str | None = None, count: int = 25,
                          status: str = "A", league: str | None = None) -> list[dict]:
    """Available players, best first. position: QB, RB, WR, TE, K, DEF, W/R/T, etc.
    status: 'A' all available, 'FA' free agents only, 'W' on waivers."""
    lk = await _league_key(league)
    filt = f";status={status};sort=AR;count={min(count, 25)}"
    if position:
        filt += f";position={position}"
    lg = merge((await yc.get(f"league/{lk}/players{filt}/percent_owned"))["league"])
    return [_player_summary(p) for p in items(lg.get("players"), "player")]


@mcp.tool()
async def search_players(name: str, league: str | None = None) -> list[dict]:
    """Find players by name, including who owns them in your league."""
    lk = await _league_key(league)
    lg = merge((await yc.get(f"league/{lk}/players;search={name}/ownership"))["league"])
    return [_player_summary(p) for p in items(lg.get("players"), "player")]


@mcp.tool()
async def get_player_stats(player_keys: list[str], week: int | None = None,
                           league: str | None = None) -> list[dict]:
    """Fantasy points and raw stats for players, for a week or the season to date."""
    lk = await _league_key(league)
    keys = ",".join(player_keys[:25])
    typ = f";type=week;week={week}" if week else ";type=season"
    lg = merge((await yc.get(f"league/{lk}/players;player_keys={keys}/stats{typ}"))["league"])
    out = []
    for p in items(lg.get("players"), "player"):
        s = _player_summary(p)
        stats = (p.get("player_stats") or {}).get("stats", [])
        s["raw_stats"] = {str(x["stat"]["stat_id"]): _num(x["stat"]["value"]) for x in stats}
        out.append(s)
    return out


@mcp.tool()
async def get_transactions(count: int = 20, league: str | None = None) -> list[dict]:
    """Recent adds, drops and trades in the league."""
    lk = await _league_key(league)
    lg = merge((await yc.get(f"league/{lk}/transactions;count={count}"))["league"])
    out = []
    for tx in items(lg.get("transactions"), "transaction"):
        moves = []
        for p in items(tx.get("players"), "player"):
            td = merge(p.get("transaction_data")) if isinstance(p.get("transaction_data"), list) \
                else (p.get("transaction_data") or {})
            moves.append({
                "player": (p.get("name") or {}).get("full"),
                "pos": p.get("display_position"),
                "action": td.get("type"),
                "from": td.get("source_team_name") or td.get("source_type"),
                "to": td.get("destination_team_name") or td.get("destination_type"),
            })
        out.append({
            "type": tx.get("type"),
            "status": tx.get("status"),
            "timestamp": _num(tx.get("timestamp")),
            "faab_bid": _num(tx.get("faab_bid")) if tx.get("faab_bid") else None,
            "moves": moves,
        })
    return out


if __name__ == "__main__":
    mcp.run()
