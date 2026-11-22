// Read-only Yahoo Fantasy Football queries, returning compact JSON for the model.
import { items, merge, num, numbered, playerSummary, teamSummary, yget } from "./yahoo";

let nflGameKey: string | undefined; // per-instance cache; changes once a season

export class Fantasy {
  constructor(private token: string) {}

  private get = (path: string) => yget(path, this.token);

  async leagueKey(league?: string): Promise<string> {
    league = league || process.env.YAHOO_LEAGUE_ID;
    if (!league) throw new Error("No league given and YAHOO_LEAGUE_ID isn't set. Call list_my_leagues first.");
    if (league.includes(".l.")) return league;
    if (!nflGameKey) nflGameKey = String(merge((await this.get("game/nfl")).game).game_key);
    return `${nflGameKey}.l.${league}`;
  }

  private async league(path: string) {
    return merge((await this.get(path)).league);
  }

  async listMyLeagues(season?: number) {
    const sel = season ? `game_codes=nfl;seasons=${season}` : "game_keys=nfl";
    const fc = await this.get(`users;use_login=1/games;${sel}/leagues`);
    const user = items(fc.users, "user")[0] ?? {};
    return items(user.games, "game").flatMap((g) =>
      items(g.leagues, "league").map((lg) => ({
        league_key: lg.league_key,
        league_id: lg.league_id,
        name: lg.name,
        season: lg.season,
        num_teams: lg.num_teams,
        current_week: lg.current_week,
        scoring_type: lg.scoring_type,
      })),
    );
  }

  async settings(league?: string) {
    const lk = await this.leagueKey(league);
    const lg = await this.league(`league/${lk}/settings`);
    const s = merge(lg.settings) ?? {};
    const cats: Record<string, string> = {};
    for (const c of s.stat_categories?.stats ?? []) {
      cats[String(c.stat.stat_id)] = c.stat.display_name ?? c.stat.name;
    }
    const scoring: Record<string, any> = {};
    for (const m of s.stat_modifiers?.stats ?? []) {
      scoring[cats[String(m.stat.stat_id)] ?? m.stat.stat_id] = num(m.stat.value);
    }
    const keep = ["draft_type", "uses_faab", "waiver_type", "waiver_rule", "trade_end_date",
      "playoff_start_week", "num_playoff_teams", "uses_playoff", "max_teams"];
    return {
      name: lg.name,
      league_key: lk,
      num_teams: lg.num_teams,
      current_week: lg.current_week,
      scoring_type: lg.scoring_type,
      roster_positions: (s.roster_positions ?? []).map(
        (r: any) => `${r.roster_position.position} x${r.roster_position.count ?? 1}`,
      ),
      scoring,
      stat_ids: cats,
      ...Object.fromEntries(keep.filter((k) => k in s).map((k) => [k, s[k]])),
    };
  }

  async standings(league?: string) {
    const lk = await this.leagueKey(league);
    const lg = await this.league(`league/${lk}/standings`);
    return items(merge(lg.standings)?.teams, "team")
      .map(teamSummary)
      .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  }

  async teams(league?: string) {
    const lk = await this.leagueKey(league);
    const lg = await this.league(`league/${lk}/teams`);
    return items(lg.teams, "team").map(teamSummary);
  }

  async scoreboard(week?: number, league?: string) {
    const lk = await this.leagueKey(league);
    const lg = await this.league(`league/${lk}/scoreboard${week ? `;week=${week}` : ""}`);
    const sb = lg.scoreboard ?? {};
    const matchups = items(numbered(sb).matchups, "matchup").map((m) => ({
      status: m.status,
      is_playoffs: m.is_playoffs === "1",
      winner_team_key: m.winner_team_key,
      teams: items(numbered(m).teams, "team").map(teamSummary),
    }));
    return { week: num(sb.week ?? week), matchups };
  }

  async currentWeek(lk: string): Promise<number> {
    return Number((await this.league(`league/${lk}`)).current_week);
  }

  async roster(teamKey?: string, week?: number, league?: string) {
    const lk = await this.leagueKey(league);
    if (!teamKey) {
      const mine = (await this.teams(lk)).find((t) => t.is_my_team);
      if (!mine) throw new Error("Couldn't find your team in this league; pass team_key.");
      teamKey = mine.team_key as string;
    }
    week ??= await this.currentWeek(lk);
    const t = merge((await this.get(`team/${teamKey}/roster;week=${week}`)).team);
    const players = items(numbered(t.roster ?? {}).players, "player").map(playerSummary);
    if (players.length) {
      const stats = await this.playerStats(players.map((p) => p.player_key), week, lk);
      const pts = new Map(stats.map((s) => [s.player_key, s.points]));
      for (const p of players) p.points = pts.get(p.player_key);
    }
    return { team: t.name, team_key: teamKey, week, players };
  }

  async freeAgents(position?: string, count = 25, status = "A", league?: string) {
    const lk = await this.leagueKey(league);
    let f = `;status=${status};sort=AR;count=${Math.min(count, 25)}`;
    if (position) f += `;position=${encodeURIComponent(position)}`;
    const lg = await this.league(`league/${lk}/players${f}/percent_owned`);
    return items(lg.players, "player").map(playerSummary);
  }

  async searchPlayers(name: string, league?: string) {
    const lk = await this.leagueKey(league);
    const lg = await this.league(`league/${lk}/players;search=${encodeURIComponent(name)}/ownership`);
    return items(lg.players, "player").map(playerSummary);
  }

  async playerStats(playerKeys: string[], week?: number, league?: string) {
    const lk = await this.leagueKey(league);
    const typ = week ? `;type=week;week=${week}` : ";type=season";
    const lg = await this.league(
      `league/${lk}/players;player_keys=${playerKeys.slice(0, 25).join(",")}/stats${typ}`,
    );
    return items(lg.players, "player").map((p) => {
      const s: Record<string, any> = playerSummary(p);
      s.raw_stats = Object.fromEntries(
        (p.player_stats?.stats ?? []).map((x: any) => [String(x.stat.stat_id), num(x.stat.value)]),
      );
      return s;
    });
  }

  async transactions(count = 20, league?: string) {
    const lk = await this.leagueKey(league);
    const lg = await this.league(`league/${lk}/transactions;count=${count}`);
    return items(lg.transactions, "transaction").map((tx) => ({
      type: tx.type,
      status: tx.status,
      timestamp: num(tx.timestamp),
      faab_bid: tx.faab_bid ? num(tx.faab_bid) : undefined,
      moves: items(tx.players, "player").map((p) => {
        const td = Array.isArray(p.transaction_data) ? merge(p.transaction_data) : (p.transaction_data ?? {});
        return {
          player: p.name?.full,
          pos: p.display_position,
          action: td.type,
          from: td.source_team_name ?? td.source_type,
          to: td.destination_team_name ?? td.destination_type,
        };
      }),
    }));
  }
}
