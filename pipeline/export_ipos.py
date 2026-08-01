"""Exports the IPO page payload -> web/public/ipos.json.

Official NSE data (issues, live subscription, realised listing gains) is kept
separate in the payload from the unofficial grey-market layer, so the UI can
label them differently and never imply GMP is exchange data.
"""
import json
import math
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from ipo_lib import gmp_scoreboard, listing_gains

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "rscreener.db"
OUT = ROOT / "web" / "public" / "ipos.json"
RECENT_N = 60


def clean_nan(o):
    if isinstance(o, float):
        return o if math.isfinite(o) else None
    if isinstance(o, dict):
        return {k: clean_nan(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean_nan(v) for v in o]
    return o


def table_exists(con, name: str) -> bool:
    return bool(con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (name,)).fetchone())


def main() -> None:
    con = sqlite3.connect(DB, timeout=180)
    con.row_factory = sqlite3.Row
    if not table_exists(con, "ipos"):
        print("ipos table missing - run fetch_ipos.py first")
        return

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    # latest subscription snapshot per (symbol, category)
    subs: dict[str, list[dict]] = {}
    if table_exists(con, "ipo_subscription"):
        for r in con.execute(
            "SELECT symbol, category, times_subscribed, shares_offered, shares_bid, snapshot_date "
            "FROM ipo_subscription WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM ipo_subscription)"
        ):
            subs.setdefault(r["symbol"], []).append({
                "category": r["category"], "times": r["times_subscribed"],
                "offered": r["shares_offered"], "bid": r["shares_bid"], "as_of": r["snapshot_date"],
            })

    def issues(phase: str) -> list[dict]:
        out = []
        for r in con.execute(
            "SELECT symbol, company, issue_start, issue_end, price_band, issue_size, status, security_type "
            "FROM ipos WHERE phase=? ORDER BY issue_start DESC", (phase,)
        ):
            st = str(r["security_type"] or "").upper()
            out.append({
                "symbol": r["symbol"], "company": r["company"],
                "open": r["issue_start"], "close": r["issue_end"],
                "band": r["price_band"], "size": r["issue_size"], "status": r["status"],
                "segment": "SME" if st.startswith("SM") else "Mainboard",
                "subscription": subs.get(r["symbol"], []),
            })
        return out

    gains = listing_gains(con)
    listed = [g for g in gains.values() if g["listing_gain_pct"] is not None]
    listed.sort(key=lambda g: g["listing_date"] or "", reverse=True)

    pos = [g for g in listed if g["listing_gain_pct"] > 0]
    stats = {
        "n": len(listed),
        "excluded": sum(1 for g in gains.values() if str(g.get("basis") or "").startswith("excluded")),
        "positive_pct": round(len(pos) / len(listed) * 100, 1) if listed else None,
        "avg_gain_pct": round(sum(g["listing_gain_pct"] for g in listed) / len(listed), 2) if listed else None,
        "median_gain_pct": (
            round(sorted(g["listing_gain_pct"] for g in listed)[len(listed) // 2], 2) if listed else None
        ),
    }

    gmp_live = []
    gmp_as_of = None
    if table_exists(con, "gmp_history"):
        row = con.execute("SELECT MAX(snapshot_date) d FROM gmp_history").fetchone()
        gmp_as_of = row["d"] if row else None
        if gmp_as_of:
            for r in con.execute(
                "SELECT ipo_name, gmp, price, est_listing, est_gain_pct, ipo_dates, ipo_type, status, "
                "source_updated, source FROM gmp_history WHERE snapshot_date=? "
                "ORDER BY (gmp IS NULL), gmp DESC", (gmp_as_of,)
            ):
                gmp_live.append(dict(r))

    payload = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "today": today,
        "current": issues("current"),
        "upcoming": issues("upcoming"),
        "recent": listed[:RECENT_N],
        "listing_stats": stats,
        "gmp": {"as_of": gmp_as_of, "source": "ipowatch.in", "rows": gmp_live},
        "gmp_scoreboard": gmp_scoreboard(con, gains),
    }
    con.close()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(clean_nan(payload), ensure_ascii=False, allow_nan=False), encoding="utf-8")
    kb = OUT.stat().st_size / 1024
    print(
        f"ipos.json: {len(payload['current'])} open, {len(payload['upcoming'])} upcoming, "
        f"{len(payload['recent'])} recent listings, {len(gmp_live)} GMP rows, "
        f"{len(payload['gmp_scoreboard']['rows'])} scored -> {kb:.0f} KB"
    )


if __name__ == "__main__":
    main()
