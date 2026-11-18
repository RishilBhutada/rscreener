"""Rscreener - why a chart or figure is missing, and whose side the gap is on.

Owner, 18-Nov-2026: "if some data is not present, then it shows a red star
... which shows why the data is missing, couldn't find, or something like
that, so that it can be identified whether it's a glitch or something missing
from the NSE data."

Every reason is read from records the pipeline already keeps - the fetch logs,
the quarters on record, and the counts ratio_bands(diag=) takes while deciding
each ratio point - never inferred. Each item carries a SIDE:

    ours     Rscreener's own gap: a fetch failed, or the data exists and is not
             worked out yet. The page shows it red: a fault to fix.
    queued   not read yet, and a nightly job will reach it. Amber.
    source   the company has not filed it, or the exchange (or Yahoo) holds no
             readable copy. Grey: nothing to fix on Rscreener's side.
    rule     left out on purpose - a loss-making P/E, a negative book. Grey.

When the records cannot tell a glitch from an absence, the item says what was
and was not checked rather than picking one.

Pure functions over plain values, so tests need no database.
"""
from __future__ import annotations

from datetime import datetime

SIDES = ("ours", "queued", "source", "rule")          # worst first
XBRL_FROM = "2016-06-30"     # BSE's machine-readable filings start about here
TWELVE_MONTH = ["pe", "ps", "ev"]                     # views drawn from four quarters in a row
FROM_QUARTERS = ["pe", "ps", "ev", "sales", "ebitda"]  # views drawn from quarterly results
ALT_BANDS = ("pe", "ps", "ev")   # bands that carry a latest-quarter x4 window
VIEW_WORD = {"pe": "P/E", "ps": "Market cap / Sales", "ev": "EV / EBITDA", "pb": "Price / Book",
             "sales": "Sales & margin", "ebitda": "EBITDA"}
MON = ["Mar", "Jun", "Sep", "Dec"]

NEXT = {
    "ours": "A fault on Rscreener's side - fixable.",
    "queued": "Fills in by itself when the nightly job reaches it.",
    "source": "Nothing to fix on Rscreener's side.",
    "rule": "Left out on purpose.",
}


def _day(ts: str | None) -> str:
    """'2026-11-17 12:17:58' or '17-AUG-2026' -> '17 Nov 2026'; '' when unknown."""
    if not ts:
        return ""
    s = ts.strip()
    for fmt, val in (("%Y-%m-%d %H:%M:%S", s[:19]), ("%Y-%m-%d", s[:10]), ("%d-%b-%Y", s.title())):
        try:
            return datetime.strptime(val, fmt).strftime("%d %b %Y").lstrip("0")
        except ValueError:
            continue
    return ""


def _qkey(iso: str) -> int:
    y, m = int(iso[:4]), int(iso[5:7])
    return y * 4 + (m - 1) // 3


def _qlabel(k: int) -> str:
    y, q = divmod(k, 4)
    return f"{MON[q]}-{y}"


def _qiso(k: int) -> str:
    y, q = divmod(k, 4)
    return f"{y}-{['03-31', '06-30', '09-30', '12-31'][q]}"


def _labels(keys: list[int], cap: int = 8) -> str:
    out = ", ".join(_qlabel(k) for k in keys[:cap])
    return out + (f" and {len(keys) - cap} more" if len(keys) > cap else "")


def _item(side: str, what: str, why: str, views: list[str], whole: bool, nxt: str | None = None) -> dict:
    return {"side": side, "what": what, "why": why, "views": views, "whole": whole, "next": nxt or NEXT[side]}


def _err(log: tuple | None) -> str | None:
    return (log[1] or None) if log else None


def _results_missing(exch: str, on_bse: bool | None, listed_on: str | None,
                     nse_log: tuple | None, bse_log: tuple | None) -> dict:
    """Nothing quarterly on record: which archive was read, and what it said."""
    what = "Quarterly results"
    if exch == "BSE":
        if bse_log is None:
            return _item("queued", what, "Listed on BSE only. Its results are read from BSE's archive, a few "
                         "hundred companies a night, and this one has not been reached yet.", FROM_QUARTERS, True)
        if _err(bse_log):
            return _item("ours", what, f"Reading BSE's archive for it failed on {_day(bse_log[0])}: "
                         f"{_err(bse_log)[:90]}.", FROM_QUARTERS, True, "Retried within 90 days.")
        return _item("source", what, f"BSE's archive holds no machine-readable quarterly results for it "
                     f"(checked {_day(bse_log[0])}). BSE's readable filings start around 2016.", FROM_QUARTERS, True)
    if nse_log is None:
        return _item("queued", what, "Its results have not been fetched from NSE yet.", FROM_QUARTERS, True)
    err = _err(nse_log)
    if err and err.endswith("could not be read"):
        return _item("ours", what, f"NSE lists results filings for it that Rscreener could not read "
                     f"({err.split()[0]} on {_day(nse_log[0])}).", FROM_QUARTERS, True, "Retried on a later nightly run.")
    if err:
        return _item("ours", what, f"Fetching its results from NSE failed on {_day(nse_log[0])}: {err[:90]}.",
                     FROM_QUARTERS, True, "Retried on a later nightly run.")
    joined = f" - it joined NSE on {_day(listed_on)}" if _day(listed_on) else ""
    if on_bse is None:
        return _item("queued", what, f"NSE's archive has no results for it (checked {_day(nse_log[0])}). "
                     "Whether BSE holds them has not been checked yet.", FROM_QUARTERS, True)
    if not on_bse:
        return _item("source", what, f"NSE's results archive has no filings for it (checked {_day(nse_log[0])}), "
                     "and it is not listed on BSE.", FROM_QUARTERS, True)
    if bse_log is None:
        return _item("queued", what, f"NSE's archive has no results for it{joined}. Its results were filed on "
                     "BSE, and reading BSE's archive for it is queued.", FROM_QUARTERS, True)
    if _err(bse_log):
        return _item("ours", what, f"NSE's archive has no results for it{joined}, and reading BSE's archive "
                     f"failed on {_day(bse_log[0])}: {_err(bse_log)[:90]}.", FROM_QUARTERS, True,
                     "Retried within 90 days.")
    return _item("source", what, f"Neither NSE's nor BSE's archive holds machine-readable quarterly results "
                 f"for it (checked {_day(bse_log[0])}){joined}.", FROM_QUARTERS, True)


def _gaps(quarters: list[str], annual_ends: set[str], exch: str, on_bse: bool | None,
          nse_log: tuple | None, bse_log: tuple | None) -> list[dict]:
    """Quarters missing inside the history, split by whose side each is on."""
    keys = sorted({_qkey(q) for q in quarters})
    have = set(keys)
    missing = [k for a, b in zip(keys, keys[1:]) for k in range(a + 1, b)]
    if not missing:
        return []
    first = _qiso(keys[0])
    q4, queued, other = [], [], []
    for k in missing:
        # A quarter filed only inside the year's results: the year and its
        # first nine months are on record, so the quarter is their difference
        # (TCS, Mar-2008 to Mar-2011).
        if _qiso(k) in annual_ends and all(k - j in have for j in (1, 2, 3)):
            q4.append(k)
        # BSE's archive is read for every period not on record - since
        # 18-Nov-2026 for holes inside a history too - from mid-2016, where
        # its XBRL begins (fetch_bse_results.py).
        elif exch == "NSE" and on_bse and bse_log is None and _qiso(k) >= XBRL_FROM:
            queued.append(k)
        else:
            other.append(k)
    out = []
    breaks = " Each gap also breaks the 12-month lines (P/E, P/S, EV/EBITDA) for up to a year after it."
    if q4:
        # derive_quarters.py works these out nightly; one still missing was
        # refused there - the four filings on two bases, or the result failed
        # its sanity check - or is waiting for tonight's run.
        out.append(_item("ours", f"Quarters {_labels(q4)}",
                         "Filed only inside the full-year results. The quarter is the year minus its first nine "
                         "months; Rscreener works it out nightly, and has not for these - the year and its "
                         "quarters are on different bases, the result failed a sanity check, or tonight's run "
                         "has not reached them." + breaks, FROM_QUARTERS, False))
    if queued:
        out.append(_item("queued", f"Quarters {_labels(queued)}",
                         "Not in NSE's archive. Its BSE filings are queued to be read." + breaks, FROM_QUARTERS, False))
    if other:
        if exch == "BSE":
            why = "BSE's archive holds no readable filing for these quarters"
            why += f" (checked {_day(bse_log[0])})." if bse_log else "."
        elif bse_log is not None and on_bse and all(_qiso(k) >= XBRL_FROM for k in other):
            why = ("Neither NSE's nor BSE's archive holds a readable filing for these quarters on the basis "
                   "(consolidated or standalone) of the quarters either side"
                   f" (BSE read {_day(bse_log[0])}).")
        else:
            why = "NSE's results archive holds no readable filing for these quarters"
            why += f" (last read {_day(nse_log[0])})." if nse_log else "."
            if on_bse and any(_qiso(k) < XBRL_FROM for k in other):
                why += " BSE's machine-readable filings begin in mid-2016, so it cannot fill the older ones."
        out.append(_item("source", f"Quarters {_labels(other)}", why + breaks, FROM_QUARTERS, False))
    return out


def data_status(*, exch: str, on_bse: bool | None, listed_on: str | None,
                nse_log: tuple | None, bse_log: tuple | None,
                quarters: list[str], annual_ends: set[str],
                has_shares: bool, diag: dict | None, bands: dict,
                ebitda_any: bool, stmt_log: tuple | None = None) -> dict | None:
    """What the company's charts lack, why, and whose side it is on.

    nse_log / bse_log / stmt_log: (fetched_at, error[, n_periods]) of the
    newest NSE results fetch, BSE archive read and Yahoo statements fetch.
    quarters: quarter ends on record; annual_ends: year ends with an annual
    filing; diag: ratio_bands' counts for the company; bands: {"pe": band...}.
    Returns {"worst": side, "items": [...]} or None when nothing is missing.
    """
    items: list[dict] = []
    n = len(set(quarters))
    if n == 0:
        items.append(_results_missing(exch, on_bse, listed_on, nse_log, bse_log))
    else:
        if n < 4:
            first = min(quarters)
            if exch == "NSE" and on_bse and bse_log is None and first > XBRL_FROM:
                joined = f" - it joined NSE on {_day(listed_on)}" if _day(listed_on) else ""
                items.append(_item("queued", "12-month figures",
                                   f"Only {n} quarter{'s' if n > 1 else ''} on NSE so far{joined}. Earlier ones were "
                                   "filed on BSE, and reading them is queued.", TWELVE_MONTH, True))
            else:
                items.append(_item("source", "12-month figures",
                                   f"Only {n} quarter{'s' if n > 1 else ''} of results filed so far (first: "
                                   f"{_qlabel(_qkey(first))}). A 12-month figure needs four in a row, so these "
                                   "lines start with the fourth.", TWELVE_MONTH, True))
        items += _gaps(quarters, annual_ends, exch, on_bse, nse_log, bse_log)

    if n and not has_shares:
        items.append(_item("ours", "Share count", "Rscreener's snapshot has no share count for this company, so "
                           "its market value - and every valuation line (P/E, P/S, EV/EBITDA, P/B) - cannot be "
                           "worked out.", ["pe", "ps", "ev", "pb"], True))
    d = diag or {}
    no_ebitda = bool(n) and not ebitda_any
    if n and has_shares and d.get("shares") and d.get("flows", 0) == 0:
        items.append(_item("ours", "12-month figures", "Every quarter on record was set aside by a "
                           "consistency check (its own profit and EPS disagree), so nothing is drawn.",
                           TWELVE_MONTH, True))
    elif n and has_shares and d.get("shares") and "ttm" in d:
        ttm = d["ttm"]
        if ttm == 0 and n >= 4:
            gap_side = next((it["side"] for it in items if it["what"].startswith("Quarters")), None)
            items.append(_item(gap_side or "source", "12-month figures",
                               "Never four quarters in a row on one basis"
                               + (" - the missing quarters above break every run." if gap_side else
                                  ": the quarters on record switch between consolidated and standalone "
                                  "figures, which do not add up."), TWELVE_MONTH, True))
        if ttm:
            if "pe" not in bands:
                if d.get("pe", 0) == 0:
                    items.append(_item("rule", "P/E", "No 12-month period on record shows a profit. A negative "
                                       "P/E is a loss, not a cheap share, so no line is drawn.", ["pe"], True))
                else:
                    items.append(_item("rule", "P/E", f"Only {d['pe']} price dates fall in a profitable 12 "
                                       "months; a line needs 4.", ["pe"], True))
            if "ps" not in bands:
                if d.get("ps", 0) == 0:
                    items.append(_item("source", "Market cap / Sales", "Its filings give no sales figure, so "
                                       "price-to-sales cannot be worked out.", ["ps"], True))
                else:
                    items.append(_item("rule", "Market cap / Sales", f"Only {d['ps']} points; a line needs 4.",
                                       ["ps"], True))
            if "ev" not in bands:
                if d.get("ebitda", 0) == 0:
                    if not no_ebitda:     # else the EBITDA item below covers it
                        items.append(_item("rule", "EV / EBITDA", "Operating profit (EBITDA) is below zero in "
                                           "every 12-month period, where EV/EBITDA means nothing.", ["ev"], True))
                elif not d.get("netdebt"):
                    if stmt_log and _err(stmt_log) and "unknown to Yahoo" not in _err(stmt_log):
                        items.append(_item("ours", "EV / EBITDA", f"Debt and cash come from Yahoo's balance "
                                           f"sheet, and fetching it failed on {_day(stmt_log[0])}: "
                                           f"{_err(stmt_log)[:90]}.", ["ev"], True, "Retried on a later nightly run."))
                    else:
                        items.append(_item("source", "EV / EBITDA", "Debt and cash come from Yahoo's balance "
                                           "sheet, which has none for this company.", ["ev"], True))
                elif d.get("ev", 0) == 0:
                    items.append(_item("source", "EV / EBITDA", "Its debt and cash on record are more than 13 "
                                       "months away from every date with a 12-month EBITDA.", ["ev"], True))
                else:
                    items.append(_item("rule", "EV / EBITDA", f"Only {d['ev']} points; a line needs 4.", ["ev"], True))
        if "pb" not in bands and "equity" in d:
            if d["equity"] == 0:
                items.append(_item("source", "Price / Book", "No net worth on record - neither in its filings "
                                   "nor in Yahoo's balance sheet.", ["pb"], True))
            elif d.get("equity_pos", 0) == 0:
                items.append(_item("rule", "Price / Book", "Net worth is below zero on every date on record; a "
                                   "price-to-book on a negative book means nothing.", ["pb"], True))
            else:
                items.append(_item("rule", "Price / Book", f"Only {d['equity_pos']} points; a line needs 4.",
                                   ["pb"], True))

    if no_ebitda:
        views = ["ebitda"] + (["ev"] if "ev" not in bands else [])
        items.append(_item("source", "EBITDA" + (" and EV / EBITDA" if "ev" in views else ""),
                           "Its filings do not carry the lines EBITDA is worked out from (revenue, expenses, "
                           "interest, depreciation).", views, True))

    no_median = [k for k in ("pe", "ev", "pb", "ps") if k in bands and bands[k] and bands[k].get("median_5y") is None]
    if no_median:
        pts = min(len(bands[k].get("series") or []) for k in no_median)
        items.append(_item("rule", "Median line", f"{', '.join(VIEW_WORD[k] for k in no_median)}: a median "
                           f"needs 12 points and there are {pts}.", no_median, False))
    no_alt = [k for k in ALT_BANDS if k in bands and bands[k] and not bands[k].get("alt")]
    if no_alt:
        items.append(_item("rule", "1Q x4 window", f"{', '.join(VIEW_WORD[k] for k in no_alt)}: the latest "
                           "quarter x4 was never above zero, so this window has nothing to draw.", no_alt, False))

    if not items:
        return None
    items.sort(key=lambda it: SIDES.index(it["side"]))
    return {"worst": items[0]["side"], "items": items}
