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
                  "Weak demand at a long bond auction pushes yields up - the opportunity cost of holding gold. "
                  "The result is the yield the bonds sold at, and cover: the bids as a multiple of the amount "
                  "offered. A low cover means weak demand."),
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
    "beige_book": (2, "Fed Beige Book",
                   "The Fed's survey of business in its twelve districts, out two weeks before each meeting. It "
                   "colours expectations for the decision; it rarely moves gold on the day."),
    "rbi": (3, "RBI policy decision",
            "Sets India's repo rate and moves the rupee. MCX gold is priced in rupees, so a weaker rupee lifts "
            "the MCX price even when the world price is flat."),
    "india_budget": (4, "India's Union Budget",
                     "The budget is where India usually changes the import duty on gold - most of the gap between "
                     "MCX and the world price. The July 2024 budget cut it from 15% to 6% and MCX gold fell "
                     "sharply that day."),
    "india_duty": (5, "India changes the gold import duty",
                   "The duty is most of the gap between MCX and the world price; a change moves MCX by about "
                   "the size of the change, whatever the world price does."),
    "festival": (2, "Festival buying (India)",
                 "Dhanteras is India's biggest gold-buying day. It shows in jewellers' sales and the local "
                 "premium, rarely in the world price."),
    "announced": (5, "Announced (from the news)",
                  "An unscheduled announcement found in the headlines: a central bank buying gold, or a change "
                  "to India's import duty. Each is rated by the rule its headline matched."),
    "mcx_expiry": (2, "MCX gold contract expiry",
                   "The month's MCX gold contract stops trading; positions roll to the next month or settle. "
                   "It matters to anyone holding MCX futures, not to the world price."),
    # Owner, 20-Nov-2026: "include more imp events too like elections of us etc".
    "us_election": (4, "US election",
                    "A new president or Congress can change taxes, spending, tariffs and the Fed's leadership - "
                    "the deficits and the dollar gold answers to. The result usually lands overnight, so gold "
                    "reacts in the next session."),
    "india_election": (3, "India election results",
                       "Counting day moves the rupee and Indian markets; MCX gold, priced in rupees, moves with "
                       "the rupee even when the world price is flat."),
    "us_fiscal": (3, "US shutdown / debt ceiling",
                  "A shutdown delays the US data the Fed relies on, and a debt-ceiling standoff raises doubt "
                  "about US credit - both have sent buyers to gold as a safe haven."),
    "trade": (3, "Tariff deadline",
              "Tariffs feed inflation and slow growth at the same time and unsettle the dollar; sudden ones "
              "have sent buyers to gold."),
    "opec": (2, "OPEC+ meeting",
             "Oil output decisions move oil prices, and oil feeds inflation expectations and with them rate bets."),
    "cb_gold": (3, "World gold demand report",
                "The World Gold Council's quarterly count of demand, including central banks' buying - the "
                "largest new source of demand since 2022."),
    "other_high": (1, "Major data elsewhere", "A high-impact release in a smaller economy; it reaches gold, if at all, through the dollar."),
    "other": (1, "Other data", "Little direct link to gold."),
}

# Mechanical dates, not news: measuring the world price around them means
# nothing. A headline's time is when it was seen, not when the news broke.
NOT_MEASURED = {"mcx_expiry", "announced"}

# India's own events reach gold through the rupee and the duty: they are
# measured on MCX, not COMEX.
MEASURE_ON_MCX = {"rbi", "india_budget", "india_duty", "festival", "india_election"}


def us_elections(first: int = 2000, last: int = 2028) -> list[tuple[str, str]]:
    """US federal elections by law (2 U.S.C. 7, 3 U.S.C. 1): the Tuesday after
    the first Monday in November of every even year - presidential when the
    year divides by four, midterm otherwise. [(date, title)]."""
    from datetime import date, timedelta
    out = []
    for y in range(first + first % 2, last + 1, 2):
        d = date(y, 11, 1)
        d += timedelta(days=(0 - d.weekday()) % 7)      # first Monday
        d += timedelta(days=1)                          # the Tuesday after it
        out.append((d.isoformat(), "US presidential election" if y % 4 == 0 else "US midterm election"))
    return out


# Elections, fiscal deadlines, tariffs, OPEC+ and gold-demand reports, kept by
# hand: each set case by case by a parliament, a cartel or a publisher, not by
# a rule a program can follow. Each line:
# (date, local time, zone "NY" / "IST" / "UTC", family, country, title, source).
# A date only trackers have reported, not an official notice, says "reported".
# Checked 20-Nov-2026; add new ones as they are announced.
WORLD_EVENTS: list[tuple[str, str, str, str, str, str, str]] = [
    # India: counting day, from 8am IST.
    ("2004-05-13", "08:00", "IST", "india_election", "INR", "Lok Sabha results (14th)", "Election Commission of India; counting 13 May 2004"),
    ("2009-05-16", "08:00", "IST", "india_election", "INR", "Lok Sabha results (15th)", "Election Commission of India; counting 16 May 2009 (public record; not re-checked 20-Nov-2026)"),
    ("2014-05-16", "08:00", "IST", "india_election", "INR", "Lok Sabha results (16th)", "Election Commission of India; counting 16 May 2014 (public record; not re-checked 20-Nov-2026)"),
    ("2019-05-23", "08:00", "IST", "india_election", "INR", "Lok Sabha results (17th)", "Election Commission of India; counting 23 May 2019 (public record; not re-checked 20-Nov-2026)"),
    ("2024-06-04", "08:00", "IST", "india_election", "INR", "Lok Sabha results (18th)", "Election Commission of India; counting 4 Jun 2024"),
    # US shutdowns (the first day without funding) and debt-ceiling dates.
    ("2011-08-02", "12:00", "NY", "us_fiscal", "USD", "Debt-ceiling deadline (Budget Control Act signed)", "Treasury's 2 Aug 2011 deadline; S&P downgrade followed on 5 Aug (public record; not re-checked 20-Nov-2026)"),
    ("2013-10-01", "00:01", "NY", "us_fiscal", "USD", "US government shutdown begins (16 days)", "Shutdown 1-17 Oct 2013 (public record; not re-checked 20-Nov-2026)"),
    ("2013-10-17", "00:01", "NY", "us_fiscal", "USD", "Debt-ceiling deadline", "Treasury's 17 Oct 2013 estimate; deal signed late on the 16th (public record; not re-checked 20-Nov-2026)"),
    ("2018-12-22", "00:01", "NY", "us_fiscal", "USD", "US government shutdown begins (35 days)", "Shutdown 22 Dec 2018 - 25 Jan 2019 (public record; not re-checked 20-Nov-2026)"),
    ("2023-06-05", "00:01", "NY", "us_fiscal", "USD", "Debt-ceiling deadline (Fiscal Responsibility Act signed 3 Jun)", "Treasury's 5 Jun 2023 estimate (public record; not re-checked 20-Nov-2026)"),
    ("2025-10-01", "00:01", "NY", "us_fiscal", "USD", "US government shutdown begins (43 days)", "Shutdown 1 Oct - 12 Nov 2025; ended by P.L. 119-37"),
    ("2026-01-31", "00:01", "NY", "us_fiscal", "USD", "Partial US shutdown begins (4 days, reported)", "Reported: lapse 31 Jan - 3 Feb 2026 after P.L. 119-37's funding ended 30 Jan"),
    ("2026-12-12", "00:01", "NY", "us_fiscal", "USD", "US funding runs out unless Congress acts (reported)", "Reported: stopgap H.R. 6500 funds the government through 11 Dec 2026"),
    # Tariffs.
    ("2025-04-02", "16:00", "NY", "trade", "USD", "US 'reciprocal' tariffs announced", "White House announcement, 2 Apr 2025 (public record; not re-checked 20-Nov-2026)"),
    ("2025-04-09", "13:00", "NY", "trade", "USD", "US pauses reciprocal tariffs for 90 days", "White House announcement, 9 Apr 2025 (public record; not re-checked 20-Nov-2026)"),
    ("2027-01-10", "00:01", "NY", "trade", "USD", "US-China tariff truce due to end (reported)", "Reported extension from 10 Nov 2026; not yet in the Federal Register"),
    ("2027-12-31", "23:59", "NY", "trade", "USD", "US Section 232 steel and aluminium measures due to lapse (reported)", "Reported by trade trackers; check CBP notices"),
    # OPEC+ (meetings are on Sundays: the reaction is the next session).
    ("2026-10-04", "12:00", "UTC", "opec", "OPEC", "OPEC+ group-of-seven output meeting", "OPEC press release, 4 Oct 2026"),
    ("2026-11-01", "12:00", "UTC", "opec", "OPEC", "OPEC+ group-of-seven output meeting", "OPEC press release, 4 Oct 2026"),
    ("2026-11-29", "12:00", "UTC", "opec", "OPEC", "OPEC+ ministerial meeting (42nd, reported)", "Reported by meeting trackers; not yet confirmed on opec.org"),
    # World Gold Council, Gold Demand Trends (London morning).
    ("2026-04-29", "08:00", "UTC", "cb_gold", "WORLD", "Gold Demand Trends Q1 2026", "World Gold Council press release, 29 Apr 2026"),
    ("2026-07-30", "08:00", "UTC", "cb_gold", "WORLD", "Gold Demand Trends Q2 2026", "World Gold Council press release, 30 Jul 2026"),
    ("2026-11-03", "08:00", "UTC", "cb_gold", "WORLD", "Gold Demand Trends Q3 2026", "World Gold Council press release, 3 Nov 2026"),
]

# India's scheduled events, kept by hand because their publishers cannot be
# read by a program (rbi.org.in answers robots.txt with HTTP 418). Each line:
# (date, IST time, family, title, where the date comes from). Add the next
# financial year's RBI meetings when RBI announces them, usually in March.
INDIA_EVENTS: list[tuple[str, str, str, str, str]] = [
    ("2025-04-09", "10:00", "rbi", "RBI policy decision", "RBI MPC schedule 2025-26 (26 Mar 2025)"),
    ("2025-06-06", "10:00", "rbi", "RBI policy decision", "RBI MPC schedule 2025-26"),
    ("2025-08-06", "10:00", "rbi", "RBI policy decision", "RBI MPC schedule 2025-26, moved a day on 6 Jun 2025"),
    ("2025-10-01", "10:00", "rbi", "RBI policy decision", "RBI MPC schedule 2025-26"),
    ("2025-12-05", "10:00", "rbi", "RBI policy decision", "RBI MPC schedule 2025-26"),
    ("2026-02-06", "10:00", "rbi", "RBI policy decision", "RBI MPC schedule 2025-26"),
    ("2026-04-08", "10:00", "rbi", "RBI policy decision", "RBI press release, 23 Mar 2026"),
    ("2026-06-05", "10:00", "rbi", "RBI policy decision", "RBI press release, 23 Mar 2026"),
    ("2026-08-05", "10:00", "rbi", "RBI policy decision", "RBI press release, 23 Mar 2026"),
    ("2026-10-07", "10:00", "rbi", "RBI policy decision", "RBI press release, 23 Mar 2026"),
    ("2026-12-04", "10:00", "rbi", "RBI policy decision", "RBI press release, 23 Mar 2026"),
    ("2027-02-05", "10:00", "rbi", "RBI policy decision", "RBI press release, 23 Mar 2026"),
    ("2026-02-01", "11:00", "india_budget", "Union Budget 2026-27", "Presented 1 Feb 2026"),
    ("2027-02-01", "11:00", "india_budget", "Union Budget 2027-28 (expected)",
     "1 February by convention since 2017; not yet notified"),
    ("2026-05-13", "10:00", "india_duty", "India raises gold import duty to 15% from 6%",
     "Government order effective 13 May 2026 (CNBC, 13 May 2026)"),
    ("2025-10-18", "12:00", "festival", "Dhanteras", "All India Radio (newsonair.gov.in), 18 Oct 2025"),
    ("2026-11-06", "12:00", "festival", "Dhanteras", "Hindu calendar sites"),
]

# India's import duty on gold - basic customs duty plus the agriculture cess -
# from the day each rate took effect. MCX prices carry it; COMEX does not, so
# it is most of the gap between the two.
DUTY: list[tuple[str, float, str]] = [
    ("2024-07-24", 6.0, "Union Budget, July 2024: cut from 15% to 6%"),
    ("2026-05-13", 15.0, "Raised to 15% (10% basic customs duty + 5% agriculture cess) to support the rupee"),
]


def duty_on(day: str) -> tuple[float, str, str] | None:
    """The duty in force on a day: (percent, since, why)."""
    found = None
    for since, pct, why in DUTY:
        if since <= day:
            found = (pct, since, why)
    return found

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
     # Whole words: "add" used to match "gold adds gains as central bank ...".
     # "adds 1%" is the price, not the bank.
     [r"central bank|PBOC|People's Bank|RBI|reserve bank", r"gold",
      r"\b(?:buy(?:s|ing)?|bought|purchas\w*|reserves|holdings)\b"
      r"|\badd(?:s|ed|ing)?\b(?!\s+(?:gains?|to (?:gains|losses)|[\d.]+\s*%))"]),
    # India's own duty only. "Tariff value" is left out: the base price duty
    # is charged on, revised routinely about every two weeks, not a change in
    # the duty. Another country's "import duty" on gold is not India's.
    (5, "India's import duty sets the gap between MCX and the world price",
     [r"import duty|customs duty|duty cut|duty hike", r"gold",
      r"India|Indian|Budget|CBIC|Sitharaman|finance ministry|New Delhi"]),
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


# Past ECB decisions. The ECB's meeting page lists only meetings ahead (the
# nightly run keeps those as they pass) and its list of past decisions is
# drawn by script, so these were read once, on 3 Oct 2026, from the Internet
# Archive's copies of the ECB's own meeting page (13 Jan and 10 Oct 2025).
ECB_PAST = ["2025-01-30", "2025-03-06", "2025-04-17", "2025-06-05", "2025-07-24", "2025-09-11", "2025-10-30",
            "2025-12-18", "2026-02-05", "2026-03-19", "2026-04-30", "2026-06-11", "2026-07-23", "2026-09-10"]

# Five-star rules whose headlines are announcements in their own right, shown
# on the calendar as well as in the news. (A Fed decision is already there.)
ANNOUNCE = {NEWS_RULES[0][1], NEWS_RULES[1][1]}


def rate_headline(title: str) -> tuple[int, str] | None:
    for stars, reason, pats in NEWS_RULES:
        if all(re.search(p, title, flags=re.I) for p in pats):
            if stars <= 3 and re.search(RETAIL, title, flags=re.I):
                return None
            return stars, reason
    return None
