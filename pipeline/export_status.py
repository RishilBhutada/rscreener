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
    sources = []

    sources.append({
        "key": "prices",
        "name": "Share prices",
        "what": "Daily closes from the exchange feed. Drives every price, market cap and ratio.",
        **_spread(con, "SELECT symbol, MAX(date) FROM prices WHERE freq='daily' GROUP BY symbol"),
        "cadence": "every night",
    })

    sources.append({
        "key": "snapshot",
        "name": "Company snapshot",
        "what": "P/E, book value, 52-week range and the rest of the screener columns.",
        **_spread(con, "SELECT symbol, substr(fetch_date,1,10) FROM fundamentals"),
        "cadence": "every night",
    })

    if _has(con, "results_history"):
        sources.append({
            "key": "results",
            "name": "Quarterly results (as filed)",
            "what": "Earnings straight from the NSE filings. Everything on the P/E chart rests on these.",
            **_spread(con, "SELECT symbol, MAX(period_end) FROM results_history "
                           "WHERE period_type='quarterly' GROUP BY symbol", 120),
            "cadence": "every night, 800 companies a night",
        })

    if _has(con, "filing_dates"):
        sources.append({
            "key": "filing_dates",
            "name": "Result declaration dates",
            "what": "When each set of results was actually published, so ratios step on the day the market learned them.",
            **_spread(con, "SELECT symbol, MAX(announced_on) FROM filing_dates GROUP BY symbol", 120),
            "cadence": "every night, 900 companies a night",
        })

    if _has(con, "shareholding"):
        sources.append({
            "key": "shareholding",
            "name": "Shareholding pattern",
            "what": "Promoter, public and employee-trust holdings each quarter.",
            **_spread(con, "SELECT symbol, MAX(date) FROM shareholding GROUP BY symbol", 120),
            "cadence": "weekly rotation",
        })

    if _has(con, "statements"):
        sources.append({
            "key": "statements",
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
        s["universe"] = s["covered"] if s.get("own_population") else int(universe)
        # Measured against the WHOLE universe, not against what happens to be
        # covered. Dividing by `covered` let a source with 23 companies fetched out
        # of 2,357 report "96% up to date" - true of the 23, useless to a reader,
        # and precisely the kind of flattering-but-hollow number this page exists
        # to kill. Missing data is a form of stale data.
        denom = s["universe"] or 1
        s["pct"] = round(s["current"] / denom * 100)
        s["missing"] = max(0, denom - s["covered"])

    payload = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "universe": int(universe),
        "sources": sources,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=1), encoding="utf-8")
    print(f"status -> {OUT}")
    for s in sources:
        print(f"  {s['name']:30} {s['current']:>5}/{s['covered']:<5} current ({s['pct']:>3}%)  newest {s['newest']}")
    con.close()


if __name__ == "__main__":
    main()
