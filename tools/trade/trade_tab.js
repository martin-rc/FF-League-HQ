// FF League HQ trade simulator. Data: window.TRADE (trade_data.py). Everything runs in the browser.
(() => {
  const T = window.TRADE; if (!T || !window.SL) return;
  const { C, el, av, pchip, posColor, tip, svgIn } = SL;
  const M = T.meta, PL = T.players, WK = M.weeks, NW = WK.length;
  const REG = WK.map((w, i) => (w < M.po ? i : -1)).filter((i) => i >= 0);
  const POI = WK.map((w, i) => (w >= M.po ? i : -1)).filter((i) => i >= 0);
  const ALLI = WK.map((_, i) => i);
  const TEAMS = T.teams, N = TEAMS.length, IX = Object.fromEntries(TEAMS.map((t, i) => [t.manager, i]));
  const OUT = /^(Out|IR|PUP|Sus|Suspended|NA|DNR|Doubtful)$/;
  const OK = { QB: ['QB'], RB: ['RB'], WR: ['WR'], TE: ['TE'], K: ['K'], DEF: ['DEF'], FLEX: ['RB', 'WR', 'TE'], SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'], REC_FLEX: ['WR', 'TE'], WRRB_FLEX: ['WR', 'RB'] };
  const SLOTS = [...M.slots].sort((a, b) => OK[a].length - OK[b].length);
  const ACTIVE_MAX = M.slots.length + M.bench;
  const POSG = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
  const f1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
  const sg = (v, d = 1) => { const r = +(+v).toFixed(d); return (r > 0 ? '+' : r < 0 ? '−' : '±') + Math.abs(r).toFixed(d); };
  const pct = (v) => (v >= 0.9995 ? '>99.9%' : v > 0 && v < 0.001 ? '<0.1%' : v <= 0 ? '0%' : (v * 100).toFixed(v >= 0.1 ? 0 : 1) + '%');
  const pp = (d) => sg(d * 100, 1) + '%';
  const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
  const sum = (a) => a.reduce((s, x) => s + x, 0);
  const avgE = (pid, idx) => mean(idx.map((i) => PL[pid].E[i]));

  // ---------- lineups ----------
  // greedy, most restrictive slot first: optimal for this league's nested FLEX slots
  const lineup = (pids, val) => {
    const pool = pids.map((p) => ({ p, pos: PL[p].pos, v: val(p) })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
    const used = new Set(); let tot = 0; const picks = [];
    for (const s of SLOTS) {
      const x = pool.find((y) => !used.has(y.p) && OK[s].includes(y.pos));
      if (x) { used.add(x.p); tot += x.v; picks.push([s, x.p, x.v]); } else picks.push([s, null, 0]);
    }
    return { tot, picks, used };
  };
  const hqVal = (p) => (OUT.test(PL[p].st) ? 0 : PL[p].v);
  const weekly = (pids) => WK.map((_, i) => lineup(pids, (p) => PL[p].E[i]));

  // ---------- roster after the trade: roster limits, drops, open spots ----------
  const rosterOf = (t) => ({ act: [...t.players], ir: [...t.ir] });
  const applyTrade = (t, out, inn, faTaken) => {
    const r = rosterOf(t); const notes = { drops: [], adds: [], toIR: [] };
    r.act = r.act.filter((p) => !out.includes(p)); r.ir = r.ir.filter((p) => !out.includes(p));
    for (const p of inn) {
      if (PL[p].ir && r.ir.length < M.ir_slots) { r.ir.push(p); notes.toIR.push(p); } else r.act.push(p);
    }
    const ros = (p) => sum(PL[p].E);
    while (r.act.length > ACTIVE_MAX) {          // too many players: drop the least useful one we didn't just get
      const cnt = (pos) => r.act.filter((x) => PL[x].pos === pos).length;
      const cand = r.act.filter((p) => !inn.includes(p) && !(['QB', 'K', 'DEF', 'TE'].includes(PL[p].pos) && cnt(PL[p].pos) === 1))
        .sort((a, b) => ros(a) - ros(b));
      const d = cand[0] || r.act.filter((p) => !inn.includes(p)).sort((a, b) => ros(a) - ros(b))[0];
      r.act = r.act.filter((p) => p !== d); notes.drops.push(d);
    }
    while (r.act.length < ACTIVE_MAX) {          // open spot: add the free agent that helps the lineup most
      const base = sum(weekly([...r.act, ...r.ir]).map((l) => l.tot));
      let best = null;
      for (const f of T.fa) {
        if (faTaken.has(f)) continue;
        const g = sum(weekly([...r.act, ...r.ir, f]).map((l) => l.tot)) - base;
        if (!best || g > best.g + 1e-9 || (Math.abs(g - best.g) < 1e-9 && sum(PL[f].E) > sum(PL[best.f].E))) best = { f, g };
      }
      if (!best) break;
      faTaken.add(best.f); r.act.push(best.f); notes.adds.push(best.f);
    }
    return { pids: [...r.act, ...r.ir], act: r.act, ir: r.ir, notes };
  };

  // ---------- one team's numbers for a roster ----------
  const profile = (pids) => {
    const hq = lineup(pids, hqVal);
    const L = weekly(pids); const LW = L.map((l) => l.tot);
    const bench = pids.filter((p) => !hq.used.has(p)).map((p) => avgE(p, ALLI)).sort((a, b) => b - a).slice(0, 4);
    const grp = Object.fromEntries(POSG.map((g) => [g, 0]));
    L.forEach((l) => l.picks.forEach(([, p, v]) => { if (p) grp[PL[p].pos] += v / NW; }));
    const top2 = L.map((l) => { const v = l.picks.map((x) => x[2]).sort((a, b) => b - a); return (v[0] + v[1]) / (l.tot || 1); });
    const has = Object.fromEntries(POSG.map((g) => [g, pids.filter((p) => PL[p].pos === g && sum(PL[p].E) > 0).length]));
    return { hq: hq.tot, hqPicks: hq.picks, L, LW, ros: mean(REG.map((i) => LW[i])), po: mean(POI.map((i) => LW[i])), all: mean(LW), bench: sum(bench), grp, top2: mean(top2), has };
  };

  // ---------- playoff odds: League HQ's model, week by week ----------
  let seed = 1;
  const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  let spare = null;
  const nrm = () => { if (spare !== null) { const s = spare; spare = null; return s; } let u = 0; while (u === 0) u = rnd(); const v = rnd(); const r = Math.sqrt(-2 * Math.log(u)); spare = r * Math.sin(2 * Math.PI * v); return r * Math.cos(2 * Math.PI * v); };
  const GAMES = (() => { const g = {}; for (const [w, a, b] of T.left) (g[w] = g[w] || []).push([IX[TEAMS.find((t) => t.rid === a).manager], IX[TEAMS.find((t) => t.rid === b).manager]]); return g; })();
  const BASE = TEAMS.map((t) => profile([...t.players, ...t.ir]));
  const LWBAR = BASE.map((b) => mean(b.LW));
  const adjOf = (ti, LW) => LW.map((v) => M.scale * (v - LWBAR[ti]));
  const odds = (scen, nsim = 20000) => {           // scen: array of per-team weekly strength adjustments, one per scenario
    seed = 2026; spare = null;
    const S = scen.length, tau = M.SD / Math.sqrt(M.last + M.C);
    const out = scen.map(() => ({ po: new Float64Array(N), title: new Float64Array(N), final: new Float64Array(N), seed: new Float64Array(N) }));
    const W = scen.map(() => new Float64Array(N)), PF = scen.map(() => new Float64Array(N)), tru = new Float64Array(N), z = new Float64Array(N);
    const regW = WK.filter((w) => w < M.po);
    for (let s = 0; s < nsim; s++) {
      for (let t = 0; t < N; t++) { tru[t] = TEAMS[t].mu + tau * nrm(); for (let k = 0; k < S; k++) { W[k][t] = TEAMS[t].w + 0.5 * TEAMS[t].t; PF[k][t] = TEAMS[t].pf; } }
      for (const w of regW) {
        const wi = WK.indexOf(w);
        for (let t = 0; t < N; t++) z[t] = nrm();
        for (let k = 0; k < S; k++) {
          const adj = scen[k];
          for (const [i, j] of GAMES[w] || []) {
            const si = tru[i] + adj[i][wi] + M.SD * z[i], sj = tru[j] + adj[j][wi] + M.SD * z[j];
            PF[k][i] += si; PF[k][j] += sj; if (si > sj) W[k][i] += 1; else W[k][j] += 1;
          }
        }
      }
      const zp = POI.map(() => Array.from({ length: N }, () => nrm()));
      for (let k = 0; k < S; k++) {
        const adj = scen[k], o = out[k];
        const order = [...Array(N).keys()].sort((a, b) => (W[k][b] * 1e5 + PF[k][b]) - (W[k][a] * 1e5 + PF[k][a]));
        order.forEach((t, r) => { o.seed[t] += r + 1; if (r < M.nplay) o.po[t] += 1; });
        const sc = (t, r) => tru[t] + adj[t][POI[r]] + M.SD * zp[r][t];
        const g = (a, b, r) => (sc(a, r) > sc(b, r) ? a : b);
        const r1 = [g(order[0], order[7], 0), g(order[3], order[4], 0), g(order[2], order[5], 0), g(order[1], order[6], 0)];
        const f1_ = g(r1[0], r1[1], 1), f2_ = g(r1[2], r1[3], 1);
        o.final[f1_] += 1; o.final[f2_] += 1; o.title[g(f1_, f2_, 2)] += 1;
      }
    }
    for (const o of out) for (const k of ['po', 'title', 'final', 'seed']) for (let t = 0; t < N; t++) o[k][t] /= nsim;
    return out;
  };

  // ---------- risk: injuries and weekly swings, same random draws before and after ----------
  const risk = (rosters, nsim = 1500) => {   // rosters: [[beforePids, afterPids], ...] -> per roster: array of (after - before) totals
    seed = 77; spare = null;
    const ids = [...new Set(rosters.flat(2))];
    const res = rosters.map(() => ({ all: [], reg: [], po: [] }));
    const av = {}, pts = {};
    for (let s = 0; s < nsim; s++) {
      for (const p of ids) {
        const x = PL[p], h = (M.haz[x.pos] || [0.05, 0.3])[0], rb = (M.haz[x.pos] || [0.05, 0.3])[1];
        let hurt = false; const a = new Array(NW), q = new Array(NW);
        for (let i = 0; i < NW; i++) {
          if (i > 0) { if (!hurt && x.E[i] > 0 && rnd() < h) hurt = true; else if (hurt && rnd() < rb) hurt = false; }
          const plays = x.E[i] > 0 && !hurt; a[i] = plays ? x.E[i] : 0; q[i] = plays ? Math.max(0, x.E[i] + x.sd * nrm()) : 0;
        }
        av[p] = a; pts[p] = q;
      }
      rosters.forEach(([bef, aft], k) => {
        const tot = (pids) => WK.map((_, i) => { const l = lineup(pids, (p) => av[p][i]); let v = 0; for (const [, p] of l.picks) if (p) v += pts[p][i]; return v; });
        const b = tot(bef), a = tot(aft);
        res[k].all.push(sum(a) - sum(b)); res[k].reg.push(sum(REG.map((i) => a[i] - b[i]))); res[k].po.push(sum(POI.map((i) => a[i] - b[i])));
      });
    }
    return res.map((r) => {
      const q = (arr, f) => { const s = [...arr].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(f * s.length))]; };
      return { p10: q(r.all, 0.1), p25: q(r.all, 0.25), p50: q(r.all, 0.5), p75: q(r.all, 0.75), p90: q(r.all, 0.9), better: r.all.filter((x) => x > 0).length / r.all.length, mean: mean(r.all), po50: q(r.po, 0.5) };
    });
  };

  // ---------- trade value: points over the best free agent at the position ----------
  const REPL = (() => {
    const r = {};
    for (const g of POSG) {
      const fa = T.fa.filter((p) => PL[p].pos === g).map((p) => PL[p].E);
      r[g] = WK.map((_, i) => Math.max(0, ...fa.map((e) => e[i])));
    }
    return r;
  })();
  const tvalue = (p) => sum(PL[p].E.map((e, i) => (e > 0 ? Math.max(0, e - REPL[PL[p].pos][i]) : 0)));

  // ---------- helpers for words ----------
  const nm = (p) => PL[p].n;
  const list = (ps) => (ps.length <= 1 ? ps.map(nm).join('') : ps.slice(0, -1).map(nm).join(', ') + ' and ' + nm(ps[ps.length - 1]));
  const isBye = (p, i) => (T.opp[PL[p].nfl] || {})[WK[i]] === 'BYE';
  const backWeek = (p) => {   // first week he's projected to play again, when he is out now (byes don't count)
    const E = PL[p].E; let missed = false;
    for (let i = 0; i < NW; i++) { if (E[i] > 0) return missed ? WK[i] : null; if (!isBye(p, i)) missed = true; }
    return 'never';
  };
  const outWeeks = (p) => WK.filter((w, i) => PL[p].E[i] === 0 && (T.opp[PL[p].nfl] || {})[w] !== 'BYE');
  const byeOf = (p) => WK.find((w) => (T.opp[PL[p].nfl] || {})[w] === 'BYE');
  const poSched = (p) => {
    const x = PL[p]; const o = T.opp[x.nfl] || {};
    return WK.filter((w) => w >= M.po).map((w) => { const op = o[w] || ''; const tm = op.replace('@', ''); const rk = (T.def_rank[tm] || {})[x.pos]; return { w, op, rk: rk ? rk[0] : null }; });
  };
  const poEase = (p) => { const s = poSched(p).filter((x) => x.rk); return s.length ? mean(s.map((x) => x.rk)) : null; };

  // ---------- the analysis ----------
  const analyze = (A, B, give) => {
    const ta = TEAMS[IX[A]], tb = TEAMS[IX[B]];
    const aOut = [...ta.players, ...ta.ir].filter((p) => give.has(p)), bOut = [...tb.players, ...tb.ir].filter((p) => give.has(p));
    const taken = new Set();
    const ra = applyTrade(ta, aOut, bOut, taken), rb = applyTrade(tb, bOut, aOut, taken);
    const side = (t, mine, theirs, r) => {
      const ti = IX[t.manager]; const before = BASE[ti], after = profile(r.pids);
      return { t, ti, out: mine, inn: theirs, r, before, after };
    };
    const SA = side(ta, aOut, bOut, ra), SB = side(tb, bOut, aOut, rb);
    const adjB = TEAMS.map((_, i) => adjOf(i, BASE[i].LW));
    const adjA = adjB.map((a, i) => (i === SA.ti ? adjOf(i, SA.after.LW) : i === SB.ti ? adjOf(i, SB.after.LW) : a));
    const [ob, oa] = odds([adjB, adjA]);
    const rk = risk([[[...ta.players, ...ta.ir], ra.pids], [[...tb.players, ...tb.ir], rb.pids]]);
    for (const [S, k] of [[SA, 0], [SB, 1]]) {
      S.odds = { po: [ob.po[S.ti], oa.po[S.ti]], title: [ob.title[S.ti], oa.title[S.ti]], final: [ob.final[S.ti], oa.final[S.ti]], seed: [ob.seed[S.ti], oa.seed[S.ti]] };
      S.risk = rk[k];
      S.tvOut = sum(S.out.map(tvalue)); S.tvIn = sum(S.inn.map(tvalue));
      const dT = S.odds.title[1] - S.odds.title[0], dP = S.odds.po[1] - S.odds.po[0], dPts = S.after.all - S.before.all;
      S.score = 100 * dT + 0.3 * 100 * dP + 0.1 * dPts;
    }
    const ripple = TEAMS.map((t, i) => ({ t, d: oa.po[i] - ob.po[i], dt: oa.title[i] - ob.title[i] })).filter((x) => x.t !== ta && x.t !== tb).sort((a, b) => a.d - b.d);
    // league rank of each position group, before and after (other teams unchanged)
    const grpRank = (S, which) => Object.fromEntries(POSG.map((g) => {
      const vals = TEAMS.map((_, i) => (i === SA.ti ? (which === 'a' ? SA.after : SA.before) : i === SB.ti ? (which === 'a' ? SB.after : SB.before) : BASE[i]).grp[g]);
      const me = vals[S.ti]; return [g, 1 + vals.filter((v) => v > me + 1e-9).length];
    }));
    for (const S of [SA, SB]) { S.rankB = grpRank(S, 'b'); S.rankA = grpRank(S, 'a'); }
    for (const S of [SA, SB]) S.pc = prosCons(S);
    return { SA, SB, ripple };
  };

  const grade = (s) => (s >= 6 ? ['A+', 'Big win'] : s >= 3.5 ? ['A', 'Clear win'] : s >= 2 ? ['A−', 'Win'] : s >= 1 ? ['B+', 'Small win'] : s >= 0.4 ? ['B', 'Slight edge']
    : s > -0.4 ? ['C', 'A wash'] : s > -1 ? ['C−', 'Slight step back'] : s > -2 ? ['D+', 'Small loss'] : s > -3.5 ? ['D', 'Loss'] : ['F', 'Big loss']);

  function prosCons(S) {
    const pro = [], con = [], risk_ = [], ctx = [];
    const b = S.before, a = S.after;
    const dR = a.ros - b.ros, dP = a.po - b.po, dHQ = a.hq - b.hq;
    const [po0, po1] = S.odds.po, [t0, t1] = S.odds.title;
    // standing context first: it decides what matters
    if (po0 >= 0.9) ctx.push(`Already ${pct(po0)} to make the playoffs, so the playoff weeks (${M.po}–${M.po + 2}) matter more than the next few games.`);
    else if (po0 <= 0.15) ctx.push(`Only ${pct(po0)} to make the playoffs: this team needs points now, in weeks ${WK[0]}–${M.po - 1}, or the playoff weeks won't matter.`);
    else ctx.push(`On the bubble at ${pct(po0)} to make the playoffs: every regular-season point counts.`);
    if (M.deadline && WK[0] > M.deadline) ctx.push(`The trade deadline (week ${M.deadline}) has passed.`);
    // results
    const dPo = po1 - po0, dT = t1 - t0;
    if (dPo >= 0.02) pro.push(`Playoff odds up ${pp(dPo).slice(1)} (${pct(po0)} → ${pct(po1)}).`); else if (dPo <= -0.02) con.push(`Playoff odds down ${pp(-dPo).slice(1)} (${pct(po0)} → ${pct(po1)}).`);
    if (dT >= 0.005) pro.push(`Title odds up ${pp(dT).slice(1)} (${pct(t0)} → ${pct(t1)}).`); else if (dT <= -0.005) con.push(`Title odds down ${pp(-dT).slice(1)} (${pct(t0)} → ${pct(t1)}).`);
    if (dR >= 0.8) pro.push(`Starting lineup scores ${sg(dR)} a week for the rest of the regular season.`); else if (dR <= -0.8) con.push(`Starting lineup scores ${sg(dR)} a week for the rest of the regular season.`);
    if (dP >= 0.8) pro.push(`${sg(dP)} a week in the playoff weeks.`); else if (dP <= -0.8) con.push(`${sg(dP)} a week in the playoff weeks.`);
    if (Math.abs(dHQ) >= 1 && Math.sign(dHQ) !== Math.sign(dR + dP || dHQ)) ctx.push(`On today's form (League HQ value) the lineup goes ${sg(dHQ)}, but schedule and projections point the other way.`);
    // positions
    for (const g of POSG) {
      const d = a.grp[g] - b.grp[g]; if (Math.abs(d) < 1.5) continue;
      const rk = ` (league rank ${S.rankB[g]} → ${S.rankA[g]})`;
      (d > 0 ? pro : con).push(`${g} starters ${sg(d)} a week${rk}.`);
    }
    // depth and roster spots
    const dB = a.bench - b.bench;
    if (dB <= -4) con.push(`Thinner bench: the top 4 backups lose ${f1(-dB)} expected points a week of cover for byes and injuries.`);
    else if (dB >= 4) pro.push(`Deeper bench: ${sg(dB)} expected points a week in the top 4 backups.`);
    if (S.r.notes.drops.length) con.push(`Roster is over the limit: you'd drop ${list(S.r.notes.drops)}.`);
    if (S.r.notes.adds.length) pro.push(`Opens ${S.r.notes.adds.length} roster spot${S.r.notes.adds.length > 1 ? 's' : ''}: the best free agent${S.r.notes.adds.length > 1 ? 's' : ''} to add: ${list(S.r.notes.adds)}.`);
    if (S.r.notes.toIR.length) ctx.push(`${list(S.r.notes.toIR)} can go straight to an IR slot.`);
    for (const g of ['QB', 'TE', 'K', 'DEF']) if (b.has[g] > 0 && a.has[g] === 0) con.push(`No ${g} left on the roster: you'd need a pickup.`);
    if (S.out.length > S.inn.length && S.inn.length) ctx.push(`${S.out.length}-for-${S.inn.length}: consolidates into fewer, better players.`);
    if (S.inn.length > S.out.length && S.out.length) ctx.push(`${S.out.length}-for-${S.inn.length}: spreads value across more players, more depth.`);
    // bye weeks: worst week change
    const dW = WK.map((w, i) => ({ w, d: a.LW[i] - b.LW[i] }));
    const worst = dW.reduce((m, x) => (x.d < m.d ? x : m), dW[0]);
    if (worst && worst.d <= -6 && dR > -0.8) con.push(`Week ${worst.w} takes a hit (${sg(worst.d)}): byes or injuries stack up that week.`);
    // the players coming in
    for (const p of S.inn) {
      const x = PL[p]; const bw = backWeek(p);
      if (bw === 'never') con.push(`${x.n} isn't projected to play again this season.`);
      else if (bw) risk_.push(`${x.n} is ${x.st || 'out'} and projected back in week ${bw}.`);
      else if (x.st && x.st !== 'Active') risk_.push(`${x.n} is listed ${x.st}.`);
      if (x.g > 0 && x.g <= 3) risk_.push(`${x.n} has only ${x.g} game${x.g > 1 ? 's' : ''} this season: a small sample.`);
      if (x.g >= 4 && x.l3 >= x.ppg * 1.3 && x.l3 - x.ppg >= 3) risk_.push(`Buying high on ${x.n}: ${f1(x.l3)} a game over the last 3 vs ${f1(x.ppg)} for the season.`);
      if (x.g >= 4 && x.l3 <= x.ppg * 0.7 && x.ppg - x.l3 >= 3) pro.push(`Buying low on ${x.n}: ${f1(x.l3)} a game over the last 3 vs ${f1(x.ppg)} for the season.`);
      const e = avgE(p, ALLI); if (e >= 6 && x.sd / Math.max(e, 1) >= 0.65) risk_.push(`${x.n} is boom-or-bust: about ±${f1(x.sd)} points from week to week.`);
      const ease = poEase(p); if (ease && avgE(p, POI) >= 8) {
        if (ease <= 10) pro.push(`${x.n} has a soft playoff schedule (${poSched(p).map((s) => s.op).join(', ')}).`);
        else if (ease >= 23) con.push(`${x.n} has a tough playoff schedule (${poSched(p).map((s) => s.op).join(', ')}).`);
      }
    }
    for (const p of S.out) {
      const x = PL[p]; const bw = backWeek(p);
      if (bw === 'never') pro.push(`Moves ${x.n}, who isn't projected to play again this season.`);
      else if (bw && bw >= M.po - 2) pro.push(`Sells ${x.n} while he's out (back week ${bw}).`);
      if (x.g >= 4 && x.l3 >= x.ppg * 1.3 && x.l3 - x.ppg >= 3) pro.push(`Selling high on ${x.n}: ${f1(x.l3)} a game over the last 3 vs ${f1(x.ppg)} for the season.`);
      if (x.g >= 4 && x.l3 <= x.ppg * 0.7 && x.ppg - x.l3 >= 3) risk_.push(`Selling low on ${x.n}: ${f1(x.l3)} a game over the last 3 vs ${f1(x.ppg)} for the season.`);
    }
    if (a.top2 - b.top2 >= 0.04) risk_.push(`More eggs in one basket: the top 2 starters go from ${pct(b.top2)} to ${pct(a.top2)} of the lineup's points, so one injury hurts more.`);
    // risk summary
    const R = S.risk;
    risk_.unshift(`With injuries and weekly swings played out ${'1,500'} times, the trade comes out ahead in ${pct(R.better)} of seasons (weeks ${WK[0]}–${WK[NW - 1]}).`);
    return { pro, con, risk: risk_, ctx };
  }

  // ---------- UI ----------
  const state = { a: null, b: null, give: new Set() };
  try { const s = JSON.parse(sessionStorage.getItem('ffhq-trade') || 'null'); if (s) { state.a = s.a; state.b = s.b; state.give = new Set(s.give || []); } } catch (e) {}
  const save = () => { try { sessionStorage.setItem('ffhq-trade', JSON.stringify({ a: state.a, b: state.b, give: [...state.give] })); } catch (e) {} };
  const sortedTeams = () => [...TEAMS].sort((x, y) => x.manager.toLowerCase().localeCompare(y.manager.toLowerCase()));
  const POSORD = { QB: 0, RB: 1, WR: 2, TE: 3, K: 4, DEF: 5 };
  let host = null, lastKey = '', timer = null;

  const teamPicker = (key, other) => {
    const card = el('div', 'card tside');
    const head = el('div', 'thead');
    const sel = el('select'); sel.setAttribute('aria-label', key === 'a' ? 'Team A' : 'Team B');
    sel.append(...sortedTeams().map((t) => new Option(`${t.manager} · ${t.team}`, t.manager)));
    sel.value = state[key];
    sel.onchange = () => {
      const t = TEAMS[IX[state[key]]]; for (const p of [...t.players, ...t.ir]) state.give.delete(p);
      state[key] = sel.value; if (state[key] === state[other]) { state[other] = sortedTeams().find((t) => t.manager !== sel.value).manager; state.give.clear(); }
      save(); render();
    };
    const t = TEAMS[IX[state[key]]];
    const meta = el('div', 'grow');
    meta.append(sel, el('div', 'muted small', `${t.w}-${t.l}${t.t ? '-' + t.t : ''} · ${f1(t.pf)} pts · lineup value ${f1(BASE[IX[t.manager]].hq)}`));
    head.append(av(t.manager, 36), meta); card.append(head);
    card.append(el('div', 'muted small tcap', `Tap the players ${key === 'a' ? 'Team A' : 'Team B'} sends. Value = League HQ value · Rest = expected points a week, weeks ${WK[0]}–${M.po - 1} · Playoff = expected points a week, weeks ${M.po}–${M.po + 2}`));
    const lst = el('div', 'list tlist');
    const ps = [...t.players, ...t.ir].sort((x, y) => (POSORD[PL[x].pos] ?? 9) - (POSORD[PL[y].pos] ?? 9) || avgE(y, ALLI) - avgE(x, ALLI));
    for (const p of ps) {
      const x = PL[p]; const on = state.give.has(p);
      const row = el('div', 'li trow' + (on ? ' on' : ''));
      const tx = el('div', 'grow');
      const st = x.st ? ` · ${x.st}` : ''; const ir = t.ir.includes(p) ? ' · on IR slot' : '';
      tx.append(el('div', 'nm', x.n), el('div', 'tm', `${x.pos} · ${x.nfl}${st}${ir}`));
      const nums = el('div', 'num tnums');
      nums.append(el('span', null, f1(x.v)), el('span', null, f1(avgE(p, REG))), el('span', null, f1(avgE(p, POI))));
      const btn = el('button', 'tbtn', on ? '✓ In' : 'Add'); btn.setAttribute('aria-pressed', String(on)); btn.setAttribute('aria-label', `${on ? 'Remove' : 'Add'} ${x.n}`);
      btn.onclick = () => { if (state.give.has(p)) state.give.delete(p); else state.give.add(p); save(); render(); };
      row.append(pchip(x.n, x.pos, 34), tx, nums, btn); lst.append(row);
    }
    const hdr = el('div', 'li thdr'); const hn = el('div', 'num tnums'); hn.append(el('span', null, 'Value'), el('span', null, 'Rest'), el('span', null, 'Playoff'));
    hdr.append(el('div', 'grow'), hn, el('div', 'tbtnsp'));
    card.append(hdr, lst);
    return card;
  };

  const deltaCell = (b, a, fmt = f1, good = 1, thr = 0.05) => {
    const d = a - b; const c = el('td', 'n');
    c.append(el('span', 'muted', fmt(b) + ' → '), el('b', null, fmt(a)));
    const s = el('span', 'dl ' + (d * good > thr ? 'pos' : d * good < -thr ? 'neg' : 'muted'), ' ' + (fmt === pct ? pp(d) : sg(d))); c.append(s); return c;
  };

  const verdictCard = (S, other) => {
    const [g, word] = grade(S.score);
    const card = el('div', 'card tverdict');
    const h = el('div', 'thead'); const tx = el('div', 'grow');
    tx.append(el('div', 'nm', S.t.manager), el('div', 'muted small', S.t.team));
    const gb = el('div', 'tgrade g' + g[0]); gb.append(el('div', 'gl', g), el('div', 'gw', word));
    h.append(av(S.t.manager, 40), tx, gb); card.append(h);
    const kp = el('div', 'tkpis');
    const kpi = (lab, b, a, fmt, d) => { const k = el('div', 'kpi'); k.append(el('div', 'k', lab), el('div', 'v', fmt(a)), el('div', 'dl ' + (d > 0.0005 ? 'pos' : d < -0.0005 ? 'neg' : 'muted'), (fmt === pct ? pp(d) : sg(d)) + ` (was ${fmt(b)})`)); kp.append(k); };
    kpi('Title odds', S.odds.title[0], S.odds.title[1], pct, S.odds.title[1] - S.odds.title[0]);
    kpi('Playoff odds', S.odds.po[0], S.odds.po[1], pct, S.odds.po[1] - S.odds.po[0]);
    kpi(`Pts/wk, wk ${WK[0]}–${M.po - 1}`, S.before.ros, S.after.ros, f1, S.after.ros - S.before.ros);
    kpi(`Pts/wk, playoffs`, S.before.po, S.after.po, f1, S.after.po - S.before.po);
    card.append(kp);
    const sec = (title, items, cls) => { if (!items.length) return; const d = el('div', 'tpc ' + cls); d.append(el('h3', null, title)); const ul = el('ul'); for (const t of items) ul.append(el('li', null, t)); d.append(ul); card.append(d); };
    sec('Context', S.pc.ctx, 'ctx'); sec('Pros', S.pc.pro, 'pro'); sec('Cons', S.pc.con, 'con'); sec('Risk', S.pc.risk, 'rsk');
    return card;
  };

  const weekChart = (R) => {
    const node = el('div', 'chart'); node.style.minHeight = '0';
    const W = innerWidth < 640 ? 400 : 640, H = 230, L = 34, Rr = 8, Tp = 22, Bm = 26;
    const svg = svgIn(node, W, H).attr('height', null); const tp = tip(node);
    const data = WK.map((w, i) => ({ w, a: R.SA.after.LW[i] - R.SA.before.LW[i], b: R.SB.after.LW[i] - R.SB.before.LW[i] }));
    const mx = Math.max(4, d3.max(data, (d) => Math.max(Math.abs(d.a), Math.abs(d.b)))) * 1.1;
    const x = d3.scaleBand(WK, [L, W - Rr]).padding(0.25), y = d3.scaleLinear([-mx, mx], [H - Bm, Tp]).nice();
    const x0 = x(M.po); svg.append('rect').attr('x', x0 - x.step() * x.padding() / 2).attr('y', Tp - 16).attr('width', W - Rr - x0 + x.step() * x.padding() / 2).attr('height', H - Bm - Tp + 16).attr('fill', C.gold).attr('opacity', 0.07);
    svg.append('text').attr('x', W - Rr - 4).attr('y', Tp - 4).attr('text-anchor', 'end').style('font-size', '11px').attr('fill', C.gold).text('Playoffs 🏆');
    for (const tk of y.ticks(5)) {
      svg.append('line').attr('x1', L).attr('x2', W - Rr).attr('y1', y(tk)).attr('y2', y(tk)).attr('stroke', tk === 0 ? C.muted : C.line).attr('stroke-dasharray', tk === 0 ? null : '2 4');
      svg.append('text').attr('x', L - 6).attr('y', y(tk)).attr('dy', '0.35em').attr('text-anchor', 'end').style('font-size', '10px').attr('fill', C.muted).text(tk > 0 ? '+' + tk : tk);
    }
    const ca = SL.avColor(R.SA.t.manager), cb = SL.avColor(R.SB.t.manager); const bw = x.bandwidth() / 2;
    for (const d of data) {
      for (const [k, col, off, S] of [['a', ca, 0, R.SA], ['b', cb, bw, R.SB]]) {
        const v = d[k]; svg.append('rect').attr('x', x(d.w) + off).attr('width', bw - 1).attr('y', Math.min(y(0), y(v))).attr('height', Math.max(1, Math.abs(y(v) - y(0)))).attr('rx', 2).attr('fill', col)
          .on('pointermove', (ev) => { const i = WK.indexOf(d.w); tp.show(ev, `Week ${d.w} · ${S.t.manager}`, [`${f1(S.before.LW[i])} → ${f1(S.after.LW[i])} expected (${sg(v)})`]); }).on('pointerleave', () => tp.hide());
      }
      svg.append('text').attr('x', x(d.w) + x.bandwidth() / 2).attr('y', H - 8).attr('text-anchor', 'middle').style('font-size', '10.5px').attr('fill', C.muted).text(`wk ${d.w}`);
    }
    const lg = el('div', 'legend'); for (const [S, col] of [[R.SA, ca], [R.SB, cb]]) { const s = el('span'); const i = el('i', 'dot'); i.style.background = col; s.append(i, ' ' + S.t.manager); lg.append(s); }
    const wrap = el('div'); wrap.append(lg, node); return wrap;
  };

  const riskChart = (R) => {
    const node = el('div', 'chart'); node.style.minHeight = '0';
    const rows_ = [R.SA, R.SB]; const W = innerWidth < 640 ? 400 : 640, rowH = 46, H = rows_.length * rowH + 30, L = innerWidth < 640 ? 96 : 120, Rr = 14;
    const svg = svgIn(node, W, H).attr('height', null); const tp = tip(node);
    const lo = Math.min(0, ...rows_.map((S) => S.risk.p10)), hi = Math.max(0, ...rows_.map((S) => S.risk.p90));
    const pad = Math.max(10, (hi - lo) * 0.08); const x = d3.scaleLinear([lo - pad, hi + pad], [L, W - Rr]).nice();
    for (const tk of x.ticks(6)) { svg.append('line').attr('x1', x(tk)).attr('x2', x(tk)).attr('y1', 6).attr('y2', H - 22).attr('stroke', tk === 0 ? C.muted : C.line).attr('stroke-dasharray', tk === 0 ? null : '2 4'); svg.append('text').attr('x', x(tk)).attr('y', H - 6).attr('text-anchor', 'middle').style('font-size', '10px').attr('fill', C.muted).text(tk > 0 ? '+' + tk : tk); }
    rows_.forEach((S, k) => {
      const r = S.risk, cy = 14 + k * rowH + rowH / 2 - 8, col = SL.avColor(S.t.manager);
      svg.append('text').attr('x', 0).attr('y', cy).attr('dy', '0.35em').attr('class', 'strong').text(S.t.manager.length > 15 ? S.t.manager.slice(0, 14) + '…' : S.t.manager);
      svg.append('line').attr('x1', x(r.p10)).attr('x2', x(r.p90)).attr('y1', cy).attr('y2', cy).attr('stroke', col).attr('stroke-width', 2);
      svg.append('rect').attr('x', x(r.p25)).attr('width', Math.max(2, x(r.p75) - x(r.p25))).attr('y', cy - 9).attr('height', 18).attr('rx', 4).attr('fill', col).attr('opacity', 0.45);
      svg.append('circle').attr('cx', x(r.p50)).attr('cy', cy).attr('r', 6).attr('fill', col).attr('stroke', '#0b0e16').attr('stroke-width', 2);
      svg.append('rect').attr('x', L).attr('width', W - Rr - L).attr('y', cy - 16).attr('height', 32).attr('fill', 'transparent')
        .on('pointermove', (ev) => tp.show(ev, S.t.manager, [`Typical: ${sg(r.p50, 0)} pts over weeks ${WK[0]}–${WK[NW - 1]}`, `Middle half: ${sg(r.p25, 0)} to ${sg(r.p75, 0)}`, `Bad 10% / good 10%: ${sg(r.p10, 0)} / ${sg(r.p90, 0)}`, `Comes out ahead: ${pct(r.better)}`])).on('pointerleave', () => tp.hide());
    });
    return node;
  };

  const playerTable = (R) => {
    const wrap = el('div', 'tbl'); const tb = el('table', 'ttable'); const th = el('thead'); const hr = el('tr');
    for (const h of ['Player', 'Goes to', 'Value', 'G', 'PPG', 'Last 3', `Rest/wk`, 'Playoffs/wk', 'Swing', 'Bye', 'Status', `Playoff matchups`, 'Trade value']) hr.append(el('th', ['Player', 'Goes to', 'Bye', 'Status', 'Playoff matchups'].includes(h) ? null : 'n', h));
    th.append(hr); tb.append(th); const body = el('tbody');
    for (const [S, to] of [[R.SA, R.SB], [R.SB, R.SA]]) for (const p of S.out) {
      const x = PL[p], tr = el('tr');
      const c = el('td'); const w = el('div', 'tpl'); w.append(pchip(x.n, x.pos, 26), el('span', null, `${x.n} `), el('span', 'muted small', `${x.pos} · ${x.nfl}`)); c.append(w); tr.append(c);
      tr.append(el('td', null, to.t.manager));
      for (const v of [f1(x.v), x.g, f1(x.ppg), f1(x.l3), f1(avgE(p, REG)), f1(avgE(p, POI)), '±' + f1(x.sd)]) tr.append(el('td', 'n', String(v)));
      tr.append(el('td', null, byeOf(p) ? `wk ${byeOf(p)}` : '—'));
      const bw = backWeek(p); tr.append(el('td', bw ? 'neg' : null, bw === 'never' ? 'Out for season' : bw ? `${x.st || 'Out'} · back wk ${bw}` : x.st || 'Healthy'));
      const ms = el('td'); for (const s of poSched(p)) { const sp = el('span', 'mu ' + (s.rk == null ? '' : s.rk <= 10 ? 'easy' : s.rk >= 23 ? 'hard' : 'mid'), s.op === 'BYE' ? 'BYE' : s.op); sp.title = s.rk ? `Week ${s.w}: ${s.op}, ${s.rk}${['th', 'st', 'nd', 'rd'][(s.rk % 10 > 3 || [11, 12, 13].includes(s.rk % 100)) ? 0 : s.rk % 10]} most points allowed to ${x.pos}` : `Week ${s.w}`; ms.append(sp); } tr.append(ms);
      tr.append(el('td', 'n', f1(tvalue(p))));
      body.append(tr);
    }
    tb.append(body); wrap.append(tb); SL.labelCells(body); return wrap;
  };

  const compareTable = (R) => {
    const wrap = el('div', 'tbl'); const tb = el('table'); const hr = el('tr');
    hr.append(el('th', null, ''), el('th', 'n', R.SA.t.manager), el('th', 'n', R.SB.t.manager)); const th = el('thead'); th.append(hr); tb.append(th);
    const body = el('tbody');
    const row = (lab, fn, fmt = f1, good = 1) => { const tr = el('tr'); tr.append(el('td', null, lab)); for (const S of [R.SA, R.SB]) { const [b, a] = fn(S); tr.append(deltaCell(b, a, fmt, good)); } body.append(tr); };
    row('Lineup value now (League HQ)', (S) => [S.before.hq, S.after.hq]);
    row(`Expected pts/wk, weeks ${WK[0]}–${M.po - 1}`, (S) => [S.before.ros, S.after.ros]);
    row(`Expected pts/wk, playoffs (${M.po}–${M.po + 2})`, (S) => [S.before.po, S.after.po]);
    row('Bench cover (top 4 backups, pts/wk)', (S) => [S.before.bench, S.after.bench]);
    row('Playoff odds', (S) => S.odds.po, pct);
    row('Average seed', (S) => S.odds.seed, f1, -1);
    row('Reach the final', (S) => S.odds.final, pct);
    row('Title odds', (S) => S.odds.title, pct);
    row('Trade value sent → received', (S) => [S.tvOut, S.tvIn]);
    tb.append(body); wrap.append(tb); SL.labelCells(body); return wrap;
  };

  const posTable = (R) => {
    const wrap = el('div', 'tbl'); const tb = el('table'); const th = el('thead'); const hr = el('tr');
    hr.append(el('th', null, 'Starters at'), el('th', 'n', R.SA.t.manager), el('th', 'n', 'Rank'), el('th', 'n', R.SB.t.manager), el('th', 'n', 'Rank')); th.append(hr); tb.append(th);
    const body = el('tbody');
    for (const g of POSG) {
      const tr = el('tr'); tr.append(el('td', null, g));
      for (const S of [R.SA, R.SB]) { tr.append(deltaCell(S.before.grp[g], S.after.grp[g])); const d = S.rankB[g] - S.rankA[g]; const c = el('td', 'n'); c.append(el('span', 'muted', `${S.rankB[g]} → `), el('b', d > 0 ? 'pos' : d < 0 ? 'neg' : null, String(S.rankA[g]))); tr.append(c); }
      body.append(tr);
    }
    tb.append(body); wrap.append(tb); SL.labelCells(body); return wrap;
  };

  const lineupCard = (S) => {
    const card = el('div', 'card');
    card.append(el('h3', null, `${S.t.manager}: lineup after the trade`), el('p', 'muted small', `Best lineup on today's League HQ values. New players marked ➕.`));
    const lst = el('div', 'list');
    for (const [slot, p, v] of S.after.hqPicks) {
      const row = el('div', 'li'); row.append(el('span', 'pill', slot === 'FLEX' ? 'FLX' : slot));
      if (p) { const x = PL[p]; const tx = el('div', 'grow'); tx.append(el('div', 'nm', (S.inn.includes(p) || S.r.notes.adds.includes(p) ? '➕ ' : '') + x.n), el('div', 'tm', `${x.pos} · ${x.nfl}${x.st ? ' · ' + x.st : ''}`)); row.append(pchip(x.n, x.pos, 28), tx, el('div', 'num', f1(v))); }
      else row.append(el('div', 'grow muted', 'Empty'));
      lst.append(row);
    }
    card.append(lst); return card;
  };

  const results = (R) => {
    const box = el('div');
    const [ga] = grade(R.SA.score), [gb] = grade(R.SB.score);
    const d = R.SA.score - R.SB.score;
    const hl = el('div', 'explain mt');
    const who = Math.abs(d) < 1 ? 'Pretty even trade' : `Edge: ${d > 0 ? R.SA.t.manager : R.SB.t.manager}`;
    hl.append(el('p', 'big', ''), el('p', null, ''));
    hl.firstChild.append(el('b', null, `${who}. `), `${R.SA.t.manager} ${ga} · ${R.SB.t.manager} ${gb}`);
    const both = R.SA.score >= 0.4 && R.SB.score >= 0.4;
    hl.lastChild.textContent = both ? 'Both sides come out ahead: the trade fixes a need on each roster.' :
      (R.SA.score <= -0.4 && R.SB.score <= -0.4) ? 'Both sides lose a little: the players fit better where they are now.' :
      `Grades weigh the change in title odds most, then playoff odds, then expected points a week. Trade value (points over the best free agent at the position) is ${f1(R.SA.tvOut)} going to ${R.SB.t.manager} and ${f1(R.SB.tvOut)} going to ${R.SA.t.manager}.`;
    box.append(hl);
    const g = el('div', 'grid mt'); g.append(verdictCard(R.SA, R.SB), verdictCard(R.SB, R.SA)); box.append(g);
    box.append(el('h2', null, 'Side by side'));
    const c1 = el('div', 'card'); c1.append(compareTable(R), el('p', 'muted small mt', `Odds come from League HQ's Playoff race model (${(20000).toLocaleString()} simulated seasons, each team's strength moved week by week by its expected lineup), run with and without the trade on the same random draws so the difference is the trade, not luck. Without the trade they can differ a little from the Playoff race tab, which doesn't count byes.`)); box.append(c1);
    box.append(el('h2', null, 'Week by week'));
    const c2 = el('div', 'card'); c2.append(el('p', 'muted small', 'Change in each team\'s expected lineup score. Byes and injury timelines are built in.'), weekChart(R)); box.append(c2);
    box.append(el('h2', null, 'Risk vs reward'));
    const c3 = el('div', 'card'); c3.append(el('p', 'muted small', `Points gained or lost over weeks ${WK[0]}–${WK[NW - 1]} across 1,500 simulated seasons with random injuries (this season's rate by position) and weekly swings. Dot: typical result. Box: middle half. Line: 10th to 90th percentile.`), riskChart(R)); box.append(c3);
    const g2 = el('div', 'grid mt');
    const c4 = el('div', 'card'); c4.append(el('h3', null, 'Roster fit by position'), el('p', 'muted small', 'Expected points a week from each position\'s starters (FLEX counted by position), and the league rank.'), posTable(R)); g2.append(c4);
    const c5 = el('div', 'card'); c5.append(el('h3', null, 'Ripple effect 🌊'), el('p', 'muted small', 'Teams whose playoff odds move most because of this trade.'));
    const rl = el('div', 'list'); for (const x of [...R.ripple].sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 4)) { const row = el('div', 'li'); const tx = el('div', 'grow'); tx.append(el('div', 'nm', x.t.manager), el('div', 'tm', x.t.team)); row.append(av(x.t.manager, 28), tx, el('div', 'num ' + (x.d > 0.002 ? 'pos' : x.d < -0.002 ? 'neg' : 'muted'), pp(x.d))); rl.append(row); }
    c5.append(rl); g2.append(c5); box.append(g2);
    box.append(el('h2', null, 'The players'));
    const c6 = el('div', 'card'); c6.append(playerTable(R), el('p', 'muted small mt', `Value: League HQ value (65% season, 35% last 3). Rest/wk and Playoffs/wk: expected points a week, a blend of value and Sleeper's projections rescored for this league, 0 on byes and while out. Swing: typical week-to-week miss. Playoff matchups: green = a defense in the top 10 for points allowed to his position, red = bottom 10. Trade value: expected points over the best free agent at his position, weeks ${WK[0]}–${WK[NW - 1]}.`)); box.append(c6);
    const g3 = el('div', 'grid mt'); g3.append(lineupCard(R.SA), lineupCard(R.SB)); box.append(g3);
    return box;
  };

  function render() {
    if (!host) return;
    if (!state.a || IX[state.a] == null) state.a = SL.PICK(0) && IX[SL.PICK(0)] != null ? SL.PICK(0) : sortedTeams()[0].manager;
    if (!state.b || IX[state.b] == null || state.b === state.a) { const c = SL.PICK(1); state.b = c && IX[c] != null && c !== state.a ? c : sortedTeams().find((t) => t.manager !== state.a).manager; }
    const ta = TEAMS[IX[state.a]], tb = TEAMS[IX[state.b]];
    for (const p of [...state.give]) if (![...ta.players, ...ta.ir, ...tb.players, ...tb.ir].includes(p)) state.give.delete(p);
    const setup = el('div', 'grid tsetup'); setup.append(teamPicker('a', 'b'), teamPicker('b', 'a'));
    const aOut = [...ta.players, ...ta.ir].filter((p) => state.give.has(p)), bOut = [...tb.players, ...tb.ir].filter((p) => state.give.has(p));
    const bar = el('div', 'card tbar');
    const sideTxt = (t, ps) => { const d = el('div', 'tgive'); d.append(av(t.manager, 26), el('b', null, t.manager), el('span', 'muted', ' sends '), el('span', null, ps.length ? ps.map((p) => PL[p].n).join(', ') : 'nothing yet')); return d; };
    const clr = el('button', 'tclear', 'Clear'); clr.onclick = () => { state.give.clear(); save(); render(); };
    const swap = el('button', 'tclear', '⇄ Swap sides'); swap.onclick = () => { [state.a, state.b] = [state.b, state.a]; save(); render(); };
    const btns = el('div', 'tbtns'); btns.append(swap, clr);
    bar.append(sideTxt(ta, aOut), sideTxt(tb, bOut), btns);
    const res = el('div', 'tres');
    host.replaceChildren(setup, bar, res);
    const key = [state.a, state.b, ...aOut, '|', ...bOut].join(',');
    if (!aOut.length && !bOut.length) { res.append(el('p', 'muted mt', 'Pick at least one player on either side to see the analysis.')); lastKey = key; return; }
    res.append(el('p', 'muted mt', 'Crunching 20,000 seasons…'));
    clearTimeout(timer);
    timer = setTimeout(() => {
      try { const R = analyze(state.a, state.b, new Set([...aOut, ...bOut])); res.replaceChildren(results(R)); }
      catch (e) { console.error(e); res.replaceChildren(el('p', 'failed', 'Something went wrong running this trade.')); }
    }, 30);
    lastKey = key;
  }

  dash.draw('trade', (node) => {
    // redraw on first view and when the viewing-as team changes; trade picks keep their own state
    const pov = SL.POV();
    if (host === node && node.dataset.pov === pov && node.childElementCount) return;
    if (node.dataset.pov !== undefined && node.dataset.pov !== pov) { state.a = null; state.b = null; state.give.clear(); }
    node.dataset.pov = pov; host = node; render();
  });
  dash.draw('tradeasof', (node) => { node.textContent = `Rosters as of week ${M.week}, ${M.season}. Trade deadline: week ${M.deadline}.`; });
  window.SLtrade = { analyze, lineup, profile, odds, risk, T };
})();
