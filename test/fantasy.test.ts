// Tool parsing against mocked responses shaped like Yahoo's JSON.
import { strict as assert } from "node:assert";
import { before, test } from "node:test";
import { Fantasy } from "../lib/fantasy.ts";

process.env.YAHOO_LEAGUE_ID = "12345";

const meta = { league_key: "461.l.12345", name: "L", num_teams: 2, current_week: 12 };
const team = (i: number, mine = false) => [
  [{ team_key: `461.l.12345.t.${i}` }, { name: `Team ${i}` }, mine ? { is_owned_by_current_login: 1 } : [],
    { managers: [{ manager: { nickname: `Mgr${i}` } }] }],
  { team_points: { total: "101.5" } }, { team_projected_points: { total: "98.2" } },
  { team_standings: { rank: String(i), outcome_totals: { wins: "7", losses: "4", ties: 0 },
    points_for: "1200.4", points_against: "1100", streak: { type: "win", value: "2" } } },
];
const player = (k: string, slot = "WR") => [
  [{ player_key: k }, { name: { full: "Joe " + k } }, { display_position: "WR" }, { editorial_team_abbr: "KC" },
    { bye_weeks: { week: "10" } }, { status: "Q" }],
  { selected_position: [{ coverage_type: "week" }, { position: slot }] },
  { percent_owned: [{ coverage_type: "week" }, { value: "55" }] },
  { player_points: { coverage_type: "week", total: "12.3" } },
  { player_stats: { stats: [{ stat: { stat_id: "4", value: "80" } }] } },
];
const players = { "0": { player: player("p1") }, "1": { player: player("p2", "BN") }, count: 2 };

function route(path: string): any {
  if (path === "game/nfl") return { game: [{ game_key: "461" }] };
  if (path.endsWith("/teams")) return { league: [meta, { teams: { "0": { team: team(1, true) }, "1": { team: team(2) }, count: 2 } }] };
  if (path.endsWith("/standings")) return { league: [meta, { standings: [{ teams: { "0": { team: team(2) }, "1": { team: team(1, true) }, count: 2 } }] }] };
  if (path.includes("scoreboard")) return { league: [meta, { scoreboard: { "0": { matchups: { "0": { matchup: { "0": { teams: { "0": { team: team(1) }, "1": { team: team(2) }, count: 2 } }, week: "12", status: "midevent" } }, count: 1 } }, week: "12" } }] };
  if (path === "league/461.l.12345") return { league: [meta] };
  if (path.includes("/roster")) return { team: [[{ team_key: "461.l.12345.t.1" }, { name: "Team 1" }], { roster: { "0": { players }, week: 12 } }] };
  if (path.includes("/settings")) return { league: [meta, { settings: [{
    roster_positions: [{ roster_position: { position: "QB", count: 1 } }],
    stat_categories: { stats: [{ stat: { stat_id: 4, display_name: "Pass Yds" } }] },
    stat_modifiers: { stats: [{ stat: { stat_id: 4, value: "0.04" } }] },
    uses_faab: "1" }] }] };
  if (path.includes("players")) return { league: [meta, { players }] };
  if (path.startsWith("users")) return { users: { "0": { user: [[{ guid: "x" }], { games: { "0": { game: [{ game_key: "461" }, { leagues: { "0": { league: [meta] }, count: 1 } }] }, count: 1 } }] }, count: 1 } };
  if (path.includes("transactions")) return { league: [meta, { transactions: { "0": { transaction: [{ type: "add/drop", status: "successful", timestamp: "1700000000" }, { players: { "0": { player: [[{ player_key: "p1" }, { name: { full: "A" } }, { display_position: "RB" }], { transaction_data: [{ type: "add", source_type: "freeagents", destination_team_name: "Team 1" }] }] }, count: 1 } }] }, count: 1 } }] };
  throw new Error("unmocked " + path);
}

before(() => {
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    assert.equal(u.searchParams.get("format"), "json");
    assert.equal((init?.headers as any).authorization, "Bearer tok");
    const path = decodeURIComponent(u.pathname.replace("/fantasy/v2/", ""));
    return Response.json({ fantasy_content: route(path) });
  }) as typeof fetch;
});

const f = new Fantasy("tok");

test("leagues", async () => assert.equal((await f.listMyLeagues())[0].league_key, "461.l.12345"));
test("standings sorted, my team flagged", async () => {
  const s = await f.standings();
  assert.deepEqual(s.map((t) => t.rank), [1, 2]);
  assert.equal(s[0].is_my_team, true);
  assert.equal(s[0].streak, "win2");
});
test("scoreboard", async () => {
  const sb = await f.scoreboard();
  assert.equal(sb.week, 12);
  assert.equal(sb.matchups[0].teams.length, 2);
});
test("roster resolves my team and current week", async () => {
  const r = await f.roster();
  assert.equal(r.team_key, "461.l.12345.t.1");
  assert.equal(r.week, 12);
  assert.equal(r.players[1].slot, "BN");
  assert.equal(r.players[0].points, 12.3);
});
test("settings maps stat names", async () => {
  const s = await f.settings();
  assert.deepEqual(s.scoring, { "Pass Yds": 0.04 });
  assert.deepEqual(s.roster_positions, ["QB x1"]);
});
test("free agents + search + stats", async () => {
  assert.equal((await f.freeAgents("WR"))[0].pct_owned, 55);
  assert.equal((await f.searchPlayers("Joe Burrow")).length, 2);
  assert.deepEqual((await f.playerStats(["p1"], 12))[0].raw_stats, { "4": 80 });
});
test("transactions", async () => {
  const tx = await f.transactions();
  assert.deepEqual(tx[0].moves[0], { player: "A", pos: "RB", action: "add", from: "freeagents", to: "Team 1" });
});
