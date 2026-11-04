#!/usr/bin/env python3
"""Add (or refresh) the Trade simulator tab in the League HQ page.
Usage: python3 -I trade_tab.py <index.html> <trade.json> <trade_tab.js> <out.html>
Idempotent: everything it adds sits between TRADE markers, so running it again replaces the old copy."""
import json, re, sys

CSS = """
  /* TRADE-CSS-START */
  .sl .tside .thead, .sl .tverdict .thead { display: flex; gap: 10px; align-items: center; margin-bottom: 6px; }
  .sl .tside select { font: inherit; font-weight: 700; color: var(--fg); background: var(--card2); border: 1px solid var(--line); border-radius: 10px; padding: 6px 8px; max-width: 100%; width: 100%; }
  .sl .tcap { margin: 4px 0 2px; }
  .sl .tlist { max-height: 34rem; overflow-y: auto; }
  .sl .trow { gap: 8px; }
  .sl .trow.on { background: rgba(0,211,179,.09); margin: 0 -14px; padding-left: 14px; padding-right: 14px; }
  .sl .thdr { padding: 6px 0 2px; border-bottom: 1px solid var(--line); font-size: 10.5px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); font-weight: 700; }
  .sl .tnums { display: grid; grid-template-columns: repeat(3, 3.6rem); gap: 2px; font-size: 12.5px; }
  .sl .thdr .tnums { font-size: 10px; }
  .sl .tbtn { font: inherit; font-size: 12px; font-weight: 700; padding: 5px 0; width: 5.6rem; border-radius: 999px; border: 1px solid var(--line); background: var(--card2); color: var(--fg); cursor: pointer; flex: none; }
  .sl .tbtn[aria-pressed="true"] { background: var(--mint); color: #062621; border-color: var(--mint); }
  .sl .tbtnsp { width: 5.6rem; flex: none; }
  .sl .tbar { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 10px 18px; align-items: center; position: sticky; bottom: 8px; z-index: 3; box-shadow: 0 8px 24px rgba(0,0,0,.45); }
  .sl .tgive { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; min-width: 0; }
  .sl .tbtns { margin-left: auto; display: flex; gap: 6px; }
  .sl .tclear { font: inherit; font-size: 12px; font-weight: 600; padding: 6px 12px; border-radius: 999px; border: 1px solid var(--line); background: var(--card2); color: var(--muted); cursor: pointer; }
  .sl .tgrade { margin-left: auto; text-align: center; flex: none; min-width: 5.5rem; padding: 6px 10px; border-radius: 12px; background: var(--card2); }
  .sl .tgrade .gl { font-size: 26px; font-weight: 800; line-height: 1.1; }
  .sl .tgrade .gw { font-size: 11px; color: var(--muted); font-weight: 700; }
  .sl .tgrade.gA .gl { color: var(--mint); } .sl .tgrade.gB .gl { color: #a3d65c; } .sl .tgrade.gC .gl { color: var(--gold); }
  .sl .tgrade.gD .gl { color: var(--orange); } .sl .tgrade.gF .gl { color: var(--pink); }
  .sl .tkpis { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin: 8px 0 4px; }
  .sl .tkpis .kpi { background: var(--card2); border-radius: 10px; padding: 8px 10px; min-width: 0; }
  .sl .tkpis .k { font-size: 11px; color: var(--muted); font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
  .sl .tkpis .v { font-size: 20px; font-weight: 800; font-variant-numeric: tabular-nums; }
  .sl .tkpis .dl { font-size: 12px; font-weight: 600; }
  .sl .tpc { margin-top: 10px; }
  .sl .tpc ul { margin: 0; padding-left: 0; list-style: none; display: grid; gap: 5px; }
  .sl .tpc li { padding-left: 20px; position: relative; line-height: 1.45; }
  .sl .tpc li::before { position: absolute; left: 0; top: 0; font-weight: 800; }
  .sl .tpc.pro li::before { content: '+'; color: var(--mint); } .sl .tpc.con li::before { content: '−'; color: var(--pink); }
  .sl .tpc.rsk li::before { content: '!'; color: var(--gold); } .sl .tpc.ctx li::before { content: 'i'; color: var(--blue); }
  .sl .tpc.pro h3 { color: var(--mint); } .sl .tpc.con h3 { color: var(--pink); } .sl .tpc.rsk h3 { color: var(--gold); } .sl .tpc.ctx h3 { color: var(--blue); }
  .sl .dl.pos { color: var(--mint); } .sl .dl.neg { color: var(--pink); }
  .sl .tpl { display: flex; align-items: center; gap: 6px; }
  .sl .mu { display: inline-block; font-size: 11px; font-weight: 700; padding: 1px 6px; border-radius: 6px; margin-right: 3px; background: var(--card2); color: var(--muted); }
  .sl .mu.easy { background: rgba(0,211,179,.16); color: var(--mint); } .sl .mu.hard { background: rgba(255,79,123,.16); color: var(--pink); }
  @media (max-width: 640px) {
    .sl .tnums { grid-template-columns: repeat(2, 2.9rem); font-size: 12px; }
    .sl .tnums > span:first-child { display: none; }
    .sl .tbtn, .sl .tbtnsp { width: 3.6rem; font-size: 11px; }
    .sl .tside .li .nm { white-space: normal; overflow-wrap: anywhere; font-size: 13px; }
    .sl .tside .li .tm { white-space: normal; }
    .sl .trow .tm { font-size: 11px; }
    .sl .tkpis .v { font-size: 17px; }
    .sl .tbar { bottom: 4px; }
  }
  /* TRADE-CSS-END */
"""

SECTION = """  <!-- TRADE-SECTION-START -->
  <section id="trade" data-page="trade" hidden>
    <div class="explain">
      <p class="big"><b>Set up a trade between any two teams and see who it helps.</b></p>
      <p>Pick the two teams, tap the players each side sends, and the analysis runs on its own: League HQ value today, expected points for the rest of the regular season and the playoff weeks (byes and injury timelines included), playoff and title odds with and without the trade, roster fit by position, bench cover, roster spots, and the risk from injuries and week-to-week swings. <span class="muted" data-draw="tradeasof" data-source="managers"></span></p>
    </div>
    <div class="mt" data-draw="trade" data-source="managers"></div>
  </section>
  <!-- TRADE-SECTION-END -->

"""

TAB = '<button role="tab" data-tab="trade" aria-selected="false">Trade simulator 🔄</button>'


def strip(s, a, b):
    i = s.find(a)
    if i < 0: return s
    j = s.index(b, i) + len(b)
    return s[:i] + s[j:]


def main(src, data, js, dst):
    s = open(src).read()
    s = strip(s, "\n  /* TRADE-CSS-START */", "/* TRADE-CSS-END */")
    s = strip(s, "  <!-- TRADE-SECTION-START -->", "<!-- TRADE-SECTION-END -->\n\n")
    s = strip(s, "<script>/* TRADE-JS-START */", "/* TRADE-JS-END */</script>\n")
    s = s.replace("    " + TAB + "\n", "")
    # css: end of the main page stylesheet
    a = s.index("<style>\n  .sl {"); b = s.index("\n</style>", a)
    s = s[:b] + CSS.rstrip("\n") + s[b:]
    # tab after Team value
    anchor = '<button role="tab" data-tab="value" aria-selected="false">Team value 💰</button>\n'
    assert s.count(anchor) == 1
    s = s.replace(anchor, anchor + "    " + TAB + "\n")
    # section before Records
    anchor = "  <!-- ================= RECORDS ================= -->"
    assert s.count(anchor) == 1
    s = s.replace(anchor, SECTION + anchor)
    # data + code at the end
    payload = json.dumps(json.load(open(data)), separators=(",", ":")).replace("</", "<\\/")
    code = open(js).read()
    assert "</script" not in code
    block = f"<script>/* TRADE-JS-START */\nwindow.TRADE = {payload};\n{code}\n/* TRADE-JS-END */</script>\n"
    i = s.rindex("</body></html>")
    s = s[:i] + block + s[i:]
    # how-the-numbers-work note
    note = "      <li>The trade simulator re-runs the Playoff race model with and without the trade. Expected points blend League HQ value with Sleeper's weekly projections (rescored for this league), which also carry byes and injury return dates.</li>\n"
    s = s.replace(note, "")
    anchor = "      <li>Profile pictures are each manager's Sleeper avatar"
    assert s.count(anchor) == 1
    s = s.replace(anchor, note + anchor)
    open(dst, "w").write(s)
    print(f"wrote {dst} ({len(s) / 1e6:.2f} MB)")


if __name__ == "__main__":
    main(*sys.argv[1:5])
