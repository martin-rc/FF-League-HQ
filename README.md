# FF League HQ

League history dashboard for the 🅱️🅱️ FF Sleeper league, in the same style as League HQ (basketball).
`index.html` is self-contained: data, avatars and headshots are inlined, so it works as a GitHub Pages site.

Built from Sleeper's public API (league and player IDs only). Data through week 8 of the 2026 season.

## Trade simulator tab

Pick two teams, tap the players each side sends, and the page grades the trade for both sides: League HQ value,
expected points for the rest of the regular season and the playoff weeks (byes and injury return dates from
Sleeper's projections), playoff and title odds with and without the trade (same model as the Playoff race tab,
on shared random draws), roster fit by position, bench cover, roster limits, and injury/variance risk.
Everything runs in the browser. Rebuild it (scripts in `tools/trade`, run next to the league toolkit's
`scoring.py`, `analyze.py` and `matchup_helper.py`):

    python3 -I trade_fetch.py data 1400789321346236416
    python3 -I trade_data.py data index.html trade.json
    python3 -I trade_tab.py index.html trade.json trade_tab.js index.html
