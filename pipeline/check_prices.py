"""Fails the build when the prices we are about to publish are stale or inconsistent.

Why this exists: `fundamentals` is a point-in-time snapshot. Nothing in the old
pipeline forced it to be re-fetched before an export, so a snapshot taken on
10-Jul shipped unchanged for weeks. HDFC Bank showed Rs 824.95 against a real
Rs 750.35; MTAR Tech showed Rs 7,101 against Rs 5,194 - 27% out. The page had no
way to signal that, because a wrong price looks exactly like a right one.

Three things are checked, each of which has actually broken:
  1. AGE      - the newest close in the export is older than MAX_AGE_DAYS.
  2. SPREAD   - too many companies are carrying a price older than the market.
  3. IDENTITY - price x shares no longer equals the market cap we display, which
                means one of the two was refreshed without the other.

Usage:
  python check_prices.py           # verify what is in web/public/data.json
  python check_prices.py --lenient # warn instead of failing (local iteration)
"""
import argparse
import json
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "web" / "public" / "data.json"

MAX_AGE_DAYS = 6        # covers a long weekend plus a public holiday
MAX_STALE_PCT = 2.0     # % of companies allowed to lag the newest bar in the file
MAX_UNDATED_PCT = 20.0  # % with no price series at all (delisted/renamed tickers)
MCAP_TOL = 0.02         # price x shares vs published mcap


def trading_days_old(d: str) -> int:
    """Calendar age, less weekends - a Monday export off Friday's close is 0 days old."""
    try:
        then = datetime.strptime(d[:10], "%Y-%m-%d").date()
    except ValueError:
        return 999
    n, cur = 0, then
    while cur < date.today():
        cur += timedelta(days=1)
        if cur.weekday() < 5:
            n += 1
    return n


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lenient", action="store_true", help="report problems without failing")
    args = ap.parse_args()

    if not DATA.exists():
        raise SystemExit(f"no export at {DATA} - run export_json.py first")
    blob = json.loads(DATA.read_text(encoding="utf-8"))
    rows = blob.get("companies") or blob.get("rows") or []
    # Deliberately NOT falling back to generated_at: that is when the file was
    # built, not the session the prices belong to, and treating one as the other
    # is the confusion this whole guard exists to catch.
    asof = blob.get("price_asof") or ""
    fails: list[str] = []

    # 1. age of the newest price in the file
    age = trading_days_old(asof)
    print(f"price as-of: {asof or '(not recorded)'}  ->  {age} trading day(s) old")
    if not asof:
        fails.append("the export does not record a price as-of date, so staleness cannot be detected")
    elif age > MAX_AGE_DAYS:
        fails.append(f"newest price is {age} trading days old (limit {MAX_AGE_DAYS}) - refresh prices before exporting")

    # 2. how many companies lag the newest close in the file, and how many are undated.
    # Derived here rather than trusted from a flag in the file - a guard that reads
    # the exporter's own opinion of its output cannot catch the exporter being wrong.
    stale = [c for c in rows if c.get("price_date") and asof and c["price_date"] < asof]
    undated = [c for c in rows if not c.get("price_date")]
    pct = len(stale) / len(rows) * 100 if rows else 0
    upct = len(undated) / len(rows) * 100 if rows else 0
    print(f"behind the newest close: {len(stale)} of {len(rows)} ({pct:.1f}%)")
    print(f"no price series at all:  {len(undated)} of {len(rows)} ({upct:.1f}%)")
    if pct > MAX_STALE_PCT:
        worst = ", ".join(c.get("symbol", "?") for c in stale[:6])
        fails.append(f"{pct:.1f}% of companies lag the newest close (limit {MAX_STALE_PCT}%): {worst} ...")
    if upct > MAX_UNDATED_PCT:
        fails.append(f"{upct:.1f}% of companies have no price series (limit {MAX_UNDATED_PCT}%) - fetch_prices.py is failing")

    # 3. price x shares must still reconcile with the market cap on the same row
    broken = []
    for c in rows:
        p, m, sh = c.get("price"), c.get("mcap"), c.get("shares_out")
        if not (p and m and sh):
            continue
        implied = p * sh / 1e7          # shares x price -> Rs crore
        if implied and abs(implied - m) / m > MCAP_TOL:
            broken.append(c.get("symbol", "?"))
    print(f"price x shares vs mcap mismatches: {len(broken)}")
    if len(broken) > len(rows) * 0.02:
        fails.append(f"{len(broken)} rows where price x shares != market cap: {', '.join(broken[:6])} ...")

    if not fails:
        print("\nprices OK - fresh, consistent, and reconciling with market cap")
        return
    print("\nPRICE CHECK FAILED:")
    for f in fails:
        print(f"  ! {f}")
    print(
        "\nA wrong price is indistinguishable from a right one on screen, which is why\n"
        "this fails the build rather than warning. Re-run fetch_prices.py (and\n"
        "fetch_fundamentals.py --snapshot-only) before exporting."
    )
    if not args.lenient:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
