export type FieldDef = { key: string; label: string; group: string; unit: string; desc: string };

export const FIELD_CATALOG: FieldDef[] = [
  { key: "mcap", label: "Market cap", group: "Size & price", unit: "₹Cr", desc: "Total market value of the company" },
  { key: "price", label: "Price", group: "Size & price", unit: "₹", desc: "Latest share price" },
  { key: "off_52w_high", label: "Off 52-week high", group: "Size & price", unit: "%", desc: "How far below its 52-week high (negative = below)" },
  { key: "wk52_high", label: "52-week high", group: "Size & price", unit: "₹", desc: "Highest price in the last year" },
  { key: "wk52_low", label: "52-week low", group: "Size & price", unit: "₹", desc: "Lowest price in the last year" },
  { key: "beta", label: "Beta", group: "Size & price", unit: "", desc: "Volatility vs the market (1 = market-like)" },

  { key: "pe", label: "P/E", group: "Valuation", unit: "x", desc: "Price to earnings — years of profit you pay for" },
  { key: "median_pe_5y", label: "Median P/E (5y)", group: "Valuation", unit: "x", desc: "The stock's own typical P/E over 5 years" },
  { key: "forward_pe", label: "Forward P/E", group: "Valuation", unit: "x", desc: "P/E on next year's expected earnings" },
  { key: "pb", label: "P/B", group: "Valuation", unit: "x", desc: "Price to book value" },
  { key: "ps", label: "P/S", group: "Valuation", unit: "x", desc: "Price to sales" },
  { key: "peg", label: "PEG", group: "Valuation", unit: "", desc: "P/E relative to growth (<1 often cheap for growth)" },
  { key: "ev_ebitda", label: "EV/EBITDA", group: "Valuation", unit: "x", desc: "Enterprise value to operating cash profits" },
  { key: "book_value", label: "Book value", group: "Valuation", unit: "₹/sh", desc: "Net assets per share" },
  { key: "div_yield", label: "Dividend yield", group: "Valuation", unit: "%", desc: "Annual dividend as % of price" },

  { key: "roce", label: "ROCE", group: "Quality", unit: "%", desc: "Return on capital employed — the classic quality test" },
  { key: "roe", label: "ROE", group: "Quality", unit: "%", desc: "Return on shareholders' equity" },
  { key: "roa", label: "ROA", group: "Quality", unit: "%", desc: "Return on total assets" },
  { key: "net_margin", label: "Net margin", group: "Quality", unit: "%", desc: "Profit kept from every ₹100 of sales" },
  { key: "op_margin", label: "Operating margin", group: "Quality", unit: "%", desc: "Operating profit per ₹100 of sales" },
  { key: "gross_margin", label: "Gross margin", group: "Quality", unit: "%", desc: "After direct costs, per ₹100 of sales" },
  { key: "avg_npm_5y", label: "Avg net margin (5y)", group: "Quality", unit: "%", desc: "5-year average profit margin — consistency test" },
  { key: "int_coverage", label: "Interest coverage", group: "Quality", unit: "x", desc: "How many times profits cover interest costs" },

  { key: "sales_cagr_5y", label: "Sales growth (5y)", group: "Growth", unit: "%/yr", desc: "Compounded revenue growth over 5 years" },
  { key: "sales_cagr_10y", label: "Sales growth (10y)", group: "Growth", unit: "%/yr", desc: "Compounded revenue growth over 10 years" },
  { key: "profit_cagr_5y", label: "Profit growth (5y)", group: "Growth", unit: "%/yr", desc: "Compounded profit growth over 5 years" },
  { key: "profit_cagr_10y", label: "Profit growth (10y)", group: "Growth", unit: "%/yr", desc: "Compounded profit growth over 10 years" },
  { key: "rev_growth", label: "Revenue growth (yoy)", group: "Growth", unit: "%", desc: "Latest year-on-year revenue growth" },
  { key: "earn_growth", label: "Earnings growth (yoy)", group: "Growth", unit: "%", desc: "Latest year-on-year earnings growth" },

  { key: "ret_1m", label: "Return 1 month", group: "Returns", unit: "%", desc: "Price change over the last month" },
  { key: "ret_3m", label: "Return 3 months", group: "Returns", unit: "%", desc: "Price change over 3 months" },
  { key: "ret_6m", label: "Return 6 months", group: "Returns", unit: "%", desc: "Price change over 6 months" },
  { key: "ret_1y", label: "Return 1 year", group: "Returns", unit: "%", desc: "Price change over 1 year" },
  { key: "ret_3y", label: "Return 3 years", group: "Returns", unit: "%", desc: "Price change over 3 years" },
  { key: "ret_5y", label: "Return 5 years", group: "Returns", unit: "%", desc: "Price change over 5 years" },

  { key: "de", label: "Debt to equity", group: "Balance sheet", unit: "x", desc: "Borrowings vs shareholders' money (0 = debt-free)" },
  { key: "total_debt", label: "Total debt", group: "Balance sheet", unit: "₹", desc: "All borrowings" },
  { key: "total_cash", label: "Total cash", group: "Balance sheet", unit: "₹", desc: "Cash and equivalents" },
  { key: "free_cashflow", label: "Free cash flow", group: "Balance sheet", unit: "₹", desc: "Cash left after running and investing in the business" },
  { key: "revenue", label: "Revenue", group: "Balance sheet", unit: "₹", desc: "Trailing yearly sales" },
  { key: "net_income", label: "Net profit", group: "Balance sheet", unit: "₹", desc: "Trailing yearly profit" },
  { key: "div_payout", label: "Dividend payout", group: "Balance sheet", unit: "%", desc: "Share of profits paid out as dividends" },
  { key: "debtor_days", label: "Debtor days", group: "Balance sheet", unit: "days", desc: "How long customers take to pay" },
  { key: "inventory_days", label: "Inventory days", group: "Balance sheet", unit: "days", desc: "How long stock sits before selling" },

  { key: "promoter_holding", label: "Promoter holding", group: "Ownership", unit: "%", desc: "Founders'/promoters' stake — skin in the game" },
];

export const FIELD_GROUPS = [...new Set(FIELD_CATALOG.map((f) => f.group))];
