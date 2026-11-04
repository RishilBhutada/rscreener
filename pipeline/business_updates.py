"""Rscreener - spotting a company's quarterly business update in NSE's list.

Some companies tell the market how the quarter went days before the results:
Honasa's "Quarterly Update - Q2 FY2026-27" came out on 6-Oct-2026, banks file
"Provisional Business Figures" on the first working days of the month, Titan
and Godrej Consumer a "Quarterly Update". They are voluntary (SEBI's fair
disclosure code is the reason most give), so there is no category for them -
they arrive as "Updates", "General Updates" or "Press Release" and have to be
read off the subject line, or, for lenders whose subject is a bare legal
phrase, off the PDF's file name (Kotak's "PrebusinessupdateQ2H1FY27.pdf").

Owner's study, 17-Oct-2026 (116 companies, five quarters): a big move (over two
of the share's usual daily spreads) on 16.5% of update days, against 5.6% of
ordinary days and 25-33% of results days; but which way it moved did not tell
which way the results day would (46% the same way, corr -0.01).

What counts:
  - a subject or file name with a strong phrase (provisional business figures,
    pre-results, quarterly update, key business numbers ...), or a weaker one
    (business / operational update) together with a quarter word (Q2, H1,
    quarter, half year, September ...);
  - filed 1-35 days after a quarter ended; whether it came before that
    quarter's results is decided at export, when the results times are known.
Not counted: monthly sales updates, results call invitations, certificates,
and Insider Trading "fair disclosure" text on its own (a dozen firms a week
file their disclosure code under that wording).

fetch_result_times.py stores what this finds (table business_updates),
export_calendar_json.py and export_company_json.py read it back through load(),
and alerts/update_alerts.py pushes new ones for the owner's stars.
"""
import re
from datetime import date, datetime, timedelta

DESCS = {"updates", "general updates", "press release"}
WINDOW_DAYS = 35

# Each enough on its own.
STRONG = re.compile(
    r"provisional\s+(?:key\s+)?(?:business|financial|figures|numbers|release|results)"
    r"|business\s+(?:figures|numbers|parameters)"
    r"|key\s+(?:business|provisional)"
    r"|pre[-\s]?(?:results?|quarter)\b"
    r"|quarterly\s+(?:business\s+|revenue\s+|operational\s+)?updates?"
    r"|quarter\s+preview")
# Enough only with a word that says which quarter.
WEAK = re.compile(
    r"(?:business|operational|operating|revenue)\s+(?:performance\s+)?updates?"
    r"|key\s+operational"
    r"|operating\s+(?:metrics|performance)"
    r"|performance\s+and\s+demand"                       # Marico, Dabur
    r"|unaudited\s+financial\s+figures"                  # Bandhan's initial disclosure
    r"|production\s+and\s+(?:delivery|sales)\s+volumes"
    r"|(?:sales|production)\s+volumes?\s+update")
QUARTER = re.compile(
    r"\bq[1-4]\b|q[1-4]\s*fy|[1-4]q\s*fy|quarter|\bh[12]\b|h[12]\s*fy|half[-\s]year|period\s+ended"
    r"|september|december|march|june|30\.0?[69]\.|31\.(?:0?3|12)\.")
NOT = re.compile(
    r"for\s+the\s+month|month\s+of|monthly\s+business|certificate|con(?:ference|\.)?\s*call"
    r"|schedule\s+of\s+(?:investor\s+|analyst\s+)?meet|social\s+stock")
# File names, squashed to letters: lenders' subjects often say only
# "Intimation under SEBI (LODR)", the PDF name says what it is.
FILE = re.compile(
    r"prebusiness|preresult|prequarter|businessupdate|quarterlyupdate|operationalupdate"
    r"|provisionalrelease|provisionalresult|provisionalbusiness|provfinancial"
    r"|businessfigures|keynumbers|keybusiness|revenueupdate|keyoperational|salesvolumeupdate")


def stamp(row: dict) -> datetime | None:
    try:
        return datetime.strptime((row.get("an_dt") or "").strip(), "%d-%b-%Y %H:%M:%S")
    except ValueError:
        return None


def quarter_end(day: date) -> date:
    """The last quarter to end before `day`."""
    y, m = day.year, day.month
    return [date(y - 1, 12, 31), date(y, 3, 31), date(y, 6, 30), date(y, 9, 30)][(m - 1) // 3]


def quarter_label(qe: date) -> str:
    """2026-09-30 -> 'Q2 FY27' (India's year runs April to March)."""
    q = {6: 1, 9: 2, 12: 3, 3: 4}[qe.month]
    return f"Q{q} FY{(qe.year + 1 if qe.month >= 4 else qe.year) % 100:02d}"


def file_name(row: dict) -> str:
    return (row.get("attchmntFile") or "").strip().rsplit("/", 1)[-1]


def is_update(row: dict) -> bool:
    """Whether an announcements row is a quarterly business update."""
    if (row.get("desc") or "").strip().lower() not in DESCS:
        return False
    t = stamp(row)
    if t is None or (t.date() - quarter_end(t.date())).days > WINDOW_DAYS:
        return False
    subject = re.sub(r"\s+", " ", (row.get("attchmntText") or "").lower())
    if NOT.search(subject):
        return False
    if STRONG.search(subject) or (WEAK.search(subject) and QUARTER.search(subject)):
        return True
    squashed = re.sub(r"[^a-z]", "", file_name(row).lower())
    return bool(FILE.search(squashed))


def subject_of(row: dict) -> str:
    """The subject without NSE's "X Limited has informed the Exchange
    regarding" lead-in, which fills a phone line before saying anything."""
    x = re.sub(r"\s+", " ", (row.get("attchmntText") or "")).strip()
    x = re.sub(r"^.{0,120}?has informed the exchange (?:about|regarding)\s*(?:the\s+)?", "", x, flags=re.I)
    x = x.strip(" '\".")
    return (x[:1].upper() + x[1:])[:300]


def found(rows: list[dict]) -> dict[tuple, tuple]:
    """(symbol, quarter end) -> (day, time, document, subject) of each company's
    first update for a quarter. Canara Bank filed the same figures three times
    on 1-Oct-2026; the first is when the market could read them."""
    docs = "https://nsearchives.nseindia.com/corporate/"
    best: dict[tuple, tuple] = {}
    for r in rows:
        sym = (r.get("symbol") or "").strip().upper()
        if not sym or not is_update(r):
            continue
        t = stamp(r)
        doc = (r.get("attchmntFile") or "").strip()
        doc = doc[len(docs):] if doc.startswith(docs) else doc
        key = (sym, quarter_end(t.date()).isoformat())
        val = (t.date().isoformat(), t.strftime("%H:%M:%S"), doc, subject_of(r))
        if key not in best or val[:2] < best[key][:2]:
            best[key] = val
    return best


def typical_day(days_after: list[int]) -> int | None:
    """Median days after quarter end, from at least two quarters."""
    if len(days_after) < 2:
        return None
    s = sorted(days_after)
    return s[len(s) // 2]


def days_after(day: str, qe: str) -> int:
    return (date.fromisoformat(day) - date.fromisoformat(qe)).days


def load(con) -> dict[str, list[dict]]:
    """symbol -> its updates, oldest first: {"qe", "q", "d", "at", "doc", "x"}.

    Only updates filed before that quarter's results: a "business update"
    the day after the results is a summary of them, not an early look. The
    results day comes from result_times (the announcement) and filing_dates
    (the XBRL), whichever the database has."""
    has = lambda t: con.execute("SELECT 1 FROM sqlite_master WHERE name=?", (t,)).fetchone() is not None
    if not has("business_updates"):
        return {}
    results: dict[str, list[str]] = {}
    if has("result_times"):
        for s, d in con.execute("SELECT symbol, day FROM result_times"):
            results.setdefault(s, []).append(d)
    if has("filing_dates"):
        for s, d in con.execute("SELECT symbol, announced_on FROM filing_dates WHERE announced_on IS NOT NULL"):
            results.setdefault(s, []).append(str(d)[:10])
    out: dict[str, list[dict]] = {}
    for sym, qe, d, at, doc, x in con.execute(
            "SELECT symbol, quarter, day, at, doc, subject FROM business_updates ORDER BY day, at"):
        if any(qe < r <= d for r in results.get(sym, [])):
            continue
        out.setdefault(sym, []).append({"qe": qe, "q": quarter_label(date.fromisoformat(qe)), "d": d,
                                        "at": (at or "")[:5], "doc": doc or "", "x": x or ""})
    return out


def summary(updates: list[dict], since: str) -> dict | None:
    """What a company page shows: how many of the quarters on record it gave an
    update for, its typical day, and the latest. `since` = the first day the
    database holds announcements for, so "4 of 4" counts only quarters it
    could have been seen in."""
    if not updates:
        return None
    # The first quarter whose whole window is on record: it ended no earlier
    # than the day before `since`.
    first_q, start = quarter_end(date.fromisoformat(since)), date.fromisoformat(since) - timedelta(days=1)
    while first_q < start:
        first_q = quarter_end(first_q + timedelta(days=100))
    last_q = quarter_end(date.today())
    quarters, q = 0, last_q
    while q >= first_q:
        quarters += 1
        q = quarter_end(q)
    # The quarter that ended last counts only once its window has closed or
    # it already has its update.
    if (date.today() - last_q).days <= WINDOW_DAYS and not any(u["qe"] == last_q.isoformat() for u in updates):
        quarters -= 1
    got = len({u["qe"] for u in updates if u["qe"] >= first_q.isoformat()})
    last = updates[-1]
    return {
        "n": got, "of": max(quarters, got),
        "typ": typical_day([days_after(u["d"], u["qe"]) for u in updates]),
        "last": {k: last[k] for k in ("q", "d", "at", "doc") if last.get(k)},
    }
