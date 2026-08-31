"""Fails the build when the prices we are about to publish are stale or inconsistent.

Why this exists: `fundamentals` is a point-in-time snapshot. Nothing in the old
pipeline forced it to be re-fetched before an export, so a snapshot taken on
10-Jul shipped unchanged for weeks. HDFC Bank showed Rs 824.95 against a real
Rs 750.35; MTAR Tech showed Rs 7,101 against Rs 5,194 - 27% out. The page had no
way to signal that, because a wrong price looks exactly like a right one.

Three things are checked, each of which has actually broken:
  1. AGE      - the newest close in the export is older than MAX_AGE_DAYS.
  2. SPREAD   - too many companies are carrying a price older than the market.
  3. ARITHMETIC - price x shares still equals the market cap we display.

                NOT a staleness check, whatever it once claimed. shares_out is
                DEFINED in the export as market_cap / price on the same row, so
                a market cap left behind by a refreshed price reconciles
                perfectly: p x (m/p) = m holds however stale either number is.
                What it does catch is our own rescaling - a crore/rupee mix-up,
                a row assembled from two different snapshots. Worth keeping,
                and worth not being believed to do more than it does.
                Staleness is caught by 1 and 2, which compare against the
                calendar and against the other companies.

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
# A partial refresh is normal now that fetching stops at a deadline, so the bar
# is "how much of the universe has fallen genuinely out of date", not "how much
# differs from the freshest row". 25% allows a run that got through most of the
# universe; a stopped fetcher passes it within a week.
MAX_BEHIND_PCT = 25.0
# Trading days in the last 30 before a company is expected to have today's close.
# 15 of ~21 sessions: traded on most days, so a missing close is not the market's
# doing. Deliberately not higher - the point is to keep the guard sharp, not to
# excuse companies out of it.
MIN_BARS_30 = 15     # % of companies allowed to lag the newest bar in the file
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
    # Measured over companies that ACTUALLY TRADE. A daily bar exists only for a
    # day on which a trade happened, so a lagging price date means "nobody bought
    # this" at least as often as it means "the fetcher is broken" - and until BSE
    # was added those were indistinguishable, because every NSE company of any
    # size trades daily. 0.1% of NSE companies lag the newest close against 7.4%
    # of the BSE scrips, none of it a fetching failure. Judged together, 5,000
    # companies would have sat permanently above the 2% limit and no export could
    # ever have published again.
    #
    # A company that traded on most of the last 30 days and STILL has an old
    # price is the real signal, and it is the one a broken fetcher trips: when
    # the pipeline stops, the liquid names stop with it.
    # Measured against TODAY, not against the freshest company in the file.
    #
    # It used to compare each company with the newest close ANY company held,
    # which makes a single outlier decide the whole result: one symbol re-fetched
    # by hand carried a bar from 26-Aug while 4,727 companies sat correctly on
    # 7-Aug, and the guard reported 0% current and would have failed the build.
    # Worse, fetching now stops at a deadline, so a PARTIAL price refresh is the
    # normal healthy state - half the universe on today's close and half on
    # yesterday's is a run working exactly as designed. Judged against each
    # other, that reads as a catastrophe every single night.
    #
    # The question worth asking is not "is this company behind its freshest
    # peer" but "is the price we are publishing recent enough to trust". So:
    # age against today, in trading days, and the MEDIAN company has to be
    # current. A median cannot be moved by an outlier, and a fetcher that has
    # genuinely stopped drags it past the limit within a few days.
    def liquid(c):
        n = c.get("bars30")
        return n is None or n >= MIN_BARS_30   # unknown -> judged, not excused

    tradeable = [c for c in rows if liquid(c)]
    ages = sorted(trading_days_old(c["price_date"]) for c in tradeable if c.get("price_date"))
    undated = [c for c in rows if not c.get("price_date")]
    upct = len(undated) / len(rows) * 100 if rows else 0
    med_age = ages[len(ages) // 2] if ages else 999
    behind = [c for c in tradeable
              if c.get("price_date") and trading_days_old(c["price_date"]) > MAX_AGE_DAYS]
    pct = len(behind) / len(tradeable) * 100 if tradeable else 0
    print(f"regularly traded:        {len(tradeable)} of {len(rows)} "
          f"(>= {MIN_BARS_30} trading days in the last 30)")
    print(f"median price age:        {med_age} trading day(s) old")
    print(f"older than {MAX_AGE_DAYS} days:      {len(behind)} of {len(tradeable)} ({pct:.1f}%)")
    print(f"no price series at all:  {len(undated)} of {len(rows)} ({upct:.1f}%)")
    if med_age > MAX_AGE_DAYS:
        fails.append(f"the median company's price is {med_age} trading days old "
                     f"(limit {MAX_AGE_DAYS}) - prices have stopped refreshing")
    if pct > MAX_BEHIND_PCT:
        worst = ", ".join(c.get("symbol", "?") for c in behind[:6])
        fails.append(f"{pct:.1f}% of regularly traded companies are more than {MAX_AGE_DAYS} "
                     f"trading days old (limit {MAX_BEHIND_PCT}%): {worst} ...")
    if upct > MAX_UNDATED_PCT:
        fails.append(f"{upct:.1f}% of companies have no price series (limit {MAX_UNDATED_PCT}%) - fetch_prices.py is failing")

    # 3. price x shares must still reconcile with the market cap on the same row.
    #    An identity, not a corroboration - see the note at the top of this file.
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
        print("\nprices OK - fresh, the spread is sane, and the export's own arithmetic reconciles")
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
