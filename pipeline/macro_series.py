"""The US economy's history on the gold page - which FRED series, and how.

One list, read by both fetch_macro.py (what to ask FRED for) and
export_macro_json.py (how to show it), so the two can never disagree about a
series' transform or its unit.

The arithmetic is FRED's own: `units` asks FRED for the change on a year
before (pc1) or on the month before (chg), and `frequency` with
`aggregation_method` has FRED turn daily or weekly readings into months. Rows
are stored by `id`, not by FRED id, so a series that changes its transform
should change its id too - otherwise last night's rows, in the old transform,
would stand under the new label until the next good fetch.

All of these are US government statistics (BLS, BEA, the Federal Reserve,
the Treasury, the Labor Department, the Census Bureau, the EIA) or the St.
Louis Fed's own arithmetic on them, which FRED republishes - public domain.
Some FRED series are not (ICE's bond indices, S&P's): read a new series'
notes on FRED before adding it here.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Series:
    id: str          # stable key in macro_obs and macro.json
    fred: str        # FRED series id
    title: str
    group: str
    unit: str        # shown after values
    dec: int         # decimals to show; the file keeps one more for the chart
    about: str
    source: str
    units: str = "lin"             # FRED transform: lin as published, pc1 % on a year before, chg change on the period before
    frequency: str | None = None   # "m" has FRED average (or take the last of) a daily or weekly series by month
    how: str | None = None         # FRED aggregation_method with `frequency`: avg or eop
    kind: str = "line"             # "bars" for a change each period, like payrolls
    freq: str = "monthly"          # what one point is, after any aggregation
    scale: float = 1.0             # applied in the export, e.g. millions of dollars to trillions


GROUPS = ["Inflation", "Jobs", "Rates & money", "Growth", "Dollar & oil"]

SERIES: list[Series] = [
    # ── Inflation ──
    Series("cpi_yoy", "CPIAUCSL", "CPI inflation", "Inflation", "% y/y", 1,
           "Consumer prices for urban consumers, change against a year before. Bureau of Labor Statistics.",
           "BLS", units="pc1"),
    Series("core_cpi_yoy", "CPILFESL", "Core CPI", "Inflation", "% y/y", 1,
           "Consumer prices without food and energy, which swing with harvests and oil, change against a year "
           "before. Bureau of Labor Statistics.", "BLS", units="pc1"),
    Series("pce_yoy", "PCEPI", "PCE inflation", "Inflation", "% y/y", 1,
           "Prices of everything households buy, including what is bought on their behalf such as health care "
           "paid by insurers, change against a year before. The Fed's 2% target is set on this measure. Bureau "
           "of Economic Analysis.", "BEA", units="pc1"),
    Series("core_pce_yoy", "PCEPILFE", "Core PCE", "Inflation", "% y/y", 1,
           "PCE prices without food and energy, change against a year before - the Fed's preferred guide to "
           "where inflation is heading. Bureau of Economic Analysis.", "BEA", units="pc1"),
    Series("ppi_fd_yoy", "PPIFIS", "PPI (final demand)", "Inflation", "% y/y", 1,
           "Prices producers receive for goods, services and construction sold to final buyers, change against "
           "a year before. A shorter history than the all-commodities index. Bureau of Labor Statistics.", "BLS",
           units="pc1"),
    Series("ppi_all_yoy", "PPIACO", "PPI (all commodities)", "Inflation", "% y/y", 1,
           "The older producer price index, for goods only, change against a year before - the long view of "
           "producer prices, back to the 1910s. Bureau of Labor Statistics.", "BLS", units="pc1"),
    Series("breakeven_10y", "T10YIE", "10-year breakeven inflation", "Inflation", "%", 2,
           "The inflation the bond market expects over the next ten years: the 10-year Treasury yield minus the "
           "10-year inflation-protected (TIPS) yield. Monthly average of daily readings. St. Louis Fed, from "
           "Treasury yields.", "St. Louis Fed", frequency="m", how="avg"),
    # ── Jobs ──
    Series("unrate", "UNRATE", "Unemployment rate", "Jobs", "%", 1,
           "Share of the labour force without a job and looking for one. Bureau of Labor Statistics (household "
           "survey).", "BLS"),
    Series("payrolls", "PAYEMS", "Payrolls added", "Jobs", "K", 0,
           "Jobs added each month on employers' payrolls outside farms, in thousands; below zero, jobs lost. "
           "Bureau of Labor Statistics (employer survey).", "BLS", units="chg", kind="bars"),
    # FRED keeps claims as a count of people; the page shows thousands, like
    # the calendar's "220K claims".
    Series("claims", "ICSA", "Jobless claims (weekly, monthly average)", "Jobs", "K", 0,
           "First-time claims for unemployment benefit, filed each week and averaged over the month, in "
           "thousands - an early sign of layoffs. Department of Labor.", "DOL", frequency="m", how="avg",
           scale=0.001),
    Series("job_openings", "JTSJOL", "Job openings", "Jobs", "K", 0,
           "Jobs employers were trying to fill on the last business day of the month, in thousands (the JOLTS "
           "survey). Bureau of Labor Statistics.", "BLS"),
    Series("wages_yoy", "CES0500000003", "Wage growth", "Jobs", "% y/y", 1,
           "Average hourly earnings of private-sector employees, change against a year before. Bureau of Labor "
           "Statistics.", "BLS", units="pc1"),
    # ── Rates & money ──
    Series("fed_funds", "FEDFUNDS", "Fed funds rate", "Rates & money", "%", 2,
           "The overnight rate banks lend to each other at - the rate the Fed sets its target range for. Monthly "
           "average. Federal Reserve.", "Federal Reserve"),
    Series("ust_2y", "GS2", "2-year Treasury yield", "Rates & money", "%", 2,
           "Yield on 2-year US government notes, monthly average. It moves with where markets expect the Fed's "
           "rate to go. Federal Reserve (H.15).", "Federal Reserve"),
    Series("ust_10y", "GS10", "10-year Treasury yield", "Rates & money", "%", 2,
           "Yield on 10-year US government notes, monthly average - the benchmark for long-term borrowing. "
           "Federal Reserve (H.15).", "Federal Reserve"),
    Series("curve_10y2y", "T10Y2Y", "Yield curve (10y minus 2y)", "Rates & money", "pts", 2,
           "The 10-year yield minus the 2-year, monthly average of daily readings. Below zero the curve is "
           "inverted; that came before each US recession since the 1970s, though not every inversion was "
           "followed by one. St. Louis Fed, from Treasury yields.", "St. Louis Fed", frequency="m", how="avg"),
    Series("real_yield_10y", "DFII10", "10-year real yield", "Rates & money", "%", 2,
           "Yield on 10-year inflation-protected Treasuries (TIPS) - the return after inflation. Gold pays no "
           "interest, so a higher real yield raises the cost of holding it, and the two have tended to move "
           "opposite ways. Monthly average. Federal Reserve (H.15).", "Federal Reserve", frequency="m", how="avg"),
    Series("m2_yoy", "M2SL", "Money supply (M2)", "Rates & money", "% y/y", 1,
           "Cash, checking and savings deposits and retail money-market funds held by the public, change against "
           "a year before. Federal Reserve.", "Federal Reserve", units="pc1"),
    # A month's last weekly reading, not the average: the balance sheet is a
    # stock, and the month-end figure is the one people quote.
    Series("fed_balance", "WALCL", "Fed balance sheet", "Rates & money", "$ trillion", 2,
           "Everything the Fed owns - mostly Treasuries and mortgage bonds, much of it bought to steady markets "
           "(quantitative easing) - at the end of each month, in trillions of dollars. Federal Reserve (H.4.1).",
           "Federal Reserve", frequency="m", how="eop", scale=1e-6),
    # ── Growth ──
    Series("gdp_growth", "A191RL1Q225SBEA", "GDP growth", "Growth", "% annualised", 1,
           "Growth of the US economy after inflation, each quarter on the one before, at an annual rate. Bureau "
           "of Economic Analysis.", "BEA", kind="bars", freq="quarterly"),
    Series("indpro_yoy", "INDPRO", "Industrial production", "Growth", "% y/y", 1,
           "Output of factories, mines and utilities, change against a year before. Federal Reserve (G.17).",
           "Federal Reserve", units="pc1"),
    Series("retail_yoy", "RSAFS", "Retail sales", "Growth", "% y/y", 1,
           "Sales at shops and restaurants in dollars, not adjusted for inflation, change against a year "
           "before. Census Bureau.", "Census", units="pc1"),
    # ── Dollar & oil ──
    Series("dollar_broad", "DTWEXBGS", "US dollar index (broad)", "Dollar & oil", "index", 1,
           "The dollar against the currencies of America's trading partners, weighted by trade; January 2006 = "
           "100. Gold is priced in dollars, so a stronger dollar has tended to weigh on it. Monthly average. "
           "Federal Reserve (H.10).", "Federal Reserve", frequency="m", how="avg"),
    Series("oil_wti", "DCOILWTICO", "Oil (WTI)", "Dollar & oil", "$/barrel", 2,
           "US crude oil (West Texas Intermediate) at Cushing, Oklahoma, monthly average of daily prices. Energy "
           "Information Administration.", "EIA", frequency="m", how="avg"),
]

# Not a chart: the shaded recessions behind every chart. USREC is 1 in each
# month of a recession as the NBER dates them, 0 otherwise.
RECESSIONS = Series("recessions", "USREC", "US recessions", "", "", 0,
                    "NBER-dated US recessions.", "NBER")

ALL = SERIES + [RECESSIONS]

assert len({s.id for s in ALL}) == len(ALL), "two series share an id"
assert all(s.group in GROUPS for s in SERIES), "a series names a group that is not in GROUPS"
