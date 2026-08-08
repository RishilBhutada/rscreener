"""Rscreener - a data-freshness report the app can show, at web/public/status.json.

Why this exists: the nightly job has run 24 times and mostly succeeded, but on
1-Aug-2026 it failed at the depth guard and nothing shipped. Nothing on the site
said so. A number with no visible provenance is a number you have to take on
faith, and the whole point of this app is not taking figures on faith.

So every source we hold reports three things: how many companies it covers, the
newest date in it, and how many companies are behind that newest date. Anything
that quietly stops refreshing shows up as a growing "behind" count instead of
silently ageing on the page.
"""
import json
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "rscreener.db"
OUT = ROOT / "web" / "public" / "status.json"

# Companies each source gets through per nightly run. These MUST track the --limit
# values in .github/workflows/nightly.yml; if they drift, the finish dates the app
# shows become a comforting fiction rather than arithmetic.
PER_NIGHT = {
    "prices": 2357,          # whole universe every night
    "snapshot": 2357,        # --all, no cap
    "results": 800,
    "filing_dates": 900,
    "shareholding": 700,
    "statements": 2357,      # refreshed with the snapshot
    "ipos": None,            # not a backlog - the whole list is rewritten nightly
}

# Where each source records that it has ASKED about a symbol. Without this the
# page cannot tell a company still waiting its turn from one the source simply
# has nothing for, and it counted both as work outstanding: "441 to do, 1 night
# -> tomorrow" for a figure that would still read 81% a year later, because 328
# of those companies file no shareholding pattern with NSE at all. A number that
# promises to become 100% and never does is worse than a smaller honest one.
# Sources built on NSE's filing endpoints. They cannot cover a company that is
# not listed on NSE, so scoring them against the whole 5,069-company universe
# invents a hole 2,700 wide: "Quarterly results 43%" when the real figure is 93%
# of every company the source is capable of reaching. A denominator that
# includes companies the source can never see is not a coverage measure, it is
# a measure of how many companies exist.
NSE_ONLY = {"results", "filing_dates", "shareholding"}

ASK_LOG = {
    "results": "results_fetch_log",
    "filing_dates": "filing_dates_log",
    "shareholding": "shp_fetch_log",
    "statements": "fetch_log",
    "snapshot": "fetch_log",
    "prices": "prices_fetch_log",
}


def _has(con, table: str) -> bool:
    return bool(con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone())


def _spread(con, sql: str, tolerance_days: int = 0) -> dict:
    """{covered, newest, behind, oldest} for a query returning (symbol, date) rows.

    `tolerance_days` exists because companies genuinely report on different dates.
    Judging a quarterly source by "is it on the very newest date any company has"
    would mark almost everything stale for an honest reason. A quarter is ~91 days,
    so a company more than a quarter behind the leader has actually stopped
    updating - which is exactly how 1,430 symbols sat on Dec-2024 earnings for
    nineteen months without anyone noticing.
    """
    rows = [(s, d) for s, d in con.execute(sql) if d]
    if not rows:
        return {"covered": 0, "newest": None, "behind": 0, "oldest": None}
    dates = [d for _, d in rows]
    newest = max(dates)
    if tolerance_days:
        cut = (datetime.strptime(newest, "%Y-%m-%d") - timedelta(days=tolerance_days)).strftime("%Y-%m-%d")
    else:
        cut = newest
    return {
        "covered": len(rows),
        "newest": newest,
        "behind": sum(1 for d in dates if d < cut),
        "oldest": min(dates),
    }


def main() -> None:
    con = sqlite3.connect(DB, timeout=180)
    universe = con.execute("SELECT COUNT(*) FROM universe").fetchone()[0]
    try:
        nse_universe = con.execute(
            "SELECT COUNT(*) FROM universe WHERE EXCHANGE='NSE' OR EXCHANGE IS NULL"
        ).fetchone()[0]
    except Exception:  # noqa: BLE001 - a database from before the column existed
        nse_universe = universe
    sources = []

    sources.append({
        "key": "prices",
            "_have_sql": "SELECT DISTINCT symbol FROM prices",
        "name": "Share prices",
        "what": "Daily closes from the exchange feed. Drives every price, market cap and ratio.",
        **_spread(con, "SELECT symbol, MAX(date) FROM prices WHERE freq='daily' GROUP BY symbol"),
        "cadence": "every night",
    })

    sources.append({
        "key": "snapshot",
            "_have_sql": "SELECT symbol FROM fundamentals WHERE price IS NOT NULL",
        "name": "Company snapshot",
        "what": "P/E, book value, 52-week range and the rest of the screener columns.",
        # Three days, not zero. The fetcher skips anything done within 20 hours,
        # so a symbol carrying yesterday's date is working exactly as intended.
        # At zero tolerance, re-fetching 49 symbols by hand made the other 2,313
        # read as stale and the source dropped from 98% to 2% - the measurement
        # moving, not the data.
        **_spread(con, "SELECT symbol, substr(fetch_date,1,10) FROM fundamentals", 3),
        "cadence": "every night",
    })

    if _has(con, "results_history"):
        sources.append({
            "key": "results",
            "_have_sql": "SELECT DISTINCT symbol FROM results_history WHERE period_type='quarterly'",
            "name": "Quarterly results (as filed)",
            "what": "Earnings straight from the NSE filings. Everything on the P/E chart rests on these.",
            **_spread(con, "SELECT symbol, MAX(period_end) FROM results_history "
                           "WHERE period_type='quarterly' GROUP BY symbol", 120),
            "cadence": "every night, 800 companies a night",
        })

    if _has(con, "filing_dates"):
        sources.append({
            "key": "filing_dates",
            "_have_sql": "SELECT DISTINCT symbol FROM filing_dates",
            "name": "Result declaration dates",
            "what": "When each set of results was actually published, so ratios step on the day the market learned them.",
            **_spread(con, "SELECT symbol, MAX(announced_on) FROM filing_dates GROUP BY symbol", 120),
            "cadence": "every night, 900 companies a night",
        })

    if _has(con, "shareholding"):
        sources.append({
            "key": "shareholding",
            "_have_sql": "SELECT DISTINCT symbol FROM shareholding",
            "name": "Shareholding pattern",
            "what": "Promoter, public and employee-trust holdings each quarter.",
            **_spread(con, "SELECT symbol, MAX(date) FROM shareholding GROUP BY symbol", 120),
            "cadence": "weekly rotation",
        })

    if _has(con, "statements"):
        sources.append({
            "key": "statements",
            "_have_sql": "SELECT DISTINCT symbol FROM statements WHERE stmt_type='balance'",
            "name": "Balance sheet & cash flow",
            "what": "Annual statements behind Price/Book and EV/EBITDA.",
            **_spread(con, "SELECT symbol, MAX(period_end) FROM statements "
                           "WHERE stmt_type='balance' GROUP BY symbol", 400),
            "cadence": "with the snapshot",
        })

    if _has(con, "ipos"):
        sources.append({
            "key": "ipos",
            "name": "IPOs",
            "what": "Open, upcoming and recently listed issues.",
            **_spread(con, "SELECT symbol, MAX(substr(updated_at,1,10)) FROM ipos GROUP BY symbol"),
            "cadence": "every night",
            # IPOs are their own population, not a subset of the listed universe -
            # scoring 1,337 issues out of 2,357 companies would invent a 43% hole
            "own_population": True,
        })

    for s in sources:
        s["current"] = s["covered"] - s["behind"]
        if s.get("own_population"):
            s["universe"] = s["covered"]
        elif s["key"] in NSE_ONLY:
            s["universe"] = nse_universe
            s["scope"] = "NSE-listed companies"
        else:
            s["universe"] = int(universe)
        s["per_night"] = PER_NIGHT.get(s["key"])
        # Measured against the WHOLE universe, not against what happens to be
        # covered. Dividing by `covered` let a source with 23 companies fetched out
        # of 2,357 report "96% up to date" - true of the 23, useless to a reader,
        # and precisely the kind of flattering-but-hollow number this page exists
        # to kill. Missing data is a form of stale data.
        denom = s["universe"] or 1
        s["pct"] = round(s["current"] / denom * 100)
        s["missing"] = max(0, denom - s["covered"])

        # Split the shortfall into the part that is still coming and the part
        # that never will. A company NSE holds no shareholding pattern for has
        # been asked about and answered; counting it as backlog turns an honest
        # ceiling into a promise the page cannot keep.
        s["unavailable"] = 0
        log = ASK_LOG.get(s["key"])
        if log and not s.get("own_population") and _has(con, log):
            # Any symbol we have ASKED about, error or not. An error of
            # "unknown to Yahoo or delisted" is an answer - 328 BSE scrips are
            # dormant shells with no quote at all - and counting them as backlog
            # promises work that will never produce anything.
            asked = {r[0] for r in con.execute(f"SELECT symbol FROM {log}")}
            have = {r[0] for r in con.execute(s["_have_sql"])} if s.get("_have_sql") else set()
            s["unavailable"] = len(asked - have)
        s.pop("_have_sql", None)

        # Nights to reach the ceiling, and the date that lands on. Stated as
        # arithmetic the reader can check - outstanding work divided by
        # throughput - rather than a progress bar that only ever says "soon".
        todo = max(0, s["behind"] + s["missing"] - s["unavailable"])
        rate = s["per_night"]
        if todo == 0:
            s["nights_left"], s["eta"] = 0, None
        elif rate:
            nights = max(1, -(-todo // rate))          # ceiling division
            s["nights_left"] = nights
            s["eta"] = (datetime.now(timezone.utc) + timedelta(days=nights)).strftime("%Y-%m-%d")
        else:
            s["nights_left"], s["eta"] = None, None

    payload = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "universe": int(universe),
        "sources": sources,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=1), encoding="utf-8")
    print(f"status -> {OUT}")
    for s in sources:
        eta = "complete" if s["nights_left"] == 0 else (
            f"{s['nights_left']} night(s) -> {s['eta']}" if s["nights_left"] else "no schedule")
        gap = s["behind"] + s["missing"]
        un = s.get("unavailable", 0)
        note = f" ({un} the source has none for)" if un else ""
        print(f"  {s['name']:30} {s['pct']:>3}%  {gap - un:>4} to fetch{note:<28} {eta}")
    con.close()


if __name__ == "__main__":
    main()
