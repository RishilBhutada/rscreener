"""Computed screening ratios from statements + snapshot (screener.in-style).

All inputs are raw rupees (statements and snapshot pre-conversion).
Outputs are unitless ratios / percentages / days, rounded for display.
None-safe throughout: a missing input yields None, never a fake zero.
"""
import sqlite3

ITEMS_NEEDED = {
    # Cost Of Revenue is the denominator for inventory days; without it in this
    # list the ratio silently became null for every company.
    "income": ["Operating Income", "Pretax Income", "Interest Expense", "EBITDA",
               "Total Revenue", "Cost Of Revenue"],
    "balance": ["Invested Capital", "Total Assets", "Current Liabilities", "Accounts Receivable", "Inventory"],
    "cashflow": ["Cash Dividends Paid"],
}


def latest_annual_items(con: sqlite3.Connection) -> dict[str, dict[str, float]]:
    """{symbol: {item: value}} from each symbol's most recent annual statement set."""
    if not con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='statements'").fetchone():
        return {}
    wanted = [i for items in ITEMS_NEEDED.values() for i in items]
    qmarks = ",".join("?" * len(wanted))
    rows = con.execute(
        f"""SELECT s.symbol, s.item, s.value FROM statements s
            JOIN (SELECT symbol, MAX(period_end) mx FROM statements WHERE period_type='annual' GROUP BY symbol) m
              ON s.symbol = m.symbol AND s.period_end = m.mx
            WHERE s.period_type='annual' AND s.item IN ({qmarks})""",
        wanted,
    ).fetchall()
    out: dict[str, dict[str, float]] = {}
    for sym, item, value in rows:
        out.setdefault(sym, {})[item] = value
    return out


def latest_promoter(con: sqlite3.Connection) -> dict[str, float]:
    if not con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='shareholding'").fetchone():
        return {}
    rows = con.execute(
        """SELECT s.symbol, s.promoter FROM shareholding s
           JOIN (SELECT symbol, MAX(date) mx FROM shareholding GROUP BY symbol) m
             ON s.symbol = m.symbol AND s.date = m.mx"""
    ).fetchall()
    return {sym: p for sym, p in rows if p is not None}


def derived_roe(con: sqlite3.Connection) -> dict[str, float]:
    """Return on equity worked out from the statements, as a FRACTION.

    Yahoo supplies `returnOnEquity` for only 1,621 of 2,354 companies. Reliance
    - the largest company on the exchange - is one of the 733 it omits, so the
    screener showed a dash for it while happily showing ROCE. The inputs were
    there the whole time: net income and stockholders equity are on file for
    2,229 symbols.

    Average equity, not closing equity. That choice is measured, not assumed:
    against the 1,517 companies where Yahoo does publish an ROE, closing equity
    lands within 2% on 15% of them and carries a median ratio of 0.951 - a
    visible, one-directional bias. Average equity lands within 2% on 74% and
    within 10% on 87%, with a median ratio of 1.000. The remaining spread is
    period alignment: Yahoo's figure is trailing-twelve-month while the filings
    give whole years, so the two are measuring slightly different windows.

    Only gaps are filled - a published figure is never overwritten by this, so
    the 1,621 companies that already had an ROE keep exactly the value they had.
    Two years of equity are required; one year cannot be averaged, and a company
    that has only ever filed once keeps its dash.
    """
    if not con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='statements'").fetchone():
        return {}
    ni: dict[str, float] = {}
    for sym, _p, v in con.execute(
        """SELECT symbol, period_end, value FROM statements
           WHERE stmt_type='income' AND item='Net Income Common Stockholders'
             AND period_type='annual' AND value IS NOT NULL
           ORDER BY symbol, period_end"""
    ):
        ni[sym] = v                                  # ordered by date, so last wins
    eq: dict[str, list[float]] = {}
    for sym, _p, v in con.execute(
        """SELECT symbol, period_end, value FROM statements
           WHERE stmt_type='balance' AND item='Stockholders Equity'
             AND period_type='annual' AND value IS NOT NULL
           ORDER BY symbol, period_end"""
    ):
        eq.setdefault(sym, []).append(v)
    out: dict[str, float] = {}
    for sym, profit in ni.items():
        years = eq.get(sym, [])
        if len(years) < 2:
            continue
        avg = (years[-1] + years[-2]) / 2
        # Negative equity makes the ratio meaningless rather than merely large:
        # a loss over negative equity reads as a healthy positive return. Those
        # companies keep their dash.
        if avg <= 0:
            continue
        out[sym] = profit / avg
    return out


def _div(a, b):
    if a is None or b is None or b == 0:
        return None
    return a / b


def compute_ratios(snap: dict, items: dict[str, float]) -> dict[str, float | None]:
    """snap: raw snapshot row (market_cap, revenue, net_income, total_debt,
    total_cash, pe, earnings_growth in fraction). items: latest annual statement values."""
    mcap = snap.get("market_cap")
    revenue = snap.get("revenue")
    net_income = snap.get("net_income")
    debt = snap.get("total_debt")
    cash = snap.get("total_cash")
    pe = snap.get("pe")
    eg = snap.get("earnings_growth")

    op_income = items.get("Operating Income")
    pretax = items.get("Pretax Income")
    interest = items.get("Interest Expense")
    ebit = op_income if op_income is not None else (
        pretax + interest if pretax is not None and interest is not None else pretax
    )
    cap_employed = items.get("Invested Capital")
    if cap_employed is None and items.get("Total Assets") is not None and items.get("Current Liabilities") is not None:
        cap_employed = items["Total Assets"] - items["Current Liabilities"]
    ebitda = items.get("EBITDA")
    receivables = items.get("Accounts Receivable")
    inventory = items.get("Inventory")
    # Cost of goods, not revenue, is the denominator for the stock-turn ratios.
    cogs = items.get("Cost Of Revenue")
    dividends = items.get("Cash Dividends Paid")  # negative in cash-flow terms

    ev = mcap + (debt or 0) - (cash or 0) if mcap is not None else None
    roce = _div(ebit, cap_employed)
    peg = _div(pe, eg * 100) if pe is not None and eg is not None and eg > 0 else None

    def rnd(v, d=2):
        return None if v is None else round(v, d)

    return {
        "roce": rnd(roce * 100 if roce is not None else None),
        "ev_ebitda": rnd(_div(ev, ebitda)),
        "ps": rnd(_div(mcap, revenue)),
        "peg": rnd(peg),
        "int_coverage": rnd(_div(ebit, interest)),
        "div_payout": rnd(_div(-dividends if dividends is not None else None, net_income) * 100
                          if dividends is not None and net_income else None),
        "debtor_days": rnd(_div(receivables, revenue) * 365 if receivables is not None and revenue else None, 1),
        # Inventory days divides by COST OF GOODS SOLD, not revenue. Dividing by
        # revenue understates it by the gross margin - Reliance read 53.9 days
        # against a true 77.4 - and it disagreed with the per-year ratios table,
        # which follows the standard definition. Two numbers for one concept on
        # one page is the fault this project keeps hunting. Where cost of revenue
        # is not filed the figure is omitted rather than computed a second way
        # under the same name.
        "inventory_days": rnd(_div(inventory, cogs) * 365 if inventory is not None and cogs else None, 1),
    }
