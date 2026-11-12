"""Rscreener - the world's stock markets: which, and what counts as a close.

Pure helpers for fetch_world.py and export_world_json.py, kept apart so they
can be tested without a network or a database.

Every figure is the index in its OWN currency - a Nikkei move is in yen, not
rupees - and every market carries its own close date: at 22:00 IST Tokyo has
closed for the day, Europe is closing and New York is mid-session, so "today"
means three different days at once.
"""
from datetime import date, datetime, timedelta, timezone

# (Yahoo ticker, name, country, region). The order is the page's order.
MARKETS: list[tuple[str, str, str, str]] = [
    ("^GSPC", "S&P 500", "United States", "Americas"),
    ("^IXIC", "Nasdaq Composite", "United States", "Americas"),
    ("^DJI", "Dow Jones", "United States", "Americas"),
    ("^RUT", "Russell 2000", "United States", "Americas"),
    ("^GSPTSE", "S&P/TSX", "Canada", "Americas"),
    ("^BVSP", "Bovespa", "Brazil", "Americas"),
    ("^MXX", "IPC", "Mexico", "Americas"),
    ("^FTSE", "FTSE 100", "United Kingdom", "Europe"),
    ("^GDAXI", "DAX", "Germany", "Europe"),
    ("^FCHI", "CAC 40", "France", "Europe"),
    ("^STOXX50E", "Euro Stoxx 50", "Euro area", "Europe"),
    ("^IBEX", "IBEX 35", "Spain", "Europe"),
    ("FTSEMIB.MI", "FTSE MIB", "Italy", "Europe"),
    ("^SSMI", "SMI", "Switzerland", "Europe"),
    ("^AEX", "AEX", "Netherlands", "Europe"),
    ("^N225", "Nikkei 225", "Japan", "Asia-Pacific"),
    ("^HSI", "Hang Seng", "Hong Kong", "Asia-Pacific"),
    ("000001.SS", "Shanghai Composite", "China", "Asia-Pacific"),
    ("399001.SZ", "Shenzhen Component", "China", "Asia-Pacific"),
    ("^KS11", "KOSPI", "South Korea", "Asia-Pacific"),
    ("^TWII", "Taiwan Weighted", "Taiwan", "Asia-Pacific"),
    ("^AXJO", "S&P/ASX 200", "Australia", "Asia-Pacific"),
    ("^STI", "Straits Times", "Singapore", "Asia-Pacific"),
    ("^JKSE", "Jakarta Composite", "Indonesia", "Asia-Pacific"),
    ("^KLSE", "FTSE Bursa KLCI", "Malaysia", "Asia-Pacific"),
    ("^SET.BK", "SET", "Thailand", "Asia-Pacific"),
    ("^NZ50", "NZX 50", "New Zealand", "Asia-Pacific"),
    ("^TA125.TA", "TA-125", "Israel", "Middle East & Africa"),
    ("^TASI.SR", "Tadawul All Share", "Saudi Arabia", "Middle East & Africa"),
    ("^J203.JO", "JSE All Share", "South Africa", "Middle East & Africa"),
]
REGIONS = ["India", "Asia-Pacific", "Europe", "Americas", "Middle East & Africa"]

# The strip under the map: (ticker, name, what it is, absolute?). For a yield
# the change is in percentage points, not a percent of a percent.
EXTRAS: list[tuple[str, str, str, bool]] = [
    ("^VIX", "VIX", "US volatility index", False),
    ("DX-Y.NYB", "Dollar index", "US dollar against six currencies", False),
    ("^TNX", "US 10-year yield", "% a year", True),
    ("BZ=F", "Brent crude", "$ a barrel", False),
    ("INR=X", "USD/INR", "rupees to a dollar", False),
]

# The same spans as an Indian index's page.
SPANS = [("d1", 0), ("w1", 7), ("m1", 30), ("y1", 365)]
# A close this many minutes after the bell is taken as final: Yahoo's index
# feeds run up to 15-20 minutes late.
SETTLE_MIN = 25


def local_day(ts: int, gmtoffset: int) -> str:
    """The exchange's own calendar day for a bar's timestamp."""
    return (datetime.fromtimestamp(ts, timezone.utc) + timedelta(seconds=gmtoffset)).date().isoformat()


def finished(stamps: list[int], closes: list[float | None], meta: dict, now: int) -> list[tuple[str, float]]:
    """(day, close) for every session that has ENDED.

    Yahoo's daily bars include the session in progress, whose "close" is only
    the last trade. That bar is dropped until the session's own end, plus the
    feed's delay, has passed. The end is read as a time of day from the feed's
    `currentTradingPeriod`, so it holds whichever day that period describes.
    """
    off = int(meta.get("gmtoffset") or 0)
    rows = [(local_day(t, off), float(c)) for t, c in zip(stamps, closes) if c]
    if not rows:
        return []
    today = local_day(now, off)
    if rows[-1][0] < today:
        return _dedupe(rows)
    reg = ((meta.get("currentTradingPeriod") or {}).get("regular") or {})
    end = reg.get("end")
    if end:
        end_secs = (int(end) + off) % 86400
        now_secs = (now + off) % 86400
        # A session that ends at local midnight (a 24-hour contract) is over
        # only when the day itself is.
        over = end_secs != 0 and now_secs >= end_secs + SETTLE_MIN * 60
    else:
        # No hours in the feed: finished when nothing has traded for an hour.
        over = now - int(meta.get("regularMarketTime") or now) >= 3600
    return _dedupe(rows if over else rows[:-1])


def _dedupe(rows: list[tuple[str, float]]) -> list[tuple[str, float]]:
    """One close a day, the later one winning (Yahoo repeats a day at times)."""
    by: dict[str, float] = {}
    for d, c in rows:
        by[d] = c
    return sorted(by.items())


def moves(rows: list[tuple[str, float]], absolute: bool = False) -> dict:
    """The last close, its day, and its change over each span.

    Day: against the close before, when that is within five days. Longer
    spans: against the close on or before the date that many days back, when
    one exists within ten days of it. A percent, or the plain difference for a
    yield. None where there is no base - never a guess.
    """
    if not rows:
        return {}
    days = [date.fromisoformat(d) for d, _ in rows]
    last_d, last = days[-1], rows[-1][1]
    out: dict = {"date": rows[-1][0], "close": round(last, 4 if last < 10 else 2)}

    def change(base: float | None) -> float | None:
        if not base:
            return None
        return round(last - base, 3) if absolute else round((last / base - 1) * 100, 2)

    for key, span in SPANS:
        base = None
        if span == 0:
            if len(rows) > 1 and (last_d - days[-2]).days <= 5:
                base = rows[-2][1]
        else:
            want = last_d - timedelta(days=span)
            for i in range(len(rows) - 1, -1, -1):
                if days[i] <= want:
                    if (want - days[i]).days <= 10:
                        base = rows[i][1]
                    break
        out[key] = change(base)
    return out
