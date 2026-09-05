"""One score for how good the data is, recomputed after every change.

The owner's complaint, and it was fair: "the data is not reliable at all, it is
wrong in many places and absent too". There was no way to tell whether that was
getting better or worse, because every number about quality lived in a chat
message or a passing log line. A thing nobody measures is a thing nobody can
tell is improving.

Four dimensions, because "is the data good" is four different questions:

  COMPLETE   is the figure there at all?
  CORRECT    when it is there, does a second source or an arithmetic identity
             agree with it?
  FRESH      does it describe today or last month?
  DEEP       how far back does the history reach?

CORRECT is the one that matters and the one usually faked. It is not a
self-assessment: every check here compares two things that were produced
independently, and reports how often they disagree. Filed profit against the
provider's profit. Price times share count against published market cap. A
company's own filed series against its neighbours. A number this file cannot
check does not score - it is reported as unmeasured rather than assumed right.

Every run appends to scorecard_history.json, so the effect of a change is
visible as a movement rather than a claim.

  python pipeline/scorecard.py            # measure, print, append history
  python pipeline/scorecard.py --quiet    # just the score
"""
import argparse
import json
import math
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "rscreener.db"
DATA_JSON = ROOT / "web" / "public" / "data.json"
COMPANIES = ROOT / "web" / "public" / "companies"
HISTORY = ROOT / "pipeline" / "scorecard_history.json"
OUT = ROOT / "web" / "public" / "scorecard.json"

# A metric is only worth scoring if a reader would notice it missing. These are
# the fields the screener and the company page actually put on screen.
CORE_FIELDS = [
    ("price", "Price"),
    ("mcap", "Market cap"),
    ("pe", "P/E"),
    ("book_value", "Book value"),
    ("roe", "ROE"),
    ("roce", "ROCE"),
    ("de", "Debt / equity"),
    ("sales_cagr_5y", "5-year sales growth"),
    ("profit_cagr_5y", "5-year profit growth"),
    ("promoter_holding", "Promoter holding"),
]


def pct(n: int, d: int) -> float | None:
    return None if not d else round(100.0 * n / d, 1)


def eligible(con: sqlite3.Connection, rows: list[dict]) -> dict[str, set]:
    """Who CAN have each field, as opposed to who does.

    The score could never reach 100 and the reason was this function's absence.
    Completeness divided by the whole universe, so promoter holding was measured
    against 2,700 companies listed only on BSE - whose shareholding pattern is
    filed with an exchange this app does not read, and never will be present -
    and five-year growth was measured against 854 companies that listed less
    than five years ago. Those are not gaps. Counting them as gaps produced a
    permanent, unfixable deficit that buried the part which IS fixable: on the
    last run, twenty-five companies.

    A score that cannot reach its own maximum is not a measurement, it is a
    mood. Each field is now measured against the companies for which the figure
    can exist at all, and what cannot exist is reported separately as reach.
    """
    listed: dict[str, datetime] = {}
    try:
        for s, d in con.execute('SELECT SYMBOL, "DATE OF LISTING" FROM universe'):
            if not d:
                continue
            for fmt in ("%d-%b-%Y", "%Y-%m-%d"):
                try:
                    listed[s] = datetime.strptime(d, fmt); break
                except ValueError:
                    continue
    except Exception:  # noqa: BLE001 - an older database without the column
        pass

    now = datetime.now()
    everyone = {r["symbol"] for r in rows}
    nse = {r["symbol"] for r in rows if (r.get("exchange") or "NSE") == "NSE"}

    def listed_at_least(years: int) -> set:
        # No listing date on file means no evidence it is too young; it stays in
        # the denominator rather than being quietly excused.
        return {s for s in everyone
                if s not in listed or (now - listed[s]).days >= years * 365}

    old_enough = listed_at_least(6)
    # A P/E needs positive trailing earnings. A loss-making company has no P/E,
    # and printing one would be the fault this app exists to avoid - so it is
    # not a hole in the data either.
    earning = {r["symbol"] for r in rows
               if isinstance(r.get("net_income"), (int, float)) and r["net_income"] > 0}

    return {
        "price": everyone,
        "mcap": everyone,
        "pe": earning,
        "book_value": everyone,
        "roe": everyone,
        "roce": everyone,
        "de": everyone,
        "sales_cagr_5y": old_enough,
        "profit_cagr_5y": old_enough,
        # Shareholding comes from NSE's filing archive. For a BSE-only company
        # it is not missing; it is somewhere this app does not read.
        "promoter_holding": nse,
    }


def completeness(con: sqlite3.Connection, rows: list[dict]) -> dict:
    """How much of what CAN be filled in, is."""
    n = len(rows)
    can = eligible(con, rows)
    per_field, reach = {}, {}
    for key, label in CORE_FIELDS:
        pool = can.get(key, {r["symbol"] for r in rows})
        have = sum(1 for r in rows if r["symbol"] in pool and r.get(key) is not None)
        per_field[label] = pct(have, len(pool))
        # Stated, never silently excluded: how much of the universe the figure
        # can apply to at all.
        reach[label] = {"eligible": len(pool), "of": n, "pct": pct(len(pool), n)}
    filled = [v for v in per_field.values() if v is not None]
    return {
        "score": round(sum(filled) / len(filled), 1) if filled else None,
        "companies": n,
        "fields": per_field,
        "reach": reach,
    }


def correctness(con: sqlite3.Connection, rows: list[dict]) -> dict:
    """Agreement between things produced independently of each other.

    Nothing here is an opinion about the data. Each check takes two figures that
    came from different places and asks whether they say the same thing.
    """
    checks: dict[str, dict] = {}

    # 1. Filed profit vs the provider's profit, same company, same period end.
    #    Different source, different code path, ~3,600 overlapping years.
    filed = {}
    for s, p, v in con.execute(
        "SELECT symbol, period_end, MAX(CASE WHEN item='pat' THEN value END) "
        "FROM results_history WHERE period_type='annual' AND item='pat' "
        "GROUP BY symbol, period_end"
    ):
        if v:
            filed[(s, p)] = v
    other = {
        (s, p): v for s, p, v in con.execute(
            "SELECT symbol, period_end, value FROM statements WHERE stmt_type='income' "
            "AND item='Net Income Common Stockholders' AND period_type='annual' "
            "AND value IS NOT NULL"
        ) if v
    }
    both = [k for k in filed.keys() & other.keys()]
    # The ratio is taken WITHOUT abs(). With it, a filed profit of +50 crore
    # against a provider's -50 crore scored as agreement, which is the one
    # disagreement that matters most: the two sources cannot even agree whether
    # the company made money. 13 opposite-sign pairs exist in the overlap and 2
    # of them were being counted as corroboration.
    agree = sum(1 for k in both if 0.8 <= (other[k] / filed[k]) <= 1.25)
    checks["Filed profit vs the data provider"] = {
        "measured": len(both), "agree": agree, "pct": pct(agree, len(both)),
        "what": "the same company-year from the NSE filing and from the market-data provider, within 25%",
    }

    # 2. Filed REVENUE against the provider's revenue - a second independent
    #    pair, on a different line of the accounts from check 1.
    #
    #    This slot used to hold "price x shares = market cap", which scored
    #    99.8% and could not have done otherwise: shares_out is DEFINED in the
    #    export as market_cap / price, so the check was p x (m/p) = m. A
    #    tautology dressed as corroboration, inflating the one score on this
    #    page that claims to be measured rather than asserted.
    filed_rev = {}
    for s, pe, v in con.execute(
        "SELECT symbol, period_end, MAX(CASE WHEN item='revenue' THEN value END) "
        "FROM results_history WHERE period_type='annual' AND item='revenue' "
        "GROUP BY symbol, period_end"
    ):
        if v:
            filed_rev[(s, pe)] = v
    prov_rev = {
        (s, pe): v for s, pe, v in con.execute(
            "SELECT symbol, period_end, value FROM statements WHERE stmt_type='income' "
            "AND item='Total Revenue' AND period_type='annual' AND value IS NOT NULL"
        ) if v
    }
    rboth = list(filed_rev.keys() & prov_rev.keys())
    ragree = sum(1 for k in rboth if 0.8 <= abs(prov_rev[k] / filed_rev[k]) <= 1.25)
    checks["Filed revenue vs the data provider"] = {
        "measured": len(rboth), "agree": ragree, "pct": pct(ragree, len(rboth)),
        "what": "the same company-year's revenue from the NSE filing and from the provider, within 25%",
    }

    # 3. A filed figure against that company's OWN neighbouring years - the test
    #    that catches a decimal in the wrong place.
    from statistics import median
    seq: dict[str, list] = {}
    for s, p, v in con.execute(
        "SELECT symbol, period_end, MAX(CASE WHEN item='pat' THEN value END) "
        "FROM results_history WHERE period_type='annual' AND item='pat' "
        "GROUP BY symbol, period_end ORDER BY symbol, period_end"
    ):
        if v:
            seq.setdefault(s, []).append(abs(v))
    scale_n = scale_ok = 0
    for s, vals in seq.items():
        if len(vals) < 3:
            continue
        med = median(vals)
        if not med:
            continue
        for v in vals:
            scale_n += 1
            # 0.02x-50x was so wide that only a ~100x unit error could fail it.
            # A single year misparsed 10x - a dropped decimal, thousands read as
            # lakhs - sat at 10 and was counted as agreement, which is precisely
            # the error this check exists to catch. A real company moving 20x
            # against its own multi-year median in one year is rare; a 10x
            # parse error is not.
            if 0.05 <= v / med <= 20:
                scale_ok += 1
    checks["Filed figures against their own history"] = {
        "measured": scale_n, "agree": scale_ok, "pct": pct(scale_ok, scale_n),
        "what": "each filed year within a sane multiple of that company's own median - catches a misread unit",
    }

    # 4. Ratios that must be internally consistent: P/E from price and EPS.
    pe_n = pe_ok = 0
    for r in rows:
        pe, p, bv, pb = r.get("pe"), r.get("price"), r.get("book_value"), r.get("pb")
        if not (pb and p and bv and bv > 0):
            continue
        pe_n += 1
        if abs(p / bv - pb) / pb <= 0.05:
            pe_ok += 1
    internal = {
        "Price / book value = published P/B": {
            "measured": pe_n, "agree": pe_ok, "pct": pct(pe_ok, pe_n),
            "what": "an internal identity - both sides come from the same provider, so it "
                    "catches OUR rescaling mistakes but corroborates nothing",
        }
    }

    # Only CORROBORATION scores. An identity between two fields from the same
    # source cannot tell you the source is right; it can only tell you this
    # pipeline did not mangle it in transit. Both are worth knowing and they are
    # not the same thing, so they are reported apart and only one is counted.
    scored = [c["pct"] for c in checks.values() if c["pct"] is not None]
    # 4. The balance sheet must balance: assets = liabilities + equity.
    #
    #    An identity the company itself has to satisfy, so any failure is a
    #    parsing or scaling fault on our side rather than a difference of
    #    opinion between sources. It has to include MINORITY INTEREST: the first
    #    version of this check compared against shareholders' equity alone and
    #    accused 1,454 company-years, every one of which was a group with
    #    subsidiaries doing nothing wrong. Written down because a check that
    #    fails 7.6% of the time is usually testing the wrong thing, and this one
    #    was.
    bs: dict[tuple, dict] = {}
    for s, pe, item, v in con.execute(
        "SELECT symbol, period_end, item, value FROM statements WHERE stmt_type='balance' "
        "AND item IN ('Total Assets','Total Liabilities Net Minority Interest',"
        "'Total Equity Gross Minority Interest') AND value IS NOT NULL"
    ):
        bs.setdefault((s, pe), {})[item] = float(v)
    bal_n = bal_ok = 0
    for r in bs.values():
        ta = r.get("Total Assets")
        tl = r.get("Total Liabilities Net Minority Interest")
        eq = r.get("Total Equity Gross Minority Interest")
        if not ta or tl is None or eq is None:
            continue
        bal_n += 1
        if abs((tl + eq) - ta) / abs(ta) <= 0.02:
            bal_ok += 1
    if bal_n:
        checks["The balance sheet balances"] = {
            "measured": bal_n, "agree": bal_ok, "pct": pct(bal_ok, bal_n),
            "what": "total assets against liabilities plus equity, including minority interest - "
                    "an identity the company must satisfy, so a failure is ours",
        }

    # 5. Four filed quarters against the filed annual, same company, same year.
    #
    #    Both come from the company's own filings, so they are meant to agree.
    #    Where they do not, one of the two is wrong and the page is currently
    #    showing it. This is the check that stopped a bad idea: building missing
    #    annual years by summing quarters looked free until this measured the
    #    method at 10.6% materially wrong.
    def _fy_end(period_end: str) -> str:
        y, m = int(period_end[:4]), int(period_end[5:7])
        return f"{y + 1 if m >= 4 else y}-03-31"

    filed_year: dict[tuple, float] = {}
    for s, pe, v in con.execute(
        "SELECT symbol, period_end, value FROM results_history "
        "WHERE period_type='annual' AND item='revenue' AND value IS NOT NULL"
    ):
        filed_year[(s, pe)] = float(v)
    quarters: dict[tuple, list] = {}
    for s, pe, v in con.execute(
        "SELECT symbol, period_end, value FROM results_history "
        "WHERE period_type='quarterly' AND item='revenue' AND value IS NOT NULL"
    ):
        quarters.setdefault((s, _fy_end(pe)), []).append(float(v))
    q_n = q_ok = 0
    for key, vals in quarters.items():
        annual = filed_year.get(key)
        if len(vals) != 4 or not annual:
            continue
        q_n += 1
        if abs(sum(vals) - annual) / abs(annual) <= 0.05:
            q_ok += 1
    if q_n:
        checks["Four filed quarters against the filed year"] = {
            "measured": q_n, "agree": q_ok, "pct": pct(q_ok, q_n),
            "what": "a year's revenue against its own four quarters added up - both filed by "
                    "the company, so a disagreement means one of the two is wrong",
        }

    return {
        "score": round(sum(scored) / len(scored), 1) if scored else None,
        "checks": checks,
        "internal_consistency": internal,
    }


def trading_days_old(d: str) -> int:
    """Calendar age less weekends - Monday off Friday's close is 0 days old."""
    try:
        then = datetime.strptime(d[:10], "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return 999
    n, cur = 0, then
    today = datetime.now(timezone.utc).date()
    while cur < today:
        cur += timedelta(days=1)
        if cur.weekday() < 5:
            n += 1
    return n


def freshness(rows: list[dict], asof: str | None) -> dict:
    """How old the published prices are, measured against today.

    This scored 0.5 while the publish guards, on the same data in the same run,
    reported a median price age of two trading days and exactly one company out
    of 4,651 older than six. The guards were right. This asked whether each
    company's price date exactly equalled the single newest date in the file, so
    one symbol carrying a fresher bar made every other company count as stale -
    the identical fault that had just been fixed in check_prices and was not
    carried across to the thing built to measure quality.

    A scoreboard that reproduces the bug it exists to catch is worse than no
    scoreboard, because it hides the fix that worked: two weeks of cancelled
    runs were repaired and the score for it moved 0.0 to 0.5.

    Age against today, in trading days, and the median company carries the
    score. A median cannot be moved by an outlier, and a partial refresh - the
    normal state now that fetching stops at a deadline - sits comfortably inside
    it.
    """
    out: dict = {"as_of": asof}
    if not asof:
        return {"score": None, **out}
    liquid = [r for r in rows if (r.get("bars30") or 0) >= 15]
    ages = sorted(trading_days_old(r["price_date"]) for r in liquid if r.get("price_date"))
    # A median over a handful of rows is not a measurement. When almost nothing
    # qualifies, the right answer is "unmeasured", not a confident 100 taken
    # over one company - which is exactly what this returned once.
    if len(ages) < max(50, 0.2 * len(rows)):
        out["score"] = None
        out["unmeasured_because"] = (f"only {len(ages)} of {len(rows)} companies have enough "
                                     f"recent trading days to judge")
        return out
    med = ages[len(ages) // 2]
    out["regularly_traded"] = len(liquid)
    out["median_age_trading_days"] = med
    out["older_than_6_days"] = sum(1 for a in ages if a > 6)
    # Full marks at 2 trading days or fresher; zero at a fortnight.
    out["score"] = round(max(0.0, min(100.0, 100.0 - max(0, med - 2) * 10)), 1)
    return out


def depth(files: list[Path], con: sqlite3.Connection | None = None) -> dict:
    """How much of each company's OWN history we hold.

    This measured the median years of chart history against a flat 20-year
    target, which marks a company down for not having existed. Of the companies
    scored, hundreds listed within the last five years: their maximum possible
    history IS three or four years, and holding all of it was being reported as
    a 20% score. The number said the data was thin when what was thin was the
    company's life.

    Each company is now measured against its own ceiling - the years since it
    listed, capped at the twenty the charts are built for - and the score is the
    median of those ratios. A company holding everything it could possibly have
    scores 100, which is what a score should be able to say.
    """
    listed: dict[str, datetime] = {}
    if con is not None:
        try:
            for s, d in con.execute('SELECT SYMBOL, "DATE OF LISTING" FROM universe'):
                if not d:
                    continue
                for fmt in ("%d-%b-%Y", "%Y-%m-%d"):
                    try:
                        listed[s] = datetime.strptime(d, fmt); break
                    except ValueError:
                        continue
        except Exception:  # noqa: BLE001
            pass

    now_year = datetime.now(timezone.utc).year
    ratios, spans, with_band, pre_2012, complete_history = [], [], 0, 0, 0
    for f in files:
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            continue
        b = d.get("pe_band")
        if not (b and b.get("series")):
            continue
        with_band += 1
        start_year = int(b["series"][0][0][:4])
        spans.append(start_year)
        if b["series"][0][0] < "2012-01-01":
            pre_2012 += 1
        held = now_year - start_year
        sym = f.stem
        possible = 20
        if sym in listed:
            possible = min(20, max(1, now_year - listed[sym].year))
        r = min(1.0, held / possible) if possible else None
        if r is not None:
            ratios.append(r)
            if r >= 0.95:
                complete_history += 1

    median_years = None
    if spans:
        spans.sort()
        median_years = now_year - spans[len(spans) // 2]
    score = None
    if ratios:
        ratios.sort()
        score = round(ratios[len(ratios) // 2] * 100, 1)
    return {
        "score": score,
        "companies_with_a_valuation_history": with_band,
        "median_years_of_history": median_years,
        "reaching_before_2012": pre_2012,
        "holding_all_they_could": complete_history,
        "what": "median share of each company's own possible history that we hold",
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--quiet", action="store_true")
    ap.add_argument("--no-history", action="store_true", help="measure without recording")
    args = ap.parse_args()

    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    blob = json.loads(DATA_JSON.read_text(encoding="utf-8"))
    rows = blob.get("rows") or []
    files = sorted(COMPANIES.glob("*.json"))

    parts = {
        "complete": completeness(con, rows),
        "correct": correctness(con, rows),
        "fresh": freshness(rows, blob.get("price_asof")),
        "deep": depth(files, con),
    }
    # Correctness is weighted hardest deliberately. A missing figure is a gap a
    # reader can see; a wrong one is acted on.
    weights = {"complete": 0.25, "correct": 0.45, "fresh": 0.20, "deep": 0.10}
    got = [(weights[k], v["score"]) for k, v in parts.items() if v.get("score") is not None]
    overall = round(sum(w * s for w, s in got) / sum(w for w, _ in got), 1) if got else None
    # WHICH dimensions the overall covers, recorded with it.
    #
    # An unmeasured dimension drops out of the weighted average, so the total is
    # renormalised over what remains - and that means BREAKING A MEASUREMENT
    # RAISES THE SCORE. Freshness became unmeasurable and the headline went from
    # 63.8 to 79.3, which would read as a large improvement on a run where
    # nothing improved. A score whose movement can be caused by losing the
    # ability to measure is not a score.
    #
    # So the set is carried alongside the number, and a delta is only printed
    # between runs that measured the SAME things.
    measured = sorted(k for k, v in parts.items() if v.get("score") is not None)

    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    record = {"at": stamp, "overall": overall,
              **{k: v["score"] for k, v in parts.items()},
              "measured": measured, "companies": len(rows)}

    hist = []
    if HISTORY.exists():
        try:
            hist = json.loads(HISTORY.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            hist = []
    prev = hist[-1] if hist else None
    if not args.no_history:
        hist.append(record)
        HISTORY.write_text(json.dumps(hist[-200:], indent=1), encoding="utf-8")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "generated_at": stamp, "overall": overall, "parts": parts,
        "history": (hist or [record])[-60:],
    }, indent=1), encoding="utf-8")

    if args.quiet:
        print(overall)
        return

    comparable = bool(prev) and prev.get("measured") == measured

    def arrow(key: str) -> str:
        if not comparable or not prev or prev.get(key) is None or record.get(key) is None:
            return ""
        d = record[key] - prev[key]
        if abs(d) < 0.05:
            return "   ="
        return f"  {d:+.1f}"

    print()
    note = "" if len(measured) == 4 else         f"   [{', '.join(k for k in parts if k not in measured)} unmeasured - not counted]"
    print(f"  DATA QUALITY  {overall}/100{arrow('overall')}        {len(rows)} companies, {stamp}{note}")
    if prev and not comparable:
        print(f"  (no comparison with the previous run: it measured "
              f"{', '.join(prev.get('measured') or []) or 'a different set'})")
    print(f"  {'-' * 64}")
    for key, label, note in (
        ("complete", "Complete", "is the figure there at all"),
        ("correct", "Correct", "does an independent source or identity agree"),
        ("fresh", "Fresh", "does it describe today"),
        ("deep", "Deep", "how far the history reaches"),
    ):
        s = parts[key]["score"]
        bar = "#" * int((s or 0) / 5) + "." * (20 - int((s or 0) / 5))
        print(f"  {label:9s} {str(s):>5}  {bar}{arrow(key):>7}   {note}")
    print()
    print("  Correct - each line compares two INDEPENDENTLY produced figures:")
    for name, c in parts["correct"]["checks"].items():
        print(f"    {str(c['pct']):>6}%  {name}")
        print(f"             {c['agree']:,} of {c['measured']:,} - {c['what']}")
    for name, c in (parts["correct"].get("internal_consistency") or {}).items():
        print(f"    {str(c['pct']):>6}%  {name}   [not scored]")
        print(f"             {c['agree']:,} of {c['measured']:,} - {c['what']}")
    print()
    print("  Complete, by field:")
    for label, v in parts["complete"]["fields"].items():
        print(f"    {str(v):>6}%  {label}")
    print()
    d = parts["deep"]
    print(f"  Deep:  {d['companies_with_a_valuation_history']:,} companies have a valuation history, "
          f"median {d['median_years_of_history']} years, {d['reaching_before_2012']:,} reach before 2012")
    f = parts["fresh"]
    print(f"  Fresh: median price is {f.get('median_age_trading_days')} trading day(s) old across "
          f"{f.get('regularly_traded', 0):,} regularly traded companies; "
          f"{f.get('older_than_6_days', 0):,} are older than six")
    print()
    if prev:
        print(f"  Previous run: {prev['overall']}/100 at {prev['at']}")
    print(f"  History: {HISTORY.relative_to(ROOT)}  ({len(hist)} runs recorded)")


if __name__ == "__main__":
    main()
