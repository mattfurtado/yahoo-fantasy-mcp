import type { AuthInfo } from "@modelcontextprotocol/server";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";
import { guidAllowed, SCOPE } from "@/lib/config";
import { Fantasy } from "@/lib/fantasy";
import { open } from "@/lib/seal";
import { YahooAuthError } from "@/lib/yahoo";

export const maxDuration = 60;

const league = z.string().optional().describe("League ID (e.g. 123456) or key (461.l.123456). Defaults to YAHOO_LEAGUE_ID.");
const week = z.number().int().min(1).max(18).optional().describe("NFL week; defaults to the current week");

type Ctx = { http?: { authInfo?: AuthInfo } };

function tool<T>(run: (f: Fantasy, args: T) => Promise<unknown>) {
  return async (args: T, ctx: Ctx) => {
    const access = open(ctx?.http?.authInfo?.token, "access");
    if (!access) {
      return { isError: true, content: [{ type: "text" as const, text: "Not authorized. Reconnect the connector." }] };
    }
    try {
      const result = await run(new Fantasy(access.ya), args);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (e) {
      const msg = e instanceof YahooAuthError
        ? "Yahoo rejected the token. Disconnect and reconnect this connector."
        : (e as Error).message;
      return { isError: true, content: [{ type: "text" as const, text: msg }] };
    }
  };
}

const readOnly = { readOnlyHint: true, openWorldHint: true };

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "list_my_leagues",
      {
        description: "List your Yahoo NFL fantasy leagues (current season by default).",
        inputSchema: z.object({ season: z.number().int().optional() }),
        annotations: readOnly,
      },
      tool((f, a: { season?: number }) => f.listMyLeagues(a.season)),
    );
    server.registerTool(
      "get_league_settings",
      {
        description: "Scoring rules, roster slots, playoffs, waivers/FAAB and trade deadline.",
        inputSchema: z.object({ league }),
        annotations: readOnly,
      },
      tool((f, a: { league?: string }) => f.settings(a.league)),
    );
    server.registerTool(
      "get_standings",
      {
        description: "Standings: rank, record, points for/against, streak, waiver priority, FAAB.",
        inputSchema: z.object({ league }),
        annotations: readOnly,
      },
      tool((f, a: { league?: string }) => f.standings(a.league)),
    );
    server.registerTool(
      "list_teams",
      {
        description: "All teams with team keys and managers; flags your team.",
        inputSchema: z.object({ league }),
        annotations: readOnly,
      },
      tool((f, a: { league?: string }) => f.teams(a.league)),
    );
    server.registerTool(
      "get_scoreboard",
      {
        description: "Matchups for a week with actual and projected points.",
        inputSchema: z.object({ week, league }),
        annotations: readOnly,
      },
      tool((f, a: { week?: number; league?: string }) => f.scoreboard(a.week, a.league)),
    );
    server.registerTool(
      "get_roster",
      {
        description: "A team's roster with lineup slots, injury status and weekly points. Omit team_key for your own team.",
        inputSchema: z.object({
          team_key: z.string().optional().describe("e.g. 461.l.123456.t.3"),
          week,
          league,
        }),
        annotations: readOnly,
      },
      tool((f, a: { team_key?: string; week?: number; league?: string }) => f.roster(a.team_key, a.week, a.league)),
    );
    server.registerTool(
      "get_free_agents",
      {
        description: "Best available players with % owned.",
        inputSchema: z.object({
          position: z.string().optional().describe("QB, RB, WR, TE, K, DEF, W/R/T, ..."),
          count: z.number().int().min(1).max(25).optional(),
          status: z.enum(["A", "FA", "W"]).optional().describe("A = all available, FA = free agents, W = waivers"),
          league,
        }),
        annotations: readOnly,
      },
      tool((f, a: { position?: string; count?: number; status?: string; league?: string }) =>
        f.freeAgents(a.position, a.count, a.status, a.league)),
    );
    server.registerTool(
      "search_players",
      {
        description: "Find players by name, including who owns them in your league.",
        inputSchema: z.object({ name: z.string(), league }),
        annotations: readOnly,
      },
      tool((f, a: { name: string; league?: string }) => f.searchPlayers(a.name, a.league)),
    );
    server.registerTool(
      "get_player_stats",
      {
        description: "Fantasy points and raw stats (keyed by stat ID; see get_league_settings.stat_ids) for up to 25 players, for a week or season to date.",
        inputSchema: z.object({ player_keys: z.array(z.string()).min(1).max(25), week, league }),
        annotations: readOnly,
      },
      tool((f, a: { player_keys: string[]; week?: number; league?: string }) =>
        f.playerStats(a.player_keys, a.week, a.league)),
    );
    server.registerTool(
      "get_transactions",
      {
        description: "Recent adds, drops and trades in the league.",
        inputSchema: z.object({ count: z.number().int().min(1).max(50).optional(), league }),
        annotations: readOnly,
      },
      tool((f, a: { count?: number; league?: string }) => f.transactions(a.count, a.league)),
    );
  },
  { serverInfo: { name: "yahoo-fantasy", version: "0.2.0" } },
);

const verifyToken = async (_req: Request, bearer?: string): Promise<AuthInfo | undefined> => {
  const access = open(bearer, "access");
  if (!access || !guidAllowed(access.guid)) return undefined;
  return { token: bearer!, clientId: access.cid, scopes: [SCOPE], expiresAt: access.exp };
};

const authHandler = withMcpAuth(handler, verifyToken, {
  required: true,
  resourceMetadataPath: "/.well-known/oauth-protected-resource/api/mcp",
});

export { authHandler as GET, authHandler as POST, authHandler as DELETE };
