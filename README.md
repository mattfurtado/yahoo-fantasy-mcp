# Yahoo Fantasy Football MCP server

Read-only MCP server that lets Claude read your Yahoo Fantasy Football leagues.

## Tools

| Tool | What it returns |
|---|---|
| `list_my_leagues(season?)` | Your NFL leagues (key, name, week, scoring type) |
| `get_league_settings` | Scoring modifiers, roster slots, waivers/FAAB, playoffs, trade deadline |
| `get_standings` | Rank, W-L-T, PF/PA, streak, waiver priority, FAAB |
| `list_teams` | Team keys + managers, flags your team |
| `get_scoreboard(week?)` | Matchups with actual and projected points |
| `get_roster(team_key?, week?)` | Lineup slots, injury status, weekly points (defaults to your team) |
| `get_free_agents(position?, count?, status?)` | Best available players with % owned |
| `search_players(name)` | Players by name and who owns them |
| `get_player_stats(player_keys, week?)` | Fantasy points + raw stats, weekly or season |
| `get_transactions(count?)` | Recent adds/drops/trades |

Every tool takes an optional `league` (an ID like `123456` or a key like `461.l.123456`). If you set `YAHOO_LEAGUE_ID`, you can leave it out.

## Setup

**1. Create a Yahoo app** at https://developer.yahoo.com/apps/create/
- Application type: **Installed Application**
- Redirect URI: `oob`. If Yahoo rejects that, use `https://localhost:8080` and set `YAHOO_REDIRECT_URI` to match.
- API permissions: **Fantasy Sports → Read**
- Copy the Client ID and Client Secret.

**2. Install**
```bash
cd yahoo-fantasy-mcp
uv sync            # or: python -m venv .venv && .venv/bin/pip install "mcp[cli]" httpx
```

**3. Authorize once**
```bash
export YAHOO_CLIENT_ID=...  YAHOO_CLIENT_SECRET=...
uv run auth.py
```
Approve in the browser, then paste the code. If you used the localhost redirect, paste the full URL from the address bar; it's fine if the page doesn't load. This saves a refresh token to `~/.yahoo-fantasy-mcp/token.json` with permissions `0600`. The server refreshes it automatically after that.

**4. Add to Claude Desktop** (`claude_desktop_config.json`)
```json
{
  "mcpServers": {
    "yahoo-fantasy": {
      "command": "uv",
      "args": ["--directory", "/ABSOLUTE/PATH/yahoo-fantasy-mcp", "run", "server.py"],
      "env": {
        "YAHOO_CLIENT_ID": "...",
        "YAHOO_CLIENT_SECRET": "...",
        "YAHOO_LEAGUE_ID": "123456"
      }
    }
  }
}
```
Restart Claude Desktop. If you use Claude Code, run `claude mcp add yahoo-fantasy -e YAHOO_CLIENT_ID=... -e YAHOO_CLIENT_SECRET=... -- uv --directory /path run server.py` instead.

Your league ID is the number in `football.fantasysports.yahoo.com/f1/<ID>`.

## Notes
- Works with MCP Python SDK v1 (`FastMCP`) and v2 (`MCPServer`).
- `get_player_stats` returns `raw_stats` keyed by Yahoo stat ID. `get_league_settings` maps those IDs to names and point values.
- Yahoo pages player lists 25 at a time.
- Possible next step: write tools such as lineup changes and add/drop, which use the `fspt-w` scope and PUT/POST XML.
