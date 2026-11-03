"""Point-in-time snapshots for testing a screen against history (P10, 1-Nov-2026).

For 30 June of each year from 2008, every company's screener fields as they
could have been known THAT day - quarters count only from their announcement
date, the same rule the P/E chart uses (trend_lib.available_from) - and the
price return over the following twelve months. The screener runs a query over
each year's snapshot and reports how the companies that passed did against all
companies and against the Nifty 50.

Reads the exported company files (web/public/companies/*.json), so the figures
are exactly the ones the company pages show, and the DB only for the Nifty.

Limits, shown on the page too:
  - only companies listed TODAY are in it: those that delisted or went bust
    are missing, which flatters every result (survivorship bias);
  - price return only, no dividends; before costs and tax;
  - fields that need a balance sheet (debt, ROCE) have no history and are left
    out rather than filled with today's value.

Writes web/public/backtest/index.json (dates, fields, Nifty) and one
web/public/backtest/<year>.json per date, so the page loads only what it runs.
"""
import json
import sqlite3
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from trend_lib import TYPICAL_REPORTING_LAG

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "rscreener.db"
COMPANIES = ROOT / "web" / "public" / "companies"
OUT = ROOT / "web" / "public" / "backtest"
FIRST_YEAR = 2008

# Screener field names, so a saved screen runs here unchanged.
FIELDS = ["price", "mcap", "pe", "pb", "ps", "ev_ebitda", "roe", "net_margin", "op_margin",
          "rev_growth", "earn_growth", "qtr_sales_yoy", "qtr_profit_yoy", "sales_cagr_5y",
          "profit_cagr_5y", "ret_6m", "ret_1y", "off_52w_high"]


def d(s: str) -> date:
    return datetime.strptime(s[:10], "%Y-%m-%d").date()


def at(series: list, when: date, max_gap: int = 45) -> float | None:
    """The last value on or before `when`, if it is no older than max_gap days."""
    best = None
    for row in series:
        t = d(row[0])
        if t > when:
            break
        best = row
    if best is None or (when - d(best[0])).days > max_gap:
        return None
    return best[1]


def sig(v: float | None, n: int = 3) -> float | None:
    if v is None:
        return None
    return float(f"{v:.{n}g}")


def pct(a: float | None, b: float | None) -> float | None:
    if a is None or b is None or b <= 0:
        return None
    return (a / b - 1) * 100


def cagr(a: float | None, b: float | None, years: int) -> float | None:
    if a is None or b is None or a <= 0 or b <= 0:
        return None
    return ((a / b) ** (1 / years) - 1) * 100


def snapshot(c: dict, when: date) -> list | None:
    monthly = (c.get("prices") or {}).get("monthly") or []
    price = at(monthly, when)
    if not price:
        return None
    later = at(monthly, date(when.year + 1, when.month, when.day))
    fwd = pct(later, price)

    # quarters known on `when`: announced on or before it (else end + typical lag)
    q = (c.get("trend") or {}).get("quarterly") or {}
    ann = {x["end"]: x.get("announced") for x in (c.get("quarters") or [])}
    periods = q.get("periods") or []
    known = []
    for i, p in enumerate(periods):
        avail = ann.get(p) or (d(p) + timedelta(days=TYPICAL_REPORTING_LAG)).isoformat()
        if d(avail) <= when:
            known.append(i)

    def col(name: str, i: int) -> float | None:
        arr = q.get(name) or []
        return arr[i] if i < len(arr) else None

    def ttm(name: str, back: int = 0) -> float | None:
        """Four consecutive known quarters, `back` quarters before the latest."""
        idx = known[: len(known) - back] if back else known
        if len(idx) < 4:
            return None
        win = idx[-4:]
        if (d(periods[win[-1]]) - d(periods[win[0]])).days > 300:
            return None
        vals = [col(name, i) for i in win]
        return sum(vals) if all(v is not None for v in vals) else None

    rev, pat = ttm("revenue"), ttm("pat")
    # Five-year growth from the filed YEARS: a single missing quarter breaks a
    # twenty-quarter chain, and annual filings are complete far more often. A
    # year counts once its March quarter was announced.
    a = (c.get("trend") or {}).get("annual") or {}
    a_known = [i for i, p in enumerate(a.get("periods") or [])
               if d(ann.get(p) or (d(p) + timedelta(days=60)).isoformat()) <= when]

    def a_val(name: str, back: int) -> float | None:
        if len(a_known) <= back:
            return None
        i, j = a_known[-1], a_known[-1 - back]
        if abs((d(a["periods"][i]) - d(a["periods"][j])).days - 365 * back) > 40:
            return None
        arr = a.get(name) or []
        return arr[j] if j < len(arr) else None
    # The screener's op_margin is Yahoo's operatingMargins: operating income
    # (EBIT, after depreciation) over revenue. trend "ebitda" is operating
    # profit before depreciation, so depreciation comes off to match.
    ebitda, dep = ttm("ebitda"), ttm("depreciation")
    ebit = ebitda - dep if ebitda is not None and dep is not None else None
    last = known[-1] if known else None
    year_ago = None
    if last is not None:
        tgt = d(periods[last]) - timedelta(days=365)
        year_ago = next((i for i in known if abs((d(periods[i]) - tgt).days) <= 20), None)

    both = last is not None and year_ago is not None
    q_rev_yoy = pct(col("revenue", last), col("revenue", year_ago)) if both else None
    q_pat_yoy = pct(col("pat", last), col("pat", year_ago)) if both else None

    pe = at((c.get("pe_band") or {}).get("series") or [], when)
    pb = at((c.get("pb_band") or {}).get("series") or [], when)
    ps = at((c.get("ps_band") or {}).get("series") or [], when)
    ev = at((c.get("ev_band") or {}).get("series") or [], when)
    hi = [r[1] for r in monthly if 0 <= (when - d(r[0])).days <= 365]

    v = {
        "price": price,
        "mcap": ps * rev if ps and rev else None,
        "pe": pe, "pb": pb, "ps": ps, "ev_ebitda": ev,
        # ROE = EPS / book value per share = (price/PE) / (price/PB)
        "roe": pb / pe * 100 if pe and pb and pe > 0 else None,
        "net_margin": pat / rev * 100 if pat is not None and rev else None,
        "op_margin": ebit / rev * 100 if ebit is not None and rev else None,
        # rev_growth / earn_growth on the screener are Yahoo's revenueGrowth /
        # earningsGrowth (export_json.py RENAME): the latest quarter against the
        # same quarter a year earlier - not trailing twelve months against the
        # twelve before. Worked out the same way here, so a saved screen tests
        # the rule it applies today.
        "rev_growth": q_rev_yoy,
        "earn_growth": q_pat_yoy,
        "qtr_sales_yoy": q_rev_yoy,
        "qtr_profit_yoy": q_pat_yoy,
        "sales_cagr_5y": cagr(a_val("revenue", 0), a_val("revenue", 5), 5),
        "profit_cagr_5y": cagr(a_val("pat", 0), a_val("pat", 5), 5),
        "ret_6m": pct(price, at(monthly, when - timedelta(days=182))),
        "ret_1y": pct(price, at(monthly, when - timedelta(days=365))),
        "off_52w_high": (price / max(hi) - 1) * 100 if hi and max(hi) > 0 else None,
    }
    return [sig(v[f]) for f in FIELDS] + [sig(fwd)]


def main() -> None:
    files = sorted(COMPANIES.glob("*.json"))
    years = list(range(FIRST_YEAR, date.today().year))
    rows: dict[int, list] = {y: [] for y in years}
    # Each company's sector, once, so a screen's sector filter can be applied
    # to its history (today's sector; companies rarely change it).
    sectors: dict[str, str] = {}
    for f in files:
        try:
            c = json.loads(f.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            continue
        sym = f.stem
        sec = (c.get("snapshot") or {}).get("sector")
        if sec:
            sectors[sym] = sec
        for y in years:
            when = date(y, 6, 30)
            if date(y + 1, 6, 30) > date.today():
                continue
            snap = snapshot(c, when)
            if snap:
                rows[y].append([sym, *snap])

    nifty = {}
    if DB.exists():
        con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
        series = con.execute("SELECT date, close FROM idx_bars WHERE name='Nifty 50' ORDER BY date").fetchall()
        for y in years:
            a = at(series, date(y, 6, 30), 10)
            b = at(series, date(y + 1, 6, 30), 10)
            if a and b:
                nifty[y] = round((b / a - 1) * 100, 2)

    OUT.mkdir(parents=True, exist_ok=True)
    done = [y for y in years if rows[y]]
    for y in done:
        (OUT / f"{y}.json").write_text(json.dumps(rows[y], separators=(",", ":")), encoding="utf-8")
    (OUT / "index.json").write_text(json.dumps({
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "fields": FIELDS,
        "dates": [f"{y}-06-30" for y in done],
        "counts": {str(y): len(rows[y]) for y in done},
        "nifty": {str(y): v for y, v in nifty.items()},
        "sectors": sectors,
    }, separators=(",", ":")), encoding="utf-8")
    total = sum((OUT / f"{y}.json").stat().st_size for y in done)
    print(f"backtest: {len(done)} years, {sum(len(rows[y]) for y in done):,} company-years, {total / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
