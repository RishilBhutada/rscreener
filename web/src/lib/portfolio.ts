export type Holding = { symbol: string; qty: number; avg: number };

const PORTFOLIO_KEY = "rscreener_portfolio";

export function loadPortfolio(): Holding[] {
  try {
    const raw = JSON.parse(localStorage.getItem(PORTFOLIO_KEY) ?? "[]") as Holding[];
    // One row per symbol. Sync unions two devices' arrays at sign-in, so a
    // holding edited on one device arrives twice; the later copy wins.
    const by = new Map<string, Holding>();
    for (const h of Array.isArray(raw) ? raw : []) {
      if (h && typeof h.symbol === "string" && h.qty > 0) by.set(h.symbol, h);
    }
    return Array.from(by.values());
  } catch {
    return [];
  }
}

export function savePortfolio(holdings: Holding[]): void {
  try {
    localStorage.setItem(PORTFOLIO_KEY, JSON.stringify(holdings));
  } catch { /* private mode or quota - the page must not break over it */ }
}

/** Add a holding, or replace the one already held under that symbol. */
export function upsertHolding(h: Holding): Holding[] {
  const list = loadPortfolio().filter((x) => x.symbol !== h.symbol);
  const next = [...list, h];
  savePortfolio(next);
  return next;
}

export function removeHolding(symbol: string): Holding[] {
  const next = loadPortfolio().filter((x) => x.symbol !== symbol);
  savePortfolio(next);
  return next;
}

const SYMBOL_COLS = /^(symbol|scrip|instrument|tradingsymbol|stock ?name|name of instrument)$/i;
const QTY_COLS = /^(qty|quantity|quantity available|qty\.?|shares|units|net qty|total qty)$/i;
const AVG_COLS = /^(avg|average|avg\.? ?cost|average price|avg\.? ?price|buy price|purchase price|avg\.? ?buy ?price|buy avg)$/i;

function splitLine(line: string, delim: string): string[] {
  // minimal CSV field splitter with quote support
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === delim && !inQ) {
      out.push(cur); cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function cleanSymbol(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/^NSE:/, "")
    .replace(/-(EQ|BE|BZ|SM)$/, "")
    .trim();
}

function toNum(raw: string): number | null {
  const n = parseFloat(raw.replace(/[",₹\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Parses broker holdings exports (Zerodha Console, Angel One, Groww and
 * similar CSVs) - finds the header row, maps columns by name. */
export function parseHoldings(text: string): { holdings: Holding[]; skippedLines: number; error?: string } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return { holdings: [], skippedLines: 0, error: "empty input" };
  const delim = (lines[0].match(/\t/g) ?? []).length > 0 ? "\t" : ",";

  let headerIdx = -1;
  let symCol = -1, qtyCol = -1, avgCol = -1;
  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    const cells = splitLine(lines[i], delim);
    const s = cells.findIndex((c) => SYMBOL_COLS.test(c));
    const q = cells.findIndex((c) => QTY_COLS.test(c));
    const a = cells.findIndex((c) => AVG_COLS.test(c));
    if (s >= 0 && q >= 0 && a >= 0) {
      headerIdx = i; symCol = s; qtyCol = q; avgCol = a;
      break;
    }
  }
  if (headerIdx < 0) {
    return { holdings: [], skippedLines: 0, error: "couldn't find a header row with symbol, quantity and average-price columns" };
  }

  const holdings: Holding[] = [];
  let skipped = 0;
  for (const line of lines.slice(headerIdx + 1)) {
    const cells = splitLine(line, delim);
    const symbol = cleanSymbol(cells[symCol] ?? "");
    const qty = toNum(cells[qtyCol] ?? "");
    const avg = toNum(cells[avgCol] ?? "");
    if (!symbol || !/^[A-Z0-9&-]+$/.test(symbol) || qty === null || avg === null || qty <= 0) {
      skipped++;
      continue;
    }
    const existing = holdings.find((h) => h.symbol === symbol);
    if (existing) {
      const totalQty = existing.qty + qty;
      existing.avg = (existing.avg * existing.qty + avg * qty) / totalQty;
      existing.qty = totalQty;
    } else {
      holdings.push({ symbol, qty, avg });
    }
  }
  return { holdings, skippedLines: skipped };
}
