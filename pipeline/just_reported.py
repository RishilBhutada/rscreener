"""Rscreener - the companies whose results have just come out, for the nightly
run to fetch FIRST.

The results and results-date fetches each come round to a company once a week
(--max-age-hours 168), so a company that reported on a Thursday could sit on
its old quarter for up to seven days: the calendar showed Anand Rathi Wealth's
Q1 growth on the row for its Q2 results. This lists every company whose results
board meeting fell in the last five days (fetch_events.py keeps meetings once
they pass) and whose new quarter is not in the database yet. The run fetches
those before the weekly rotation. A company drops off the list the night its
quarter arrives, so it is fetched once, not five nights running.

Writes data/just_reported_results.txt (new quarter missing from results_history)
and data/just_reported_dates.txt (missing from filing_dates), comma-separated.

Usage:  python just_reported.py
"""
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "rscreener.db"
OUT_RESULTS = ROOT / "data" / "just_reported_results.txt"
OUT_DATES = ROOT / "data" / "just_reported_dates.txt"
IST = timezone(timedelta(hours=5, minutes=30))
WINDOW_DAYS = 5


def quarter_before(day: str) -> str:
    """The quarter a results meeting on `day` reports: the last one to end before it."""
    y, m = int(day[:4]), int(day[5:7])
    return [f"{y - 1}-12-31", f"{y}-03-31", f"{y}-06-30", f"{y}-09-30"][(m - 1) // 3]


def main() -> None:
    today = datetime.now(IST).date()
    lo = (today - timedelta(days=WINDOW_DAYS)).isoformat()
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    nse_file = ROOT / "data" / "nse_symbols.txt"
    nse = {s for s in nse_file.read_text(encoding="utf-8").split(",") if s} if nse_file.exists() else set()
    need_results, need_dates = [], []
    if "calendar_events" in tables:
        # Today's meetings too: a run that starts before midnight IST finds
        # that evening's results already out.
        meetings = con.execute(
            "SELECT symbol, MAX(date) FROM calendar_events WHERE kind='meeting' AND lower(purpose) LIKE '%result%'"
            " AND date >= ? AND date <= ? GROUP BY symbol ORDER BY MAX(date) DESC",
            (lo, today.isoformat())).fetchall()
        for sym, day in meetings:
            if not sym or (nse and sym not in nse):
                continue
            q = quarter_before(day)
            if "results_history" in tables and not con.execute(
                    "SELECT 1 FROM results_history WHERE symbol=? AND period_type='quarterly' AND period_end >= ? LIMIT 1",
                    (sym, q)).fetchone():
                need_results.append(sym)
            if "filing_dates" in tables and not con.execute(
                    "SELECT 1 FROM filing_dates WHERE symbol=? AND period_end >= ? LIMIT 1", (sym, q)).fetchone():
                need_dates.append(sym)
    con.close()
    OUT_RESULTS.write_text(",".join(need_results), encoding="utf-8")
    OUT_DATES.write_text(",".join(need_dates), encoding="utf-8")
    print(f"just reported (results meeting {lo} to {today}): {len(need_results)} need their new quarter's "
          f"figures, {len(need_dates)} its results date")


if __name__ == "__main__":
    main()
