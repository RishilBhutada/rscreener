"""Rscreener - the US economy's history for the gold page, from FRED.

Inflation, jobs, rates, growth, the dollar and oil: the series in
macro_series.py, each with as much history as FRED holds, plus the NBER
recession months that shade the charts. One request per series returns its
whole history, so a run is about twenty-five calls - FRED allows 120 a minute.

The whole history is asked for every run, not just the newest month: the
agencies revise past figures (payrolls for two months and again each year,
GDP for years after), and FRED carries those revisions into old months.

A series' stored rows are replaced only by a good answer. A refusal, an empty
answer or a cut-short one is logged in macro_log and last night's rows stand.

Needs the FRED_API_KEY secret, read only by fetch_gold.fred(), which never
puts the URL - and with it the key - into an error. Without the key the
stored history is kept as it is.

Usage:  python fetch_macro.py
"""
import os
import sqlite3
from datetime import date, datetime, timezone
from pathlib import Path

import budget
import fetch_gold
from macro_series import ALL, Series

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "rscreener.db"
PERIOD_MONTHS = {"m": 1, "q": 3}


def connect() -> sqlite3.Connection:
    con = sqlite3.connect(DB, timeout=180)
    con.executescript("""
        CREATE TABLE IF NOT EXISTS macro_obs (series TEXT, date TEXT, value REAL, PRIMARY KEY (series, date));
        CREATE TABLE IF NOT EXISTS macro_log (series TEXT PRIMARY KEY, fetched_at TEXT, n INTEGER, error TEXT);
    """)
    return con


def ended(rows: list[tuple[str, float]], s: Series, today: date) -> list[tuple[str, float]]:
    """Only the periods that are over. A month FRED averages from daily or
    weekly readings is dated the 1st, and before the month ends it would be
    an average of the days so far - shown beside full months, a "monthly
    average" that is really a week's. Series FRED publishes monthly or
    quarterly themselves have no such row."""
    if not s.frequency:
        return rows
    step = PERIOD_MONTHS[s.frequency]
    keep = []
    for d, v in rows:
        m = int(d[5:7]) - 1 + step
        if date(int(d[:4]) + m // 12, m % 12 + 1, 1) <= today:  # the day after the period
            keep.append((d, v))
    return keep


def failed(con, s: Series, why: str) -> None:
    # fetched_at and n stay those of the last good read, so the export can
    # still say when FRED last answered.
    con.execute("INSERT INTO macro_log (series, error) VALUES (?,?) "
                "ON CONFLICT(series) DO UPDATE SET error=excluded.error", (s.id, why))
    con.commit()
    kept = con.execute("SELECT COUNT(*) FROM macro_obs WHERE series=?", (s.id,)).fetchone()[0]
    print(f"FRED macro: {s.fred} not refreshed ({why}) - "
          + (f"the stored {kept} readings stand" if kept else "nothing stored yet"))


def fetch(con, s: Series, today: date) -> bool:
    params = {"units": s.units}
    if s.frequency:
        params.update(frequency=s.frequency, aggregation_method=s.how)
    try:
        got = fetch_gold.fred("series/observations", series_id=s.fred, observation_start="1900-01-01", **params)
        obs, count, limit = got.get("observations") or [], got.get("count"), got.get("limit")
        rows = ended(fetch_gold.readings(obs), s, today)
    except RuntimeError as e:
        failed(con, s, str(e))  # fred()'s own message: the path and the status, never the URL
        return False
    except Exception as e:  # noqa: BLE001 - one series fails on its own
        # Only the type: a message from deeper in requests could quote the
        # URL, and the URL carries the key.
        failed(con, s, type(e).__name__)
        return False
    # FRED pages its answers at `limit` rows (100,000 unless asked). A full
    # page while FRED counts more means the history arrived in part, and a
    # partial history must not replace a whole one. Only a full page counts:
    # whether `count` is taken before or after FRED's monthly averaging is
    # not documented, and a daily series averaged to months must not look
    # cut short by its own day count.
    if isinstance(count, int) and isinstance(limit, int) and len(obs) >= limit and count > len(obs):
        failed(con, s, f"{len(obs)} of {count} observations")
        return False
    if not rows:
        failed(con, s, "no readings")
        return False
    con.execute("DELETE FROM macro_obs WHERE series=?", (s.id,))
    con.executemany("INSERT OR REPLACE INTO macro_obs VALUES (?,?,?)", [(s.id, d, v) for d, v in rows])
    con.execute("INSERT INTO macro_log VALUES (?,?,?,NULL) ON CONFLICT(series) DO UPDATE SET "
                "fetched_at=excluded.fetched_at, n=excluded.n, error=NULL",
                (s.id, datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), len(rows)))
    con.commit()
    what = {"monthly": "months", "quarterly": "quarters", "weekly": "weeks"}[s.freq]
    print(f"FRED macro: {s.fred} {len(rows)} {what} from {rows[0][0][:7]}")
    return True


def main() -> None:
    if not os.environ.get("FRED_API_KEY", "").strip():
        print("FRED macro: no FRED_API_KEY secret - the stored US economy history is kept as it is")
        return
    con = connect()
    today = datetime.now(timezone.utc).date()
    ok = 0
    for i, s in enumerate(ALL):
        if budget.stop(i, len(ALL), "FRED series"):
            break
        ok += fetch(con, s, today)
    con.close()
    print(f"FRED macro: {ok} of {len(ALL)} series refreshed")


if __name__ == "__main__":
    main()
