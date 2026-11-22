# Yahoo Fantasy Football MCP server

A read-only remote MCP server for your Yahoo Fantasy Football leagues. You deploy it to Vercel and add it to Claude as a custom connector, and it works in any Claude chat, including on mobile.

## Tools

| Tool | What it returns |
|---|---|
| `list_my_leagues(season?)` | Your NFL leagues: key, name, current week, scoring type |
| `get_league_settings` | Scoring values, roster slots, waivers and FAAB, playoffs, trade deadline, stat ID names |
| `get_standings` | Rank, W-L-T, points for and against, streak, waiver priority, FAAB |
| `list_teams` | Team keys and managers, with your team flagged |
| `get_scoreboard(week?)` | Matchups with actual and projected points |
| `get_roster(team_key?, week?)` | Lineup slots, injury status, weekly points (defaults to your team) |
| `get_free_agents(position?, count?, status?)` | Best available players with % owned |
| `search_players(name)` | Players by name, plus who owns them |
| `get_player_stats(player_keys, week?)` | Fantasy points and raw stats, for a week or the season |
| `get_transactions(count?)` | Recent adds, drops and trades |

Every tool takes an optional `league`. If you set `YAHOO_LEAGUE_ID`, you can leave it out.

## How auth works

The server is its own OAuth 2.1 authorization server and passes your login through to Yahoo.

1. When you add the connector, Claude registers itself through dynamic client registration and sends you to `/oauth/authorize`.
2. The server redirects you to Yahoo's login. Yahoo sends you back to `/oauth/callback`.
3. The server exchanges Yahoo's code for your Yahoo tokens, wraps them in its own authorization code, and Claude exchanges that code (with PKCE) at `/oauth/token`.
4. Claude's access token contains your Yahoo access token. Claude's refresh token contains your Yahoo refresh token, and refreshing it refreshes with Yahoo.

Every token, client ID and OAuth state value is AES-256-GCM encrypted with `TOKEN_SECRET`, so the server doesn't need a database. Changing `TOKEN_SECRET` invalidates every issued token, which acts as a kill switch. If you set `ALLOWED_YAHOO_GUIDS`, only your Yahoo account can connect, even though the URL is public.

## Deploy

**1. Yahoo app.** In your app at https://developer.yahoo.com/apps/, add this redirect URI:
```
https://<your-project>.vercel.app/oauth/callback
```
Use a Confidential Client with the **Fantasy Sports - Read** permission.

**2. Vercel project.** Import this repo, then set these environment variables (see `.env.example`):

| Variable | |
|---|---|
| `YAHOO_CLIENT_ID`, `YAHOO_CLIENT_SECRET` | From the Yahoo app |
| `TOKEN_SECRET` | `openssl rand -base64 48` |
| `YAHOO_LEAGUE_ID` | Optional: your default league |
| `PUBLIC_URL` | Optional: only needed if you use a custom domain |
| `ALLOWED_YAHOO_GUIDS` | Recommended: set this after your first login (step 5) |

**3. Deployment Protection.** Under Settings → Deployment Protection, make sure Vercel Authentication covers **only preview deployments**. If it covers your production `.vercel.app` URL, Claude gets Vercel's login page instead of your server.

**4. Add to Claude.** Go to Settings → Connectors → Add custom connector, and enter:
```
https://<your-project>.vercel.app/api/mcp
```
Then log in to Yahoo when prompted.

**5. Lock it to your account.** In Vercel, open the function logs and find the `Yahoo login: guid=...` line. Set `ALLOWED_YAHOO_GUIDS` to that value and redeploy.

## Develop

```bash
npm install
npm test           # OAuth flow + tool parsing, with Yahoo mocked
npm run typecheck
npm run dev        # http://localhost:3000/api/mcp
```

The original local stdio server (Python) is in [`python/`](python/).
