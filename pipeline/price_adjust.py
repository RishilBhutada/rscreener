"""Demergers: one factor per event, applied to everything priced before it.

On 30-Apr-2026 Vedanta's aluminium, oil & gas, power and iron & steel
businesses left it for companies of their own, one share of each per Vedanta
share. The price fell from 773.60 to 271.55 and no shareholder lost anything -
the rest arrived as new shares. Yahoo's history does not adjust for that
(it does for splits and bonuses), so the chart showed a 65% crash, every return
spanning April read as one, and the P/E divided the smaller company's price by
the whole old company's earnings: 12.3 in March, 4.2 in April.

The exchanges settle what the parent kept. On the ex-date NSE runs a special
pre-open session to discover the parent's new price; that is the day's OPEN
(289.50 for Vedanta), and the parent kept open / previous close of the old
share's value (289.50 / 773.60 = 0.374). fetch_bhavcopy.py works this out from
NSE's own files, once per demerger, into the price_adjust table.

Applied the way a split is:
  - every price before the ex-date x factor, so charts and returns run on;
  - every per-share and whole-company figure before it (EPS, sales, EBITDA,
    net worth) x factor too, so a ratio BEFORE the date reads exactly as it
    did, and a trailing twelve months that spans the date weighs the old
    quarters at the continuing company's share of them. That share is the
    market's, not the filings' - an estimate the page says is one.

Prices are adjusted without touching a single query: install() lays a
temporary view named `prices` over the table on the exporter's connection,
and SQLite reads the temporary one first. An event is applied only while the
stored history still shows the unadjusted drop - if Yahoo ever adjusts one
itself, the stored close before the ex-date stops matching the exchange's and
that factor quietly stops being applied, rather than applied twice.
"""
import math
import sqlite3


def _events(con: sqlite3.Connection) -> list[tuple[str, str, float, float]]:
    if not con.execute("SELECT 1 FROM sqlite_master WHERE name='price_adjust'").fetchone():
        return []
    return con.execute(
        "SELECT symbol, ex_date, factor, prev_close FROM price_adjust WHERE applied=1 ORDER BY symbol, ex_date"
    ).fetchall()


def _stored_move(con: sqlite3.Connection, sym: str, ex: str) -> float | None:
    """The stored series' own move across the ex-date: first close on or after
    it over the last one before it, at the finest frequency that has both
    (daily reaches back two years; weekly and monthly much further)."""
    for freq in ("daily", "weekly", "monthly"):
        pre = con.execute("SELECT close FROM main.prices WHERE symbol=? AND freq=? AND date < ? "
                          "ORDER BY date DESC LIMIT 1", (sym, freq, ex)).fetchone()
        post = con.execute("SELECT close FROM main.prices WHERE symbol=? AND freq=? AND date >= ? "
                           "ORDER BY date LIMIT 1", (sym, freq, ex)).fetchone()
        if pre and post and pre[0] and post[0]:
            return post[0] / pre[0]
    return None


def events(con: sqlite3.Connection) -> dict[str, list[tuple[str, float]]]:
    """{symbol: [(ex_date, factor)]} for events the stored prices have NOT
    already absorbed: across the ex-date the stored series must move nearer the
    factor than to no move at all, else the provider adjusted it already."""
    out: dict[str, list[tuple[str, float]]] = {}
    for sym, ex, f, _prev in _events(con):
        move = _stored_move(con, sym, ex)
        if move and f and abs(math.log(move / f)) < abs(math.log(move)):
            out.setdefault(sym, []).append((ex, f))
    return out


def factor_at(evs: list[tuple[str, float]] | None, date: str) -> float:
    """What one share on `date` is worth in today's continuing company."""
    f = 1.0
    for ex, x in evs or []:
        if date < ex:
            f *= x
    return f


def ensure(con: sqlite3.Connection) -> None:
    """install() unless this connection already has the view - so a builder
    that scales per-share figures can never be handed unscaled prices."""
    if not con.execute("SELECT 1 FROM sqlite_temp_master WHERE type='view' AND name='prices'").fetchone():
        install(con)


def install(con: sqlite3.Connection) -> dict[str, list[tuple[str, float]]]:
    """Shadow `prices` on this connection with the adjusted view; return the
    events applied, for the per-share figures."""
    evs = events(con)
    con.execute("DROP VIEW IF EXISTS temp.prices")
    con.execute("DROP TABLE IF EXISTS temp.adj_seg")
    con.execute("CREATE TEMP TABLE adj_seg (symbol TEXT, start TEXT, end TEXT, factor REAL)")
    segs = []
    for sym, lst in evs.items():
        start = "0000-00-00"
        for ex, _f in lst:
            segs.append((sym, start, ex, factor_at(lst, start)))
            start = ex
    con.executemany("INSERT INTO temp.adj_seg VALUES (?,?,?,?)", segs)
    cols = {r[1] for r in con.execute("PRAGMA main.table_info(prices)")}
    scaled = [c for c in ("close", "open", "high", "low") if c in cols]
    plain = [c for c in ("volume",) if c in cols]
    sel = ", ".join([f"p.{c} * COALESCE(s.factor, 1.0) AS {c}" for c in scaled] + [f"p.{c}" for c in plain])
    con.execute(f"""CREATE TEMP VIEW prices AS SELECT p.symbol, p.freq, p.date, {sel}
        FROM main.prices p LEFT JOIN temp.adj_seg s
          ON s.symbol = p.symbol AND p.date >= s.start AND p.date < s.end""")
    if evs:
        print(f"price_adjust: {sum(len(v) for v in evs.values())} demergers applied across {len(evs)} companies")
    return evs
