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


def completeness(rows: list[dict]) -> dict:
    """How much of what the page shows is actually filled in."""
    n = len(rows)
    per_field = {}
    for key, label in CORE_FIELDS:
        have = sum(1 for r in rows if r.get(key) is not None)
        per_field[label] = pct(have, n)
    filled = [v for v in per_field.values() if v is not None]
    return {
        "score": round(sum(filled) / len(filled), 1) if filled else None,
        "companies": n,
        "fields": per_field,
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
    agree = sum(1 for k in both if 0.8 <= abs(other[k] / filed[k]) <= 1.25)
    checks["Filed profit vs the data provider"] = {
        "measured": len(both), "agree": agree, "pct": pct(agree, len(both)),
        "what": "the same company-year from the NSE filing and from the market-data provider, within 25%",
    }

    # 2. price x shares == published market cap, on the same row.
    ident_n = ident_ok = 0
    for r in rows:
        p, m, sh = r.get("price"), r.get("mcap"), r.get("shares_out")
        if not (p and m and sh):
            continue
        ident_n += 1
        if abs(p * sh / 1e7 - m) / m <= 0.02:
            ident_ok += 1
    checks["Price x shares = market cap"] = {
        "measured": ident_n, "agree": ident_ok, "pct": pct(ident_ok, ident_n),
        "what": "an arithmetic identity that must hold on every published row",
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
            if 0.02 <= v / med <= 50:
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
    checks["Price / book value = published P/B"] = {
        "measured": pe_n, "agree": pe_ok, "pct": pct(pe_ok, pe_n),
        "what": "a second arithmetic identity, on a different pair of published fields",
    }

    scored = [c["pct"] for c in checks.values() if c["pct"] is not None]
    return {"score": round(sum(scored) / len(scored), 1) if scored else None, "checks": checks}


def freshness(rows: list[dict], asof: str | None) -> dict:
    """Does the newest figure describe now."""
    out: dict = {"as_of": asof}
    if not asof:
        return {"score": None, **out}
    liquid = [r for r in rows if (r.get("bars30") or 0) >= 15]
    current = sum(1 for r in liquid if r.get("price_date") == asof)
    out["regularly_traded"] = len(liquid)
    out["on_the_newest_close"] = current
    age_days = (datetime.now(timezone.utc).date() - datetime.strptime(asof, "%Y-%m-%d").date()).days
    out["days_old"] = age_days
    # A price more than 4 days old is stale however complete it is.
    age_score = 100.0 if age_days <= 4 else max(0.0, 100.0 - (age_days - 4) * 12)
    out["score"] = round(min(pct(current, len(liquid)) or 0, age_score), 1)
    return out


def depth(files: list[Path]) -> dict:
    """How far back the history actually reaches, on the pages that have one."""
    spans, with_band, pre_2012 = [], 0, 0
    for f in files:
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            continue
        b = d.get("pe_band")
        if b and b.get("series"):
            with_band += 1
            start = b["series"][0][0]
            spans.append(int(start[:4]))
            if start < "2012-01-01":
                pre_2012 += 1
    now_year = datetime.now(timezone.utc).year
    median_years = None
    if spans:
        spans.sort()
        median_years = now_year - spans[len(spans) // 2]
    # 20 years is the target the charts are built for.
    return {
        "score": round(min(100.0, (median_years or 0) / 20 * 100), 1) if median_years else None,
        "companies_with_a_valuation_history": with_band,
        "median_years_of_history": median_years,
        "reaching_before_2012": pre_2012,
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
        "complete": completeness(rows),
        "correct": correctness(con, rows),
        "fresh": freshness(rows, blob.get("price_asof")),
        "deep": depth(files),
    }
    # Correctness is weighted hardest deliberately. A missing figure is a gap a
    # reader can see; a wrong one is acted on.
    weights = {"complete": 0.25, "correct": 0.45, "fresh": 0.20, "deep": 0.10}
    got = [(weights[k], v["score"]) for k, v in parts.items() if v.get("score") is not None]
    overall = round(sum(w * s for w, s in got) / sum(w for w, _ in got), 1) if got else None

    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    record = {"at": stamp, "overall": overall,
              **{k: v["score"] for k, v in parts.items()},
              "companies": len(rows)}

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

    def arrow(key: str) -> str:
        if not prev or prev.get(key) is None or record.get(key) is None:
            return ""
        d = record[key] - prev[key]
        if abs(d) < 0.05:
            return "   ="
        return f"  {d:+.1f}"

    print()
    print(f"  DATA QUALITY  {overall}/100{arrow('overall')}        {len(rows)} companies, {stamp}")
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
    print("  Correct is measured, not asserted:")
    for name, c in parts["correct"]["checks"].items():
        print(f"    {str(c['pct']):>6}%  {name}")
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
    print(f"  Fresh: {f.get('on_the_newest_close', 0):,} of {f.get('regularly_traded', 0):,} regularly traded "
          f"companies on the newest close ({f.get('as_of')}, {f.get('days_old')} days old)")
    print()
    if prev:
        print(f"  Previous run: {prev['overall']}/100 at {prev['at']}")
    print(f"  History: {HISTORY.relative_to(ROOT)}  ({len(hist)} runs recorded)")


if __name__ == "__main__":
    main()
