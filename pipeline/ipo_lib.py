"""IPO derivations: actual listing gains, and scoring GMP against them.

The point of storing GMP is not to display a rumour more prettily - it is to make
the rumour FALSIFIABLE. For every IPO that has since listed we compare the last
grey-market quote before listing against the return actually delivered on listing
day, so the premium carries its own track record wherever it is shown.
"""
import re
import sqlite3

# NSE `securityType` values that are ordinary shares. Anything else (N0/NCD bond
# series, InvITs priced per unit, etc.) would pollute a listing-gain average.
EQUITY_TYPES = {"EQ", "BE", "SME", "SM", "ST", "MF"}


def _num(v):
    if v is None:
        return None
    m = re.search(r"\d[\d,]*\.?\d*", str(v))
    if not m:
        return None
    try:
        return float(m.group(0).replace(",", ""))
    except ValueError:
        return None


def issue_price_of(row: dict) -> float | None:
    """Final issue price, cross-checked against the announced band.

    NSE's `issuePrice` is occasionally junk (e.g. band "53 to 57" alongside an
    issue price of 610). When it falls outside the band it is discarded in favour
    of the top of the band, which is what a fully-subscribed book prices at.
    """
    band = str(row.get("price_band") or "")
    nums = [float(x.replace(",", "")) for x in re.findall(r"\d[\d,]*\.?\d*", band)]
    lo, hi = (min(nums), max(nums)) if nums else (None, None)
    p = _num(row.get("issue_price"))
    if p and (lo is None or lo * 0.5 <= p <= hi * 1.5):
        return p
    return hi


def _norm_name(s: str) -> str:
    s = (s or "").lower()
    s = re.sub(r"\b(limited|ltd|private|pvt|india|ipo)\b", " ", s)
    return re.sub(r"[^a-z0-9]+", "", s)


def listing_gains(con: sqlite3.Connection) -> dict[str, dict]:
    """{symbol: {...}} listing-day return vs issue price, equity issues only."""
    have_prices = bool(
        con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='prices'").fetchone()
    )
    rows = con.execute(
        "SELECT symbol, company, listing_date, price_band, issue_price, security_type "
        "FROM ipos WHERE listing_date IS NOT NULL"
    ).fetchall()
    out: dict[str, dict] = {}
    for sym, company, listing, band, iprice, stype in rows:
        if stype and stype.upper() not in EQUITY_TYPES:
            continue
        issue = issue_price_of({"issue_price": iprice, "price_band": band})
        if not issue or issue <= 0:
            continue
        rec = {
            "symbol": sym, "company": company, "listing_date": listing,
            "issue_price": round(issue, 2), "price_band": band,
            "listing_close": None, "listing_gain_pct": None, "basis": None,
        }
        if have_prices:
            # The price MUST come from the listing window itself. Two traps here:
            #  - daily history only reaches back ~2 years, so an unbounded "first
            #    row on or after listing" returns a price YEARS later and reads as
            #    a listing pop of several thousand percent;
            #  - a month-end close is up to a month after listing, which is a
            #    month's return wearing a listing gain's label.
            # Only a daily bar within a few sessions of listing is accepted.
            # A ticker whose price history starts well BEFORE its listing date is
            # not this issue - NSE reuses symbols, and the series belongs to the
            # previous holder. Trusting it invents a listing gain out of nothing.
            reused = bool(con.execute(
                "SELECT 1 FROM prices WHERE symbol=? AND freq='daily' AND date<date(?, '-30 days') LIMIT 1",
                (sym, listing),
            ).fetchone())
            r = None if reused else con.execute(
                "SELECT date, close FROM prices WHERE symbol=? AND freq='daily' "
                "AND date>=? AND date<=date(?, '+5 days') ORDER BY date LIMIT 1",
                (sym, listing, listing),
            ).fetchone()
            if reused:
                rec["basis"] = "excluded: symbol reused"
            elif r and r[1]:
                gain = (float(r[1]) / issue - 1) * 100
                # Yahoo prices are split/bonus-adjusted but the issue price is not,
                # so a later corporate action deflates the whole history and shows
                # a listing "loss" no market ever produced. Worse than -60% in one
                # session is an adjustment artifact, not a price move.
                if gain < -60:
                    rec["basis"] = "excluded: corporate-action adjusted"
                else:
                    rec["listing_close"] = round(float(r[1]), 2)
                    rec["listing_gain_pct"] = round(gain, 2)
                    rec["basis"] = "daily"
                rec["price_date"] = r[0]
        out[sym] = rec
    return out


def gmp_scoreboard(con: sqlite3.Connection, gains: dict[str, dict] | None = None) -> dict:
    """Match each GMP snapshot to the IPO it named, then to the real outcome.

    Returns {"rows": [...], "summary": {...}}. `rows` carry the last pre-listing
    GMP, what it implied, and what actually happened. Only IPOs that have both a
    quote and a realised listing price are scored.
    """
    if not con.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='gmp_history'"
    ).fetchone():
        return {"rows": [], "summary": {}}
    gains = gains if gains is not None else listing_gains(con)
    by_key: dict[str, dict] = {}
    for g in gains.values():
        by_key.setdefault(_norm_name(g["company"] or g["symbol"]), g)
        by_key.setdefault(_norm_name(g["symbol"]), g)  # "INDOMIM" <- "Indo-MIM"

    rows: list[dict] = []
    index: dict[str, int] = {}
    for name_key, ipo_name, gmp, price, est_gain, snap in con.execute(
        "SELECT name_key, ipo_name, gmp, price, est_gain_pct, snapshot_date FROM gmp_history "
        "ORDER BY snapshot_date"
    ).fetchall():
        g = by_key.get(name_key)
        if not g or g.get("listing_gain_pct") is None:
            continue
        if g["listing_date"] and snap > g["listing_date"]:
            continue  # a quote taken after listing tells us nothing
        implied = est_gain
        if implied is None and gmp is not None and price:
            implied = round(gmp / price * 100, 2)
        rec = {
            "symbol": g["symbol"], "company": g["company"], "ipo_name": ipo_name,
            "listing_date": g["listing_date"], "issue_price": g["issue_price"],
            "gmp": gmp, "gmp_date": snap, "gmp_implied_pct": implied,
            "actual_gain_pct": g["listing_gain_pct"],
            "error_pct": None if implied is None else round(g["listing_gain_pct"] - implied, 2),
        }
        if g["symbol"] in index:  # keep the LAST quote before listing
            rows[index[g["symbol"]]] = rec
        else:
            index[g["symbol"]] = len(rows)
            rows.append(rec)

    scored = [r for r in rows if r["gmp_implied_pct"] is not None]
    summary = {}
    if scored:
        right_dir = sum(
            1 for r in scored if (r["gmp_implied_pct"] > 0) == (r["actual_gain_pct"] > 0)
        )
        errs = [abs(r["error_pct"]) for r in scored if r["error_pct"] is not None]
        overs = sum(1 for r in scored if r["error_pct"] is not None and r["error_pct"] < 0)
        summary = {
            "n": len(scored),
            "direction_hit_pct": round(right_dir / len(scored) * 100, 1),
            "avg_abs_error_pct": round(sum(errs) / len(errs), 2) if errs else None,
            "overstated_pct": round(overs / len(scored) * 100, 1),
        }
    rows.sort(key=lambda r: r["listing_date"] or "", reverse=True)
    return {"rows": rows, "summary": summary}
