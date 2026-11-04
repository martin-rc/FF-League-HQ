#!/usr/bin/env python3
"""Fetch what the trade simulator needs that the other tools don't keep.
Usage: python3 -I trade_fetch.py <data_dir> <league_id>
Talks only to api.sleeper.app and sends only the league ID. Saves:
  <season>/rosters.json, users.json, league.json (fresh), transactions for this week,
  <season>/future/matchups_WW.json for every week left (who plays whom),
  <season>/projections/week_WW.json for this week through the last playoff week."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from matchup_helper import get, save, proj_path


def main(data, lid):
    state = get("/v1/state/nfl"); save(state, data, "state.json")
    week = state["week"]
    lg = get(f"/v1/league/{lid}"); season = lg["season"]; d = os.path.join(data, season)
    save(lg, d, "league.json")
    for n in ("rosters", "users"): save(get(f"/v1/league/{lid}/{n}"), d, f"{n}.json")
    save(get(f"/v1/league/{lid}/transactions/{week}"), d, f"transactions_{week:02d}.json")
    po = lg["settings"].get("playoff_week_start") or 15
    for w in range(week, po):
        save(get(f"/v1/league/{lid}/matchups/{w}"), d, "future", f"matchups_{w:02d}.json")
    for w in range(week, po + 3):
        save(get(proj_path(season, w)), d, "projections", f"week_{w:02d}.json")
    print(f"fetched season {season}, weeks {week}-{po + 2}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
