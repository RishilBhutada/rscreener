/** Ready-made screens: well-known filters, written in the screener's own
 *  query language so each one opens as ordinary, editable filter chips.
 *
 *  These are filters, not recommendations. Where a famous screen needs data
 *  the app does not hold, the nearest honest version is used and its "i"
 *  says what differs from the original. */

export type LibraryScreen = {
  id: string;
  name: string;
  /** One line under the name. */
  blurb: string;
  /** The "i" text: what it tests and how it differs from the original. */
  about: string;
  query: string;
  /** Sectors left out (Yahoo's sector names). */
  excludeSectors?: string[];
  /** Fields whose ranks are added up, best first: -1 ranks high values
   *  first, 1 low values first. Results are shown in combined-rank order. */
  rank?: [string, 1 | -1][];
  sort?: [string, 1 | -1];
};

export const LIBRARY: LibraryScreen[] = [
  {
    id: "magic",
    name: "Magic Formula",
    blurb: "High return on capital, low price — ranked together",
    about: "Joel Greenblatt's screen. Every company is ranked twice — by ROCE (higher is better) and by EV/EBITDA (lower is cheaper) — and the two ranks are added; the list is in that combined order. Banks, finance companies and utilities are left out, as in the original. The original uses EBIT/EV; EV/EBITDA is the nearest figure the app holds.",
    query: "mcap > 1000 and roce > 0 and ev_ebitda > 0",
    excludeSectors: ["Financial Services", "Utilities"],
    rank: [["roce", -1], ["ev_ebitda", 1]],
  },
  {
    id: "piotroski",
    name: "Piotroski 8+",
    blurb: "F-score of 8 or 9 — improving on almost every test",
    about: "Joseph Piotroski's nine pass/fail tests on the two latest annual reports: profitable, cash-generative, return on assets rising, cash flow above profit, debt not rising, liquidity improving, no new shares, margins and asset turnover rising. Banks have no score. Figures come from Yahoo's statements and are unverified.",
    query: "f_score >= 8 and mcap > 500",
    sort: ["f_score", -1],
  },
  {
    id: "coffee",
    name: "Coffee-can style",
    blurb: "A decade of sales growth with a high return on capital",
    about: "In the spirit of Saurabh Mukherjea's Coffee Can screen, which asks for 10% sales growth and 15% ROCE in EVERY one of ten years. The app checks ten-year compounded sales growth above 10% and today's ROCE above 15%, which is looser: a company with one bad year can pass here and not there.",
    query: "sales_cagr_10y > 10 and roce > 15 and mcap > 1000",
    sort: ["roce", -1],
  },
  {
    id: "debtfree",
    name: "Debt-free compounders",
    blurb: "Almost no debt, high ROCE, profits growing",
    about: "Debt under a tenth of equity, ROCE above 20% and five-year profit growth above 15% a year.",
    query: "de < 0.1 and roce > 20 and profit_cagr_5y > 15 and mcap > 500",
    sort: ["profit_cagr_5y", -1],
  },
  {
    id: "results",
    name: "Strong latest quarter",
    blurb: "Sales up 20% and profit up 25% on a year ago",
    about: "The latest quarter's sales and profit against the same quarter a year earlier, from the as-filed results. A quarter after a loss has no profit growth figure and is left out.",
    query: "qtr_sales_yoy > 20 and qtr_profit_yoy > 25 and mcap > 500",
    sort: ["qtr_profit_yoy", -1],
  },
  {
    id: "golden",
    name: "Fresh golden cross",
    blurb: "50-day average just moved above the 200-day",
    about: "The 50-day average is above the 200-day average by less than 2% and the price is above the 50-day — the state just after a \"golden cross\". A description of the chart, not a forecast.",
    query: "dma50_200 > 0 and dma50_200 < 2 and vs_dma50 > 0 and mcap > 500",
    sort: ["mcap", -1],
  },
  {
    id: "high52",
    name: "Near 52-week high",
    blurb: "Within 5% of the year's high",
    about: "Price within 5% of its highest close of the last year.",
    query: "off_52w_high > -5 and mcap > 1000",
    sort: ["off_52w_high", -1],
  },
  {
    id: "volume",
    name: "Volume surge",
    blurb: "Three times the usual volume on an up day",
    about: "The last session's volume at least three times the average of the 20 before it, on a day the price rose more than 2%.",
    query: "vol_surge > 3 and ret_1d > 2 and mcap > 500",
    sort: ["vol_surge", -1],
  },
  {
    id: "oversold",
    name: "Oversold quality",
    blurb: "RSI under 30, ROCE over 15%",
    about: "Companies with a 14-day RSI under 30 — a price that has fallen hard and fast — that still earn more than 15% on their capital.",
    query: "rsi14 < 30 and roce > 15 and mcap > 1000",
    sort: ["rsi14", 1],
  },
  {
    id: "promoters",
    name: "Promoters adding",
    blurb: "Promoter stake up more than 1 point in a quarter",
    about: "The promoters' share of the company rose by more than one percentage point since the previous shareholding filing. A rise can come from buying, or from other holders' shares being cancelled.",
    query: "promoter_chg_qtr > 1",
    sort: ["promoter_chg_qtr", -1],
  },
  {
    id: "cheaphist",
    name: "Cheap against its own past",
    blurb: "P/E 30% under its five-year median",
    about: "Today's P/E against the company's own median P/E over five years. Cheaper than usual can mean the market expects worse years, not a bargain.",
    query: "pe > 0 and pe < median_pe_5y * 0.7 and mcap > 500",
    sort: ["mcap", -1],
  },
  {
    id: "dividend",
    name: "Dividend payers",
    blurb: "Yield over 3%, paying out under 70% of profit",
    about: "A dividend yield above 3% from a company paying out less than 70% of its profit, so the dividend is not eating the business.",
    query: "div_yield > 3 and div_payout < 70 and mcap > 500",
    sort: ["div_yield", -1],
  },
  {
    id: "quality",
    name: "Quality compounders",
    blurb: "ROCE over 20%, sales growing 12%+, low debt",
    about: "ROCE above 20%, five-year sales growth above 12% a year and debt under half of equity.",
    query: "roce > 20 and sales_cagr_5y > 12 and de < 0.5",
    sort: ["mcap", -1],
  },
  {
    id: "beaten",
    name: "Beaten-down quality",
    blurb: "30% off the high, ROCE still over 18%",
    about: "More than 30% below the 52-week high while ROCE stays above 18%.",
    query: "off_52w_high < -30 and roce > 18",
    sort: ["off_52w_high", 1],
  },
];

export function libraryById(id: string | null | undefined): LibraryScreen | undefined {
  return id ? LIBRARY.find((s) => s.id === id) : undefined;
}
