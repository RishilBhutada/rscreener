/** The shapes of a company's file (pipeline/export_company_json.py) and of
 *  the figures the company page derives from it. */

import { CorpAction, Quarter } from "@/components/StockChart";
import { Row } from "@/lib/query";
import { Seasons } from "@/components/Seasons";

/** `parent`: a breakdown row, folded under that row's "+" (Material Cost % under Expenses). */
export type Stmt = { periods: string[]; items: { label: string; values: (number | null)[]; parent?: string }[]; declared?: (string | null)[]; basis?: (string | null)[] };

export type AnnualReport = { from: string; to: string; url: string };

export type AnnDoc = { date: string; title: string; url: string; kind?: string };

export type Trend = {
  periods: string[];
  revenue: (number | null)[];
  pat: (number | null)[];
  eps: (number | null)[];
  expenses?: (number | null)[];
  ebitda?: (number | null)[];
  book_value?: (number | null)[];
  opm?: (number | null)[];
  gpm?: (number | null)[];
  npm?: (number | null)[];
  /** Return on equity per year, % (annual trend). */
  roe?: (number | null)[];
  source: string[];
  /** consolidated / standalone per period (pipeline trend_lib), null where not filed. */
  basis?: (string | null)[];
};

export type Shareholding = {
  /** Central and state governments, %; number of shareholders; holders the
   *  filing names (promoters, and others above 1%), aligned with dates. */
  gov?: (number | null)[];
  holders_n?: (number | null)[];
  named?: { cat: string; name: string; values: (number | null)[] }[];
  dates: string[];
  promoter: (number | null)[];
  public: (number | null)[];
  employee: (number | null)[];
  /** Foreign and domestic institutions and mutual funds, from each quarter's
   *  XBRL - empty for quarters on SEBI's older format. */
  fii?: (number | null)[];
  dii?: (number | null)[];
  mf?: (number | null)[];
};

export type Pt = [string, number] | [string, number, number | null];

export type Prices = { monthly?: Pt[]; weekly?: Pt[]; daily?: Pt[] };

export type PeBand = { series: [string, number][]; median_5y: number | null };

export type ScreenData = { rows: Row[] };

export type Company = {
  generated_at: string;
  snapshot: Row;
  statements: Record<string, Stmt>;
  documents?: {
    annual_reports?: AnnualReport[]; concalls?: AnnDoc[]; ratings?: AnnDoc[];
    /** Concall presentations and recordings, beside the transcripts. */
    ppts?: AnnDoc[]; recordings?: AnnDoc[];
    /** [at "YYYY-MM-DD HH:MM", NSE category, subject, PDF, important 0/1]. */
    announcements?: [string, string, string, string, number][];
  };
  trend?: { annual?: Trend; quarterly?: Trend };
  shareholding?: Shareholding;
  prices?: Prices | null;
  pe_band?: PeBand | null;
  ev_band?: PeBand | null;
  pb_band?: PeBand | null;
  ps_band?: PeBand | null;
  quarters?: Quarter[] | null;
  actions?: CorpAction[] | null;
  coverage?: Coverage | null;
  ratios?: WcRatios | null;
  no_pe_reason?: string | null;
  /** Whether the filed figures are consolidated or standalone. Captioning one
   *  as the other says the numbers cover a different business than they do. */
  basis?: string | null;
  fscore?: FScoreData | null;
  seasons?: Seasons | null;
  /** [index symbol, name, group] - the indices it is a member of, broad market first. */
  indices?: [string, string, string][] | null;
  /** What the company does: its Wikipedia article (CC BY-SA 4.0), verified by the ticker in its infobox. */
  about?: { title: string; url: string; short: string | null; text: string | null } | null;
  /** Quarterly business updates filed before the results (pipeline/business_updates.py):
   *  n of the last `of` quarters on record, typical days after the quarter ended, the latest. */
  updates?: Updates | null;
  /** Face value per share, Rs (the exchange's equity list). */
  face_value?: number | null;
  /** In NSE's futures & options segment (fetch_fno.py). */
  fno?: boolean | null;
  /** The company's icon, relative to the site root (logos/SYM.png). */
  logo?: string | null;
  segments?: { quarterly?: Segments; annual?: Segments } | null;
  /** [day, name, category, Buy/Sell, shares, value Rs, mode] - newest first. */
  insider?: [string, string, string, string, number | null, number | null, string][] | null;
  exchange?: string | null;
  bse_code?: number | string | null;
  /** Written by pipeline/export_company_json.py so this page need not download
   *  the whole screener table. Optional: a company file exported before that
   *  change has none of the three, and the page falls back to fetching it. */
  row?: Row | null;
  peers?: Row[] | null;
  context?: {
    industry?: string;
    medians?: Record<string, [number, number]>;
    rank?: number | null;
    rank_of?: number;
    ind_rank?: number | null;
    ind_rank_of?: number;
    /** NSE's sector and basic industry where its index files carry them. */
    nse_sector?: string | null;
    nse_basic?: string | null;
    /** What the peers were picked by: NSE's basic industry, or the source's industry. */
    peer_group?: string | null;
  } | null;
};

/** Working-capital ratios per year - how the business is actually financed. */
export type WcRatios = {
  periods: string[];
  debtor_days: (number | null)[];
  inventory_days: (number | null)[];
  days_payable: (number | null)[];
  cash_conversion: (number | null)[];
  working_capital_days: (number | null)[];
  roce: (number | null)[];
};

/** What the filings behind this company actually cover. */
export type Coverage = { quarters: number; from?: string | null; to?: string | null; gaps?: string[]; gap_count?: number };

/** pipeline/business_updates.py summary(). */
export type Updates = { n: number; of: number; typ: number | null; last: { q: string; d: string; at?: string; doc?: string } };

/** The next results meeting on NSE's calendar: undefined while loading, null if none. */
export type NextResults = { date: string; purpose: string } | null | undefined;

/** Segments, as the company reports them in its results (screener.in's
 *  "Product segments"): revenue or profit before interest and tax per segment.
 *  Revenue is before inter-segment sales are removed, so the rows can add up
 *  to more than the company's sales. */
export type Segments = { periods: string[]; items: { name: string; rev: (number | null)[]; ebit: (number | null)[] }[] };

/** The nine Piotroski tests, as written by the pipeline. `pass` is null for a
 *  test whose inputs are not in both filed years. */
export type FScoreData = {
  score: number;
  measured: number;
  of: number;
  years: [string, string] | string[];
  checks: { name: string; test: string; pass: boolean | null; detail: string | null }[];
};

/** Every company in the same industry, plus where this one sits by size. */
export type Cohort = {
  /** Only populated by the fallback path, where medians must be computed here.
   *  With a modern company file the medians arrive precomputed and this is []. */
  rows: Row[];
  /** field -> [median, how many companies it came from] */
  medians: Record<string, [number, number]>;
  industry: string;
  rank: number | null;
  rankOf: number;
  indRank: number | null;
  indRankOf: number;
};

/** subFirst: the sub-line says something the reader must see (sources that
 *  disagree), so it takes the place of the industry median's text; the
 *  median's bar still draws. */
export type Tile = { label: string; value: string; sub?: string | null; field?: string; full?: string; info?: string; subFirst?: boolean };
