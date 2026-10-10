export type FieldDef = {
  key: string; label: string; group: string; unit: string; desc: string;
  /** A shorter name for a result row's figure line, where the label is long. */
  short?: string;
};

export const FIELD_CATALOG: FieldDef[] = [
  { key: "mcap", label: "Market cap", group: "Size & price", unit: "₹Cr", desc: "Total market value of the company", short: "MCap" },
  { key: "price", label: "Price", group: "Size & price", unit: "₹", desc: "Latest share price" },
  { key: "ret_1d", label: "Day change", group: "Size & price", unit: "%", desc: "The last session's close against the one before", short: "Day" },
  { key: "off_52w_high", label: "Off 52-week high", group: "Size & price", unit: "%", desc: "How far below its 52-week high (negative = below)", short: "Off high" },
  { key: "wk52_high", label: "52-week high", group: "Size & price", unit: "₹", desc: "Highest price in the last year" },
  { key: "wk52_low", label: "52-week low", group: "Size & price", unit: "₹", desc: "Lowest price in the last year" },
  { key: "beta", label: "Beta", group: "Size & price", unit: "", desc: "Volatility vs the market (1 = market-like)" },

  { key: "pe", label: "P/E", group: "Valuation", unit: "x", desc: "Price to earnings — years of profit you pay for" },
  { key: "median_pe_5y", label: "Median P/E (5y)", group: "Valuation", unit: "x", desc: "The stock's own typical P/E over 5 years", short: "Median P/E" },
  { key: "forward_pe", label: "Forward P/E", group: "Valuation", unit: "x", desc: "P/E on next year's expected earnings" },
  { key: "pb", label: "P/B", group: "Valuation", unit: "x", desc: "Price to book value" },
  { key: "ps", label: "P/S", group: "Valuation", unit: "x", desc: "Price to sales" },
  { key: "peg", label: "PEG", group: "Valuation", unit: "", desc: "P/E relative to growth (<1 often cheap for growth)" },
  { key: "ev_ebitda", label: "EV/EBITDA", group: "Valuation", unit: "x", desc: "Enterprise value to operating cash profits" },
  { key: "book_value", label: "Book value", group: "Valuation", unit: "₹/sh", desc: "Net assets per share" },
  { key: "div_yield", label: "Dividend yield", group: "Valuation", unit: "%", desc: "Annual dividend as % of price", short: "Div yield" },

  { key: "roce", label: "ROCE", group: "Quality", unit: "%", desc: "Return on capital employed — the classic quality test" },
  { key: "roe", label: "ROE", group: "Quality", unit: "%", desc: "Return on shareholders' equity" },
  { key: "roa", label: "ROA", group: "Quality", unit: "%", desc: "Return on total assets" },
  { key: "net_margin", label: "Net margin", group: "Quality", unit: "%", desc: "Profit kept from every ₹100 of sales" },
  { key: "op_margin", label: "Operating margin", group: "Quality", unit: "%", desc: "Operating profit per ₹100 of sales" },
  { key: "gross_margin", label: "Gross margin", group: "Quality", unit: "%", desc: "After direct costs, per ₹100 of sales" },
  { key: "avg_npm_5y", label: "Avg net margin (5y)", group: "Quality", unit: "%", desc: "5-year average profit margin — consistency test", short: "Avg margin 5y" },
  { key: "int_coverage", label: "Interest coverage", group: "Quality", unit: "x", desc: "How many times profits cover interest costs", short: "Int cover" },

  { key: "sales_cagr_5y", label: "Sales growth (5y)", group: "Growth", unit: "%/yr", desc: "Compounded revenue growth over 5 years", short: "Sales 5y" },
  { key: "sales_cagr_10y", label: "Sales growth (10y)", group: "Growth", unit: "%/yr", desc: "Compounded revenue growth over 10 years", short: "Sales 10y" },
  { key: "profit_cagr_5y", label: "Profit growth (5y)", group: "Growth", unit: "%/yr", desc: "Compounded profit growth over 5 years", short: "Profit 5y" },
  { key: "profit_cagr_10y", label: "Profit growth (10y)", group: "Growth", unit: "%/yr", desc: "Compounded profit growth over 10 years", short: "Profit 10y" },
  { key: "rev_growth", label: "Revenue growth (yoy)", group: "Growth", unit: "%", desc: "Latest year-on-year revenue growth", short: "Rev YoY" },
  { key: "earn_growth", label: "Earnings growth (yoy)", group: "Growth", unit: "%", desc: "Latest year-on-year earnings growth", short: "Earn YoY" },

  { key: "ret_1m", label: "Return 1 month", group: "Returns", unit: "%", desc: "Price change over the last month", short: "1M" },
  { key: "ret_3m", label: "Return 3 months", group: "Returns", unit: "%", desc: "Price change over 3 months", short: "3M" },
  { key: "ret_6m", label: "Return 6 months", group: "Returns", unit: "%", desc: "Price change over 6 months", short: "6M" },
  { key: "ret_1y", label: "Return 1 year", group: "Returns", unit: "%", desc: "Price change over 1 year", short: "1Y" },
  { key: "ret_3y", label: "Return 3 years", group: "Returns", unit: "%", desc: "Price change over 3 years", short: "3Y" },
  { key: "ret_5y", label: "Return 5 years", group: "Returns", unit: "%", desc: "Price change over 5 years", short: "5Y" },

  { key: "de", label: "Debt to equity", group: "Balance sheet", unit: "x", desc: "Borrowings vs shareholders' money (0 = debt-free)", short: "D/E" },
  { key: "total_debt", label: "Total debt", group: "Balance sheet", unit: "₹", desc: "All borrowings" },
  { key: "total_cash", label: "Total cash", group: "Balance sheet", unit: "₹", desc: "Cash and equivalents" },
  { key: "free_cashflow", label: "Free cash flow", group: "Balance sheet", unit: "₹", desc: "Cash left after running and investing in the business", short: "FCF" },
  { key: "revenue", label: "Revenue", group: "Balance sheet", unit: "₹", desc: "Trailing yearly sales" },
  { key: "net_income", label: "Net profit", group: "Balance sheet", unit: "₹", desc: "Trailing yearly profit" },
  { key: "div_payout", label: "Dividend payout", group: "Balance sheet", unit: "%", desc: "Share of profits paid out as dividends", short: "Payout" },
  { key: "debtor_days", label: "Debtor days", group: "Balance sheet", unit: "days", desc: "How long customers take to pay" },
  { key: "inventory_days", label: "Inventory days", group: "Balance sheet", unit: "days", desc: "How long stock sits before selling" },

  { key: "promoter_holding", label: "Promoter holding", group: "Ownership", unit: "%", desc: "Founders'/promoters' stake — skin in the game", short: "Promoter" },
  { key: "promoter_chg_qtr", label: "Promoter change (quarter)", group: "Ownership", unit: "pts", desc: "Change in the promoters' stake since the previous shareholding filing, in percentage points", short: "Promoter Δq" },
  { key: "promoter_chg_1y", label: "Promoter change (1 year)", group: "Ownership", unit: "pts", desc: "Change in the promoters' stake against the filing a year earlier, in percentage points", short: "Promoter Δ1y" },

  { key: "qtr_sales_yoy", label: "Quarter sales growth (YoY)", group: "Results", unit: "%", desc: "Latest quarter's sales against the same quarter a year earlier", short: "Qtr sales YoY" },
  { key: "qtr_profit_yoy", label: "Quarter profit growth (YoY)", group: "Results", unit: "%", desc: "Latest quarter's profit against the same quarter a year earlier. Left blank when that quarter was a loss", short: "Qtr profit YoY" },
  { key: "qtr_sales_qoq", label: "Quarter sales growth (QoQ)", group: "Results", unit: "%", desc: "Latest quarter's sales against the quarter before", short: "Qtr sales QoQ" },
  { key: "qtr_profit_qoq", label: "Quarter profit growth (QoQ)", group: "Results", unit: "%", desc: "Latest quarter's profit against the quarter before. Left blank when that quarter was a loss", short: "Qtr profit QoQ" },

  { key: "vs_dma50", label: "Price vs 50-day average", group: "Technicals", unit: "%", desc: "How far the price is above (+) or below (−) its average close of the last 50 sessions", short: "vs 50 DMA" },
  { key: "vs_dma200", label: "Price vs 200-day average", group: "Technicals", unit: "%", desc: "How far the price is above (+) or below (−) its average close of the last 200 sessions", short: "vs 200 DMA" },
  { key: "dma50_200", label: "50-day vs 200-day average", group: "Technicals", unit: "%", desc: "The 50-day average against the 200-day one. Above 0 means the 50 is above the 200 (a golden-cross state); below 0, under it", short: "50 vs 200" },
  { key: "rsi14", label: "RSI (14)", group: "Technicals", unit: "", desc: "Relative strength index over 14 sessions, 0–100. Under 30 is usually called oversold, over 70 overbought", short: "RSI" },
  { key: "vol_surge", label: "Volume vs 20-day average", group: "Technicals", unit: "×", desc: "The last session's traded volume as a multiple of the average of the 20 before it", short: "Volume" },

  { key: "season_peak", label: "Sales peak quarter", group: "Seasons", unit: "", desc: "The quarter of the financial year that usually brings the most sales: 1 = Apr–Jun, 2 = Jul–Sep, 3 = Oct–Dec, 4 = Jan–Mar. Only for companies whose pattern beats luck (shuffle test, and it repeats in later years); blank otherwise", short: "Peak qtr" },
  { key: "season_low", label: "Sales weakest quarter", group: "Seasons", unit: "", desc: "The quarter that usually brings the least sales, numbered the same way. Blank unless the pattern beats luck", short: "Weak qtr" },
  { key: "season_swing", label: "Seasonal swing", group: "Seasons", unit: "%", desc: "How much bigger sales usually are in the peak quarter than in the weakest, each against an average quarter of the same year. Blank unless the pattern beats luck", short: "Swing" },

  { key: "f_score", label: "Piotroski F-score", group: "Scores", unit: "/9", desc: "Nine pass/fail tests on the two latest annual reports: profit, cash flow, rising return on assets, cash above profit, no rise in debt, better current ratio, no new shares, rising gross margin, rising asset turnover. 8–9 is strong, 0–2 weak. Banks have no score", short: "F-score" },

  { key: "volatility_1y", label: "Volatility (1y)", group: "Risk", unit: "%", desc: "How wildly the price swings — annualised realised volatility from a year of daily bars (Yang-Zhang OHLC estimator); under ~25% is calm, over ~50% is stormy", short: "Vol 1y" },
  { key: "volatility_30d", label: "Volatility (30d)", group: "Risk", unit: "%", desc: "Same measure over just the last month — spikes when news hits", short: "Vol 30d" },
];

export const FIELD_GROUPS = [...new Set(FIELD_CATALOG.map((f) => f.group))];

/** What the screener can screen besides companies. Each has its own fields,
 *  read from the same files its list page uses. */
export type Universe = "companies" | "indices" | "commodities";

export const INDEX_FIELDS: FieldDef[] = [
  { key: "price", label: "Level", group: "Level", unit: "", desc: "The index's latest close, in points" },
  { key: "ret_1d", label: "Day change", group: "Level", unit: "%", desc: "The last session's close against the one before", short: "Day" },
  { key: "from_ath", label: "From all-time high", group: "Level", unit: "%", desc: "How far below its highest close (negative = below)", short: "From high" },
  { key: "members", label: "Companies", group: "Level", unit: "", desc: "How many companies the index holds" },
  { key: "ret_1m", label: "Return 1 month", group: "Returns", unit: "%", desc: "Price change over the last month", short: "1M" },
  { key: "ret_1y", label: "Return 1 year", group: "Returns", unit: "%", desc: "Price change over the last year", short: "1Y" },
  { key: "pe", label: "P/E", group: "Valuation", unit: "x", desc: "The index's P/E as NSE publishes it" },
  { key: "pb", label: "P/B", group: "Valuation", unit: "x", desc: "The index's price to book as NSE publishes it" },
  { key: "div_yield", label: "Dividend yield", group: "Valuation", unit: "%", desc: "The index's dividend yield as NSE publishes it", short: "Div yield" },
  { key: "pe_pct", label: "P/E against its 10 years", group: "Valuation", unit: "%", desc: "Share of the last ten years' days on which the P/E was lower than now: 90 means dearer than on 90% of days", short: "P/E pctile" },
];

export const COMMODITY_FIELDS: FieldDef[] = [
  { key: "price", label: "Price", group: "Price", unit: "₹", desc: "The most traded month's latest close" },
  { key: "ret_1d", label: "Day change", group: "Price", unit: "%", desc: "The last session's close against the one before", short: "Day" },
  { key: "next_prem", label: "Next expiry premium", group: "Curve", unit: "%", desc: "The second month's price over the nearest's", short: "Next" },
  { key: "carry_pa", label: "Carry, a year", group: "Curve", unit: "%", desc: "That premium spread over the days between the two expiries, as % a year", short: "Carry/yr" },
  { key: "world_prem", label: "vs World", group: "Comparison", unit: "%", desc: "MCX against the same month on COMEX or NYMEX, in rupees", short: "vs World" },
  { key: "spot_prem", label: "vs Spot", group: "Comparison", unit: "%", desc: "NCDEX against the mandi price at its delivery centre", short: "vs Spot" },
  { key: "oi", label: "Open interest", group: "Activity", unit: "", desc: "Contracts outstanding across the months trading", short: "OI" },
  { key: "vol", label: "Volume", group: "Activity", unit: "", desc: "Contracts traded on the latest day", short: "Vol" },
];

export function catalogFor(u: Universe): FieldDef[] {
  return u === "indices" ? INDEX_FIELDS : u === "commodities" ? COMMODITY_FIELDS : FIELD_CATALOG;
}
