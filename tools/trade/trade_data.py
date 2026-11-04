#!/usr/bin/env python3
"""Data for the League HQ trade simulator.
Usage: python3 -I trade_data.py <data_dir> <league_hq index.html> <out.json>

Offline. Reads data/<season>/ (league, rosters, users, matchups_*, future/matchups_*, stats/week_*,
projections/week_*, schedule) and players_nfl.json, plus the Playoff race model settings stored in the
League HQ page (blend weight, shrink weeks, weekly spread), so the trade odds use the same model.

Per player:
  value     the League HQ value: 65% points a game this season + 35% last 3 games, marked down with 1-2 games.
  E[w]      expected points in week w (this week through the last playoff week):
            0 on a bye or when Sleeper's projection says he won't play (injury timelines live there),
            otherwise a blend of value and Sleeper's projection for that week, rescored with this league's
            scoring. The more games he has played (up to 4), the more weight on value (up to 50%).
  sd        his week-to-week swing, shrunk toward his position's typical swing.
Per position: how often a fantasy-relevant player who played last week misses this week, and how often
a player who missed comes back, from this season's weeks.
Per NFL defense: fantasy points allowed a game to each position (for the playoff-schedule check).
Managers appear by Sleeper display name and team name only."""
import json, math, os, re, statistics as st, sys
from collections import defaultdict
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from scoring import make_fp
from analyze import best_lineup, SLOT_OK

OUT_STATUS = {"Out", "IR", "PUP", "Sus", "Suspended", "NA", "DNR", "Doubtful"}
POS6 = ("QB", "RB", "WR", "TE", "K", "DEF")


def J(*p):
    try: return json.load(open(os.path.join(*p)))
    except FileNotFoundError: return None


def r1(x): return round(float(x) + 0.0, 1)


def hq_model(index_html):
    s = open(index_html).read()
    i = s.index("const RAW = ") + len("const RAW = "); j = s.index("\n", i)
    raw = json.loads(s[i:j].rstrip().rstrip(";"))
    lines = raw["odds"].strip().split("\n"); hdr = lines[0].split(",")
    row = dict(zip(hdr, lines[1].split(",")))
    return float(row["weight_scoring"]), float(row["shrink_weeks"]), float(row["spread"])


def main(data, index_html, out):
    A, C, SD = hq_model(index_html)
    players = J(data, "players_nfl.json") or {}
    season = sorted(x for x in os.listdir(data) if os.path.isfile(os.path.join(data, x, "league.json")))[-1]
    D = os.path.join(data, season)
    lg = J(D, "league.json"); cfg = lg["settings"]; fp = make_fp(lg["scoring_settings"])
    slots = [p for p in lg["roster_positions"] if p in SLOT_OK]
    n_bench = lg["roster_positions"].count("BN")
    po = cfg.get("playoff_week_start") or 15; nplay = cfg.get("playoff_teams") or 8
    last = cfg.get("last_scored_leg") or 0; week = last + 1
    weeks_left = list(range(week, po + 3))
    users = {u["user_id"]: u for u in J(D, "users.json")}
    rosters = J(D, "rosters.json")
    mgr = {r["roster_id"]: users[r["owner_id"]]["display_name"] for r in rosters}
    team = {r["roster_id"]: (users[r["owner_id"]].get("metadata") or {}).get("team_name") or mgr[r["roster_id"]] for r in rosters}
    rids = sorted(mgr)

    # ---- games so far, games left ----
    def pairs(m):
        by = defaultdict(list)
        for x in m or []: by[x["matchup_id"]].append(x)
        return [v for v in by.values() if len(v) == 2]
    pts = defaultdict(list); rec = {r: [0, 0, 0, 0.0] for r in rids}
    for w in range(1, last + 1):
        for a, b in pairs(J(D, f"matchups_{w:02d}.json")):
            for x, y in ((a, b), (b, a)):
                pts[x["roster_id"]].append(x["points"]); rec[x["roster_id"]][3] += x["points"]
                rec[x["roster_id"]][0 if x["points"] > y["points"] else 1 if x["points"] < y["points"] else 2] += 1
    left = []
    for w in range(week, po):
        m = J(D, "future", f"matchups_{w:02d}.json") or J(D, f"matchups_{w:02d}.json")
        assert m, f"no matchups for week {w}: run trade_fetch.py"
        left += [[w, a["roster_id"], b["roster_id"]] for a, b in pairs(m)]

    # ---- player game logs ----
    stats = {w: J(D, "stats", f"week_{w:02d}.json") or {} for w in range(1, last + 1)}
    gpts = defaultdict(dict)
    for w, sw in stats.items():
        for pid, sl in sw.items():
            if (sl or {}).get("gp") or (not pid.isdigit() and sl): gpts[pid][w] = fp(sl)

    def pinfo(pid):
        p = players.get(pid) or {}
        if not pid.isdigit(): return f"{p.get('first_name') or pid} {p.get('last_name') or 'D/ST'}".strip(), "DEF", pid, "", None
        name = p.get("full_name") or f'{p.get("first_name", "")} {p.get("last_name", "")}'.strip() or "Unknown"
        return name, p.get("position") or "?", p.get("team") or "FA", p.get("injury_status") or "", p.get("age")

    def value(pid):                                       # identical to League HQ (outlook.py)
        g = [v for _, v in sorted(gpts.get(pid, {}).items())]
        if not g: return 0.0, 0, 0.0, 0.0
        season_, rec_ = sum(g) / len(g), sum(g[-3:]) / len(g[-3:])
        val = 0.65 * season_ + 0.35 * rec_
        if len(g) < 3: val *= (0.8 + 0.1 * (len(g) - 1))
        return val, len(g), season_, rec_

    # ---- NFL schedule: byes and opponents ----
    sched = J(D, "schedule.json") or []
    opp = defaultdict(dict)                               # team -> week -> "@BAL" / "BAL"
    for g in sched:
        opp[g["home"]][g["week"]] = g["away"]; opp[g["away"]][g["week"]] = "@" + g["home"]
    nfl_teams = sorted(opp)

    # ---- projections, rescored ----
    proj = {}
    for w in weeks_left:
        proj[w] = {x["player_id"]: fp(x.get("stats") or {}) for x in J(D, "projections", f"week_{w:02d}.json") or []}

    # ---- who is in play: every rostered player + the best free agents ----
    owner = {}; ir = set()
    for r in rosters:
        for pid in r["players"] or []: owner[pid] = r["roster_id"]
        for pid in r.get("reserve") or []: ir.add(pid)

    def expected(pid):
        name, pos, nfl, inj, _ = pinfo(pid); val, g, _, _ = value(pid)
        wv = 0.5 * min(g, 4) / 4
        has_proj = any(pid in proj[w] for w in weeks_left)
        E = []
        for w in weeks_left:
            bye = nfl in opp and w not in opp[nfl]
            if bye or nfl == "FA": E.append(0.0); continue
            if has_proj:
                pr = proj[w].get(pid, 0.0)
                E.append(r1(wv * val + (1 - wv) * pr) if pr > 0.05 else 0.0)
            else:
                E.append(0.0 if (inj in OUT_STATUS and w == week) else r1(val))
        return E

    # free agents: best by expected points left (anyone unrostered with a projection)
    fa_pool = []
    seen = set(owner)
    cand = set().union(*[set(proj[w]) for w in weeks_left]) - seen
    for pid in cand:
        pos = pinfo(pid)[1]
        if pos not in POS6: continue
        E = expected(pid)
        fa_pool.append((sum(E), pid))
    fa_pool.sort(reverse=True)
    fa_keep = []
    per_pos = defaultdict(int)
    for tot, pid in fa_pool:
        pos = pinfo(pid)[1]
        if per_pos[pos] < (3 if pos in ("K", "DEF", "QB", "TE") else 6): fa_keep.append(pid); per_pos[pos] += 1

    # ---- weekly swing by player, shrunk to the position ----
    pos_sd = {}
    for pos in POS6:
        res = []
        for pid, g in gpts.items():
            if pinfo(pid)[1] != pos or len(g) < 3: continue
            v = list(g.values()); m = st.mean(v)
            if m < 5: continue
            res += [(x - m) ** 2 for x in v]
        pos_sd[pos] = math.sqrt(sum(res) / max(1, len(res))) if res else 6.0

    def sd_of(pid, pos):
        g = list(gpts.get(pid, {}).values()); k0 = 4
        own = st.pstdev(g) if len(g) >= 2 else pos_sd.get(pos, 6.0)
        return r1(math.sqrt((len(g) * own ** 2 + k0 * pos_sd.get(pos, 6.0) ** 2) / (len(g) + k0)))

    # ---- injury hazard by position, from this season ----
    haz = {}
    for pos in ("QB", "RB", "WR", "TE"):
        hit = n = back = nb = 0
        for pid, g in gpts.items():
            name, ppos, nfl, _, _ = pinfo(pid)
            if ppos != pos or nfl not in opp: continue
            if not g or st.mean(g.values()) < 6: continue
            for w in range(2, last + 1):
                if w not in opp[nfl]: continue                       # bye
                prev = w - 1 if (w - 1) in opp[nfl] else w - 2
                if prev < 1: continue
                if prev in g: n += 1; hit += w not in g
                elif any(x < prev for x in g): nb += 1; back += w in g
        haz[pos] = [round(hit / max(1, n), 3), round(back / max(1, nb), 3), n, nb]
    haz["K"] = [0.01, 0.5, 0, 0]; haz["DEF"] = [0.0, 1.0, 0, 0]

    # ---- points allowed by NFL defenses to each position ----
    allowed = defaultdict(lambda: defaultdict(list))
    for w, sw in stats.items():
        for t in nfl_teams:
            sl = sw.get(t)
            if not sl or not sl.get("gp"): continue
            for pos in POS6:
                k = f"fan_pts_allow_{pos.lower()}"
                if k in sl: allowed[t][pos].append(sl[k])
    def_rank = {}
    for pos in POS6:
        avg = {t: st.mean(allowed[t][pos]) for t in nfl_teams if allowed[t][pos]}
        order = sorted(avg, key=lambda t: -avg[t])        # 1 = gives up the most
        for i, t in enumerate(order): def_rank.setdefault(t, {})[pos] = [i + 1, r1(avg[t])]

    # ---- players out ----
    P = {}
    for pid in list(owner) + fa_keep:
        name, pos, nfl, inj, age = pinfo(pid); val, g, season_, rec_ = value(pid)
        P[pid] = dict(n=name, pos=pos, nfl=nfl, st=inj, age=age, v=r1(val), g=g, ppg=r1(season_), l3=r1(rec_), sd=sd_of(pid, pos),
                      E=expected(pid), ir=1 if pid in ir else 0, wk=[r1(gpts.get(pid, {}).get(w)) if w in gpts.get(pid, {}) else None for w in range(1, last + 1)])

    # ---- team strength, as League HQ's Playoff race computes it ----
    lm = st.mean(x for r in rids for x in pts[r])
    def lineup_value(pids):
        pool = [(pid, {P[pid]["pos"]} if P[pid]["pos"] in POS6 else set(), P[pid]["v"]) for pid in pids if P[pid]["st"] not in OUT_STATUS]
        return best_lineup(slots, pool)[0]
    lv = {r: lineup_value([p for p in owner if owner[p] == r]) for r in rids}
    lvm = st.mean(lv.values()); scale = lm / lvm
    teams = []
    for r in rids:
        shr = (sum(pts[r]) + C * lm) / (len(pts[r]) + C)
        mu = A * shr + (1 - A) * lv[r] * scale
        ro = next(x for x in rosters if x["roster_id"] == r)
        teams.append(dict(rid=r, manager=mgr[r], team=team[r], w=rec[r][0], l=rec[r][1], t=rec[r][2], pf=r1(rec[r][3]),
                          mu=round(mu, 2), lv=r1(lv[r]), players=[p for p in ro["players"] or [] if p not in ir], ir=[p for p in ro.get("reserve") or []]))

    out_ = dict(
        meta=dict(season=season, week=week, last=last, po=po, nplay=nplay, deadline=cfg.get("trade_deadline"), slots=slots, bench=n_bench,
                  ir_slots=cfg.get("reserve_slots", 0), weeks=weeks_left, A=A, C=C, SD=SD, lm=round(lm, 2), scale=round(scale, 4),
                  pos_sd={k: r1(v) for k, v in pos_sd.items()}, haz=haz),
        teams=teams, left=left, players=P, fa=fa_keep,
        opp={t: {w: opp[t].get(w, "BYE") for w in weeks_left} for t in nfl_teams}, def_rank=def_rank)
    with open(out, "w") as f: json.dump(out_, f, separators=(",", ":"))
    print(f"{len(P)} players ({len(fa_keep)} free agents), {len(left)} games left, A={A} C={C} SD={SD}, haz={haz}")


if __name__ == "__main__":
    main(*sys.argv[1:4])
