"""Computed screening ratios from statements + snapshot (screener.in-style).

All inputs are raw rupees (statements and snapshot pre-conversion).
Outputs are unitless ratios / percentages / days, rounded for display.
None-safe throughout: a missing input yields None, never a fake zero.
"""
import sqlite3

ITEMS_NEEDED = {
    "income": ["Operating Income", "Pretax Income", "Interest Expense", "EBITDA", "Total Revenue"],
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
        "inventory_days": rnd(_div(inventory, revenue) * 365 if inventory is not None and revenue else None, 1),
    }
