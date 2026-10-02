"""What moves gold, and how much each kind of event matters to it.

Two layers decide an event's stars (1-5):

  RULE      the event's family, from the table below - a starting point
            written down with its reason, so the rating is never a guess
            made up per event.
  MEASURED  once at least MIN_MEASURED past events of a family have gold
            prices around them, the family's stars come from how gold
            actually moved on those days: the median absolute move on event
            days against the median on all days in the same span.

The mechanism notes describe how gold has TENDED to react. They are not a
forecast and not a recommendation to buy or sell anything.
"""
from __future__ import annotations

import re

MIN_MEASURED = 8

# family: (stars, label, why it matters to gold)
FAMILIES: dict[str, tuple[int, str, str]] = {
    "fomc": (5, "Fed rate decision",
             "Sets the US policy rate. Gold pays no interest, so higher expected rates raise the cost of holding it, "
             "and the dollar - in which gold is priced - usually moves with the decision. The press conference and "
             "the dot plot can move gold as much as the decision itself."),
    "us_cpi": (5, "US inflation (CPI)",
               "The number the Fed reacts to. A hotter reading has usually lifted US real yields and the dollar, "
               "which tends to weigh on gold; a cooler one the reverse. Long-run, persistent inflation is also "
               "the classic reason people own gold."),
    "us_jobs": (5, "US jobs report",
                "Payrolls, unemployment and wages shape how fast the Fed cuts or hikes. A strong report has usually "
                "pushed yields and the dollar up and gold down; a weak one the opposite."),
    "us_pce": (4, "US PCE inflation",
               "The Fed's own preferred inflation gauge. Read the same way as CPI, but usually less of a surprise "
               "because CPI and PPI come out first."),
    "fed_chair": (4, "Fed Chair speaks",
                  "A sentence from the Chair can reset rate expectations between meetings - and with them the dollar "
                  "and real yields that drive gold."),
    "fomc_minutes": (3, "Fed minutes / projections",
                     "Detail on how divided the Fed is and where it expects rates to go."),
    "us_ppi": (3, "US producer prices",
               "Wholesale inflation; feeds into PCE and into what markets expect from the next CPI."),
    "us_growth": (3, "US growth and activity",
                  "GDP, retail sales and ISM surveys move rate expectations. A slowdown has tended to help gold as "
                  "markets price earlier rate cuts."),
    "us_labour_minor": (3, "US labour (secondary)",
                        "Job openings and private payrolls preview the official jobs report."),
    "us_expect": (3, "US inflation expectations",
                  "What households expect inflation to be; the Fed watches it for signs inflation is settling in."),
    "us_yields": (2, "US Treasury auction",
                  "Weak demand at a long bond auction pushes yields up - the opportunity cost of holding gold."),
    "us_claims": (2, "US jobless claims",
                  "A weekly read on layoffs; matters most when the labour market is turning."),
    "fed_member": (2, "Fed official speaks",
                   "Individual Fed officials hint at the direction of rates; the Chair matters more."),
    "us_sentiment": (2, "US consumer sentiment", "A soft read on spending and the economy."),
    "ecb": (3, "ECB rate decision",
            "Moves the euro, the largest weight in the dollar index; a stronger dollar has tended to weigh on gold."),
    "china": (2, "China data",
              "China is the world's largest buyer of physical gold. Weaker growth can cut jewellery demand; "
              "stimulus and a weaker yuan can push savers towards gold."),
    "boj": (2, "Bank of Japan decision", "Moves the yen, a fellow safe haven, and global bond yields."),
    "other_high": (1, "Major data elsewhere", "A high-impact release in a smaller economy; it reaches gold, if at all, through the dollar."),
    "other": (1, "Other data", "Little direct link to gold."),
}

# (family, country or None for any, pattern) - first match wins.
RULES: list[tuple[str, str | None, str]] = [
    ("fomc_minutes", "USD", r"FOMC (Meeting Minutes|Economic Projections)"),
    ("fomc", "USD", r"Federal Funds Rate|FOMC Statement|FOMC Press Conference"),
    ("fed_chair", "USD", r"Fed Chair .* (Speaks|Testifies)"),
    ("fed_member", "USD", r"FOMC Member|Fed .* Speaks|Fed Governor"),
    ("us_cpi", "USD", r"^(Core )?CPI"),
    ("us_pce", "USD", r"PCE"),
    ("us_ppi", "USD", r"^(Core )?PPI"),
    ("us_jobs", "USD", r"^Non-Farm Employment Change|^Unemployment Rate|Average Hourly Earnings"),
    ("us_labour_minor", "USD", r"ADP Non-Farm|JOLTS"),
    ("us_claims", "USD", r"Unemployment Claims"),
    ("us_growth", "USD", r"GDP|Retail Sales|ISM (Manufacturing|Services) PMI"),
    ("us_expect", "USD", r"Inflation Expectations"),
    ("us_sentiment", "USD", r"Consumer Sentiment|Consumer Confidence"),
    ("us_yields", "USD", r"(10|20|30)-y Bond Auction"),
    ("ecb", "EUR", r"Main Refinancing Rate|ECB Press Conference|Monetary Policy Statement"),
    ("boj", "JPY", r"BOJ Policy Rate|BOJ Press Conference|Monetary Policy Statement"),
    ("china", "CNY", r"CPI|PPI|GDP|PMI|Trade Balance|Industrial Production|Retail Sales"),
]


def family_of(title: str, country: str, impact: str = "") -> str:
    for fam, ctry, pat in RULES:
        if (ctry is None or ctry == country) and re.search(pat, title, flags=re.I):
            return fam
    return "other_high" if impact == "High" else "other"


def stars_from_ratio(ratio: float) -> int:
    """Event-day move over an ordinary day's: 2x or more is five stars."""
    for cut, s in ((2.0, 5), (1.6, 4), (1.3, 3), (1.1, 2)):
        if ratio >= cut:
            return s
    return 1


# Headlines: (stars, reason, every pattern must match the title)
NEWS_RULES: list[tuple[int, str, list[str]]] = [
    (5, "Central-bank buying has been the largest new source of gold demand since 2022",
     [r"central bank|PBOC|People's Bank|RBI|reserve bank", r"gold", r"buy|bought|purchas|add|reserves|holdings"]),
    (5, "India's import duty sets the gap between MCX and the world price",
     [r"import duty|customs duty|duty cut|duty hike|tariff value", r"gold"]),
    (5, "A Fed decision resets the cost of holding gold",
     [r"\bFed\b|Federal Reserve|FOMC|Powell", r"rate (cut|hike|decision)|cuts rates|raises rates|holds rates"]),
    (4, "Geopolitical shocks send buyers to gold as a safe haven",
     [r"\bwars?\b|attack|missile|invasion|sanction|ceasefire|conflict|geopolitic|tension|West Asia|Middle East|\bIran|Israel|Ukraine|Russia|Gaza|Taiwan",
      r"gold|safe.haven|bullion"]),
    (4, "Fed policy signals move real yields and the dollar",
     [r"\bFed\b|Federal Reserve|FOMC|Powell", r"gold|yield|dollar"]),
    (4, "Rate expectations set the cost of holding a metal that pays nothing",
     [r"rate.?(hike|cut|hold)s?\b.*\b(bets?|expectations?|hopes?|odds|fears?)\b|(bets?|expectations?|hopes?|odds) of (a )?rate",
      r"gold|bullion"]),
    (4, "US inflation data drives rate expectations",
     [r"inflation|CPI|PCE", r"gold|bullion"]),
    (4, "US jobs data move rate expectations",
     [r"payroll|jobs data|jobs report|NFP|employment", r"gold|bullion"]),
    (4, "Bond yields are the cost of holding a metal that pays nothing",
     [r"yield|treasur", r"gold|bullion"]),
    (4, "ETF flows are the clearest daily read of investment demand",
     [r"ETF|SPDR|GLD", r"gold", r"inflow|outflow|holdings|redemption"]),
    (4, "Gold is priced in dollars; a big dollar move moves it",
     [r"dollar|DXY|greenback", r"gold|bullion"]),
    (3, "Oil feeds inflation expectations, and through them rate bets",
     [r"crude|\boil\b", r"gold|bullion"]),
    (3, "A record or a sharp move changes the market's footing",
     [r"gold|bullion", r"record|all.time high|lifetime high|plunge|slump|surge|soar|tumble|crash|biggest"
                       r"|jumps?|rall(y|ies)|spikes?|drops? more than|\b[2-9](\.\d+)?%"]),
    (3, "Physical demand in the two largest markets",
     [r"gold", r"China|India|jewel|wedding|Dhanteras|Akshaya|festive|demand"]),
    (2, "Commentary or a forecast", [r"\bgold\b|bullion", r"price|market|rate|ounce|demand|invest|forecast|outlook|central|ETF"]),
]


# Local retail price notices ("gold rate today in Pakistan", "city-wise
# rates") are most of what the news feed returns, and none of them is news.
RETAIL = (r"in Pakistan|per tola|city.?wise|rates? today|prices? today|today['’]?s (gold )?rate|check (the )?latest|check rates"
          # single mining shares and fund tickers: company news, not gold news
          r"|stock price|NYSEARCA|NASDAQ|NYSE:|TSX|ASX:|Should You Buy|price target|Miners ETF|Junior|Mining (Corp|Inc|Ltd)|Advances"
          # explorers' press releases ("X Gold Corp: X Announces Drilling...") and karat price lists
          r"|\b(Corp|Inc|Ltd|Limited|plc)\b[.:]|Announces|Drilling|Exploration|Property|Financing|Launches|Initiative"
          r"|gold loan|\b(24|22|18)K\b|rates in .* today|Current price of gold|Gold IRA|Price Prediction|\bmine\b")


def clean_title(t: str) -> str:
    """GDELT spaces its titles' punctuation: "U. S.", "$4, 000", "1. 9 %"."""
    t = re.sub(r"<!--.*?-->|<!--.*$", "", t)
    t = re.sub(r"\s+([,.:;!?%')])", r"\1", t)
    t = re.sub(r"(\d)[,.] (\d)", lambda m: m.group(0).replace(" ", ""), t)
    t = re.sub(r"\b([A-Z])\. ([A-Z])\.", r"\1.\2.", t)
    # "rate - hike", "20 - year"; a dash before a capital is a separator ("bets - Kitco")
    t = re.sub(r"(\w) - ([a-z])", r"\1-\2", t)
    t = re.sub(r"\( ", "(", t)
    return re.sub(r"\s+", " ", t).strip(" -|")


def rate_headline(title: str) -> tuple[int, str] | None:
    for stars, reason, pats in NEWS_RULES:
        if all(re.search(p, title, flags=re.I) for p in pats):
            if stars <= 3 and re.search(RETAIL, title, flags=re.I):
                return None
            return stars, reason
    return None
