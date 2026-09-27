"""Fund units are not companies.

BSE's scrip list carries ETFs and other mutual-fund scheme units as equity
scrips - 263 of them on 27-Sep-2026, every one with an ISIN beginning INF, the
prefix India gives mutual-fund units (companies' begin INE). They entered the
company universe from that list, with BSE tickers, where they barely trade:
MON100 had one daily close in two years there. On the site they were
"companies" with no financials and a price days or months old.

ETFs now have their own section, priced from NSE against their NAV. This
module is the one rule every company export uses to leave fund units out.
"""
from __future__ import annotations

import sqlite3


def is_fund_isin(isin: object) -> bool:
    return isinstance(isin, str) and isin.strip().upper().startswith("INF")


def remember(con: sqlite3.Connection, rows: list[tuple[str, str, str]]) -> None:
    """Record fund units left out of the universe. Only ever ADDS: on a night
    the BSE list is unreachable the stored universe is carried forward, and it
    is already clean - an empty list then must not let them all back in."""
    con.execute("CREATE TABLE IF NOT EXISTS fund_units (symbol TEXT PRIMARY KEY, isin TEXT, exchange TEXT)")
    con.executemany("INSERT OR REPLACE INTO fund_units VALUES (?,?,?)", rows)


def symbols(con: sqlite3.Connection) -> set[str]:
    """Every symbol a company export must skip: units the universe left out,
    and NSE ETFs - except any symbol a real company in the universe holds."""
    def read(sql: str) -> set[str]:
        try:
            return {r[0] for r in con.execute(sql)}
        except sqlite3.OperationalError:   # table not there yet
            return set()
    companies = read("SELECT SYMBOL FROM universe")
    return read("SELECT symbol FROM fund_units") | (read("SELECT symbol FROM etfs") - companies)
