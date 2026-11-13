"""Parsers for the exchanges' daily market-activity files (no network here).

Read by fetch_market_activity.py; each takes the file's text or bytes and
returns plain rows, so every rule can be tested on a saved sample.

  delivery     NSE sec_bhavdata_full     shares taken home vs traded, VWAP, trades
  fo_oi        NSE F&O bhavcopy (UDiFF)  open interest per stock: futures, calls, puts
  participant  NSE participant-wise OI   index futures held long/short by FII, DII, Pro, Client
  short_sell   NSE short-selling file    shares sold short, per stock per day
  fii_dii      NSE FII/DII cash report   net buying in the cash market, crore
  surveillance NSE ASM / GSM lists + F&O ban list
  pledge       NSE pledge disclosures    promoter shares pledged

Read-only toward the exchanges. Nothing here is used to trade.
"""
from __future__ import annotations

import csv
import io
import re
import zipfile
from datetime import datetime, timedelta


def _num(s) -> float | None:
    s = str(s if s is not None else "").replace(",", "").strip()
    if s in ("", "-", "NA", "N/A"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _iso(d: str, fmt: str) -> str:
    return datetime.strptime(d.strip(), fmt).strftime("%Y-%m-%d")


def delivery(text: str) -> list[tuple]:
    """[(symbol, date, vwap, traded_qty, trades, deliv_qty, deliv_pct)] for the
    EQ series. BE / BZ series settle trade-for-trade - every share is delivered
    by rule - so a delivery figure there says nothing and is left out."""
    out = []
    rd = csv.reader(io.StringIO(text))
    head = [h.strip() for h in next(rd, [])]
    ix = {h: i for i, h in enumerate(head)}
    need = ("SYMBOL", "SERIES", "DATE1", "AVG_PRICE", "TTL_TRD_QNTY", "NO_OF_TRADES", "DELIV_QTY", "DELIV_PER")
    if not all(k in ix for k in need):
        return []
    for row in rd:
        if len(row) < len(head):
            continue
        c = [x.strip() for x in row]
        if c[ix["SERIES"]] != "EQ":
            continue
        out.append((c[ix["SYMBOL"]], _iso(c[ix["DATE1"]], "%d-%b-%Y"), _num(c[ix["AVG_PRICE"]]),
                    _num(c[ix["TTL_TRD_QNTY"]]), _num(c[ix["NO_OF_TRADES"]]),
                    _num(c[ix["DELIV_QTY"]]), _num(c[ix["DELIV_PER"]])))
    return out


def fo_oi(zip_bytes: bytes) -> list[tuple]:
    """[(symbol, date, fut_oi, fut_oi_chg, call_oi, put_oi)] for STOCK
    derivatives, every expiry added up. Index derivatives are left out."""
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
        name = next((n for n in z.namelist() if n.lower().endswith(".csv")), None)
        if not name:
            return []
        text = z.read(name).decode("utf-8", "replace")
    agg: dict[tuple, list] = {}
    for r in csv.DictReader(io.StringIO(text)):
        tp = (r.get("FinInstrmTp") or "").strip()
        if tp not in ("STF", "STO"):
            continue
        key = ((r.get("TckrSymb") or "").strip(), (r.get("TradDt") or "").strip()[:10])
        a = agg.setdefault(key, [0.0, 0.0, 0.0, 0.0])
        oi, chg = _num(r.get("OpnIntrst")) or 0.0, _num(r.get("ChngInOpnIntrst")) or 0.0
        if tp == "STF":
            a[0] += oi
            a[1] += chg
        elif (r.get("OptnTp") or "").strip() == "CE":
            a[2] += oi
        elif (r.get("OptnTp") or "").strip() == "PE":
            a[3] += oi
    return [(s, d, *v) for (s, d), v in agg.items() if s and d]


def participant(text: str) -> list[tuple]:
    """[(date, client_type, index_fut_long, index_fut_short, stock_fut_long,
    stock_fut_short)] - contracts. The date is read from the title line."""
    lines = text.splitlines()
    m = re.search(r"as on ([A-Za-z]{3} \d{1,2}, \d{4})", lines[0] if lines else "")
    if not m:
        return []
    day = _iso(m.group(1), "%b %d, %Y")
    out = []
    for row in csv.reader(io.StringIO("\n".join(lines[2:]))):
        if len(row) < 5:
            continue
        who = row[0].strip()
        if who not in ("Client", "DII", "FII", "Pro"):
            continue
        out.append((day, who, *[_num(x) for x in row[1:5]]))
    return out


def short_sell(text: str) -> list[tuple]:
    """[(symbol, date, qty)]."""
    out = []
    for r in csv.DictReader(io.StringIO(text)):
        sym, d, q = (r.get("Symbol Name") or "").strip(), (r.get("Trade Date") or "").strip(), _num(r.get("Quantity"))
        if sym and d and q is not None:
            out.append((sym, _iso(d, "%d-%b-%Y"), q))
    return out


def fii_dii(js) -> list[tuple]:
    """[(date, 'FII' | 'DII', buy_cr, sell_cr, net_cr)] from NSE's cash report."""
    out = []
    for r in js or []:
        who = "FII" if "FII" in str(r.get("category", "")).upper() else "DII" if "DII" in str(r.get("category", "")).upper() else None
        if not who or not r.get("date"):
            continue
        out.append((_iso(r["date"], "%d-%b-%Y"), who, _num(r.get("buyValue")), _num(r.get("sellValue")), _num(r.get("netValue"))))
    return out


def surveillance(asm, gsm, ban_text: str) -> list[tuple]:
    """[(symbol, list, stage)]: list is ASM-LT, ASM-ST, GSM or FO-BAN."""
    out = []
    for key, tag in (("longterm", "ASM-LT"), ("shortterm", "ASM-ST")):
        for r in ((asm or {}).get(key) or {}).get("data") or []:
            if r.get("symbol"):
                out.append((r["symbol"].strip(), tag, str(r.get("asmSurvIndicator") or "").strip()))
    for r in gsm or []:
        if r.get("symbol"):
            out.append((r["symbol"].strip(), "GSM", str(r.get("gsmStage") or "").strip()))
    for line in (ban_text or "").splitlines()[1:]:
        cells = [c.strip() for c in line.split(",")]
        sym = cells[-1] if cells else ""
        if sym and sym.upper() != "NIL" and re.fullmatch(r"[A-Z0-9&\-]+", sym):
            out.append((sym, "FO-BAN", ""))
    return out


def _norm(name: str) -> str:
    n = re.sub(r"[^a-z0-9 ]", " ", name.lower())
    n = re.sub(r"\b(limited|ltd|the|india|co|company|corporation|corp)\b", " ", n)
    return re.sub(r"\s+", " ", n).strip()


def pledge(js, names: dict[str, str]) -> tuple[list[tuple], list[str]]:
    """([(symbol, shp_date, pledged_of_promoter_pct, pledged_of_total_pct,
    promoter_pct)], [company names that matched no symbol]).

    NSE's rows carry the company NAME only; it is matched to a symbol through
    `names` {symbol: company name}. Pledged as a share of the promoters' own
    holding is the figure that signals forced-selling risk; of all shares is
    kept beside it."""
    by_norm: dict[str, str] = {}
    for sym, nm in names.items():
        by_norm.setdefault(_norm(nm or ""), sym)
    out, missed = [], []
    for r in (js or {}).get("data") or []:
        sym = by_norm.get(_norm(r.get("comName") or ""))
        if not sym:
            missed.append(r.get("comName") or "")
            continue
        pledged, promo, total = _num(r.get("numSharesPledged")), _num(r.get("totPromoterHolding")), _num(r.get("totIssuedShares"))
        of_promo = round(pledged / promo * 100, 2) if pledged is not None and promo else None
        of_total = round(pledged / total * 100, 2) if pledged is not None and total else None
        promo_pct = _num(r.get("percPromoterHolding"))
        # A company with (almost) no promoter - ITC, 0.02% - divides pledged
        # shares by nearly nothing: 8,202% "of the promoters' holding". Above
        # 100% the figure is not a share of anything; only the of-total stands.
        if of_promo is not None and of_promo > 100:
            of_promo = None
        shp = r.get("shp")
        out.append((sym, _iso(shp, "%d-%b-%Y") if shp else None, of_promo, of_total, promo_pct))
    return out, missed


# ---- screener fields, from the stored tables ----------------------------------

FRESH_DAYS = 7    # a source whose newest day is older than this is not "today's"


def _latest(con, table: str) -> str | None:
    r = con.execute(f"SELECT MAX(date) FROM {table}").fetchone()
    return r[0] if r else None


def screen_fields(con) -> dict[str, dict]:
    """{symbol: {deliv_pct, deliv_pct_20d, deliv_x, vwap, fut_oi_chg_pct, pcr,
    short_qty, surv, in_surv, pledge_pct, pledge_total_pct}}.

    deliv_x is the latest day's DELIVERED shares against their own 20-session
    average: 3 means three times the usual number of shares changed hands for
    keeps. Only sources whose newest day is recent are used."""
    out: dict[str, dict] = {}
    have = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    newest_any = max((d for t in ("deliv", "fo_oi", "short_sell", "vol_split") if t in have and (d := _latest(con, t))), default=None)

    def fresh(d):
        return d and newest_any and (datetime.fromisoformat(newest_any) - datetime.fromisoformat(d)).days <= FRESH_DAYS

    if "deliv" in have and fresh(last := _latest(con, "deliv")):
        days = [r[0] for r in con.execute("SELECT DISTINCT date FROM deliv WHERE date <= ? ORDER BY date DESC LIMIT 20", (last,))]
        hist: dict[str, list] = {}
        for sym, d, vwap, dq, dp in con.execute(
            f"SELECT symbol, date, vwap, deliv_qty, deliv_pct FROM deliv WHERE date IN ({','.join('?' * len(days))})", days
        ):
            hist.setdefault(sym, []).append((d, vwap, dq, dp))
        for sym, rows in hist.items():
            rows.sort()
            d, vwap, dq, dp = rows[-1]
            if d != last:
                continue
            o = out.setdefault(sym, {})
            o["deliv_pct"], o["vwap"] = dp, vwap
            pcts = [x[3] for x in rows if x[3] is not None]
            if len(pcts) >= 10:
                o["deliv_pct_20d"] = round(sum(pcts) / len(pcts), 1)
            qs = [x[2] for x in rows[:-1] if x[2]]
            if dq and len(qs) >= 10:
                o["deliv_x"] = round(dq / (sum(qs) / len(qs)), 2)

    # BSE-only companies: delivery % and its 20-day comparison from BSE's own
    # delivery file (vol_split, fetch_volume_split.py) - NSE's file has no
    # row for them. No VWAP: BSE's file does not carry one.
    if "vol_split" in have and fresh(last := _latest(con, "vol_split")):
        days = [r[0] for r in con.execute("SELECT DISTINCT date FROM vol_split WHERE date <= ? ORDER BY date DESC LIMIT 20", (last,))]
        hist: dict[str, list] = {}
        for sym, d, t, dq in con.execute(
            f"SELECT symbol, date, traded, delivered FROM vol_split WHERE date IN ({','.join('?' * len(days))})", days
        ):
            if sym in out and "deliv_pct" in out[sym]:
                continue
            hist.setdefault(sym, []).append((d, t, dq))
        for sym, rows in hist.items():
            rows.sort()
            d, t, dq = rows[-1]
            if d != last or not t:
                continue
            o = out.setdefault(sym, {})
            o["deliv_pct"] = round(dq / t * 100, 2)
            pcts = [x[2] / x[1] * 100 for x in rows if x[1]]
            if len(pcts) >= 10:
                o["deliv_pct_20d"] = round(sum(pcts) / len(pcts), 1)
            qs = [x[2] for x in rows[:-1] if x[2]]
            if dq and len(qs) >= 10:
                o["deliv_x"] = round(dq / (sum(qs) / len(qs)), 2)

    if "fo_oi" in have and fresh(last := _latest(con, "fo_oi")):
        for sym, oi, chg, ce, pe in con.execute(
            "SELECT symbol, fut_oi, fut_oi_chg, call_oi, put_oi FROM fo_oi WHERE date = ?", (last,)
        ):
            o = out.setdefault(sym, {})
            prev = (oi or 0) - (chg or 0)
            if prev > 0:
                o["fut_oi_chg_pct"] = round((chg or 0) / prev * 100, 1)
            if ce:
                o["pcr"] = round((pe or 0) / ce, 2)

    if "short_sell" in have and fresh(last := _latest(con, "short_sell")):
        for sym, q in con.execute("SELECT symbol, qty FROM short_sell WHERE date = ?", (last,)):
            out.setdefault(sym, {})["short_qty"] = q

    if "surveillance" in have:
        tags: dict[str, list] = {}
        for sym, lst, stage in con.execute("SELECT symbol, list, stage FROM surveillance ORDER BY list"):
            tags.setdefault(sym, []).append(f"{lst} {stage}".strip())
        for sym, t in tags.items():
            o = out.setdefault(sym, {})
            o["surv"], o["in_surv"] = "; ".join(t), 1

    if "pledge" in have:
        for sym, of_p, of_t in con.execute("SELECT symbol, of_promoter, of_total FROM pledge"):
            o = out.setdefault(sym, {})
            o["pledge_pct"], o["pledge_total_pct"] = of_p, of_t
    return out


# ---- the volume split: delivered vs same-day (intraday), 10 years -------------

def mto(text: str) -> list[tuple]:
    """NSE's MTO file (security-wise delivery position, back to 2012 and
    beyond): [(symbol, date, traded_qty, delivered_qty)] for the EQ series."""
    lines = text.splitlines()
    day = None
    for ln in lines[:4]:
        m = re.search(r"Trade Date <(\d{2}-[A-Z]{3}-\d{4})>", ln)
        if m:
            day = _iso(m.group(1).title(), "%d-%b-%Y")
            break
    if not day:
        m = re.match(r"\s*10,MTO,(\d{8})", lines[1] if len(lines) > 1 else "")
        if not m:
            return []
        day = _iso(m.group(1), "%d%m%Y")
    out = []
    for ln in lines:
        c = [x.strip() for x in ln.split(",")]
        if len(c) >= 6 and c[0] == "20" and c[3] == "EQ":
            t, dq = _num(c[4]), _num(c[5])
            if t is not None and dq is not None:
                out.append((c[2], day, t, dq))
    return out


def bse_delivery(zip_bytes: bytes, code_to_sym: dict[str, str]) -> list[tuple]:
    """BSE's SCBSEALL file (back to 2016 and beyond): [(symbol, date,
    traded_qty, delivered_qty)] for the scrip codes in `code_to_sym`."""
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
        name = next((n for n in z.namelist() if n.upper().endswith(".TXT")), None)
        if not name:
            return []
        text = z.read(name).decode("latin-1")
    out = []
    for ln in text.splitlines()[1:]:
        c = ln.split("|")
        if len(c) < 7:
            continue
        sym = code_to_sym.get(c[1].strip())
        if not sym:
            continue
        dq, t = _num(c[2]), _num(c[4])
        if t is not None and dq is not None:
            out.append((sym, _iso(c[0].strip(), "%d%m%Y"), t, dq))
    return out


def week_end(day: str) -> str:
    """The Friday of the week `day` falls in (a Saturday Muhurat session
    counts in the week before it)."""
    d = datetime.strptime(day, "%Y-%m-%d")
    return (d + timedelta(days=(4 - d.weekday()) % 7 if d.weekday() <= 4 else -(d.weekday() - 4))).strftime("%Y-%m-%d")
