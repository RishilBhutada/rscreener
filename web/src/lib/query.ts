export type Row = Record<string, string | number | null>;

export class QueryError extends Error {
  pos: number;
  constructor(message: string, pos: number) {
    super(message);
    this.pos = pos;
  }
}

const ALIASES: Record<string, string> = {
  marketcap: "mcap",
  market_cap: "mcap",
  dividend_yield: "div_yield",
  dy: "div_yield",
  yield: "div_yield",
  debt_to_equity: "de",
  debttoequity: "de",
  opm: "op_margin",
  npm: "net_margin",
  sales_growth: "rev_growth",
  revenue_growth: "rev_growth",
  profit_growth: "earn_growth",
  earnings_growth: "earn_growth",
  bookvalue: "book_value",
  bv: "book_value",
  sales_growth_5y: "sales_cagr_5y",
  sales_growth_10y: "sales_cagr_10y",
  profit_growth_5y: "profit_cagr_5y",
  profit_growth_10y: "profit_cagr_10y",
  price_to_sales: "ps",
  evebitda: "ev_ebitda",
  ev_by_ebitda: "ev_ebitda",
  interest_coverage: "int_coverage",
  promoter: "promoter_holding",
  payout: "div_payout",
  median_pe: "median_pe_5y",
  avg_margin: "avg_npm_5y",
  volatility: "volatility_1y",
  hv: "volatility_1y",
  return_1y: "ret_1y",
  return_3y: "ret_3y",
  return_5y: "ret_5y",
  down_from_high: "off_52w_high",
};

export const NUMERIC_FIELDS = [
  "mcap", "price", "pe", "forward_pe", "pb", "book_value", "roe", "roa", "de",
  "div_yield", "net_margin", "op_margin", "gross_margin", "rev_growth",
  "earn_growth", "revenue", "net_income", "total_debt", "total_cash",
  "free_cashflow", "wk52_high", "wk52_low", "beta",
  "sales_cagr_5y", "sales_cagr_10y", "profit_cagr_5y", "profit_cagr_10y",
  "roce", "ev_ebitda", "ps", "peg", "int_coverage", "div_payout",
  "debtor_days", "inventory_days", "promoter_holding",
  "median_pe_5y", "avg_npm_5y",
  "ret_1m", "ret_3m", "ret_6m", "ret_1y", "ret_3y", "ret_5y", "off_52w_high",
  "volatility_1y", "volatility_30d",
];

export function isValidRatioName(name: string): string | null {
  const n = name.trim().toLowerCase();
  if (!/^[a-z_][a-z0-9_]*$/.test(n)) return "name must be letters/numbers/underscores, starting with a letter";
  if (NUMERIC_FIELDS.includes(n) || ALIASES[n]) return `'${n}' is already a built-in field`;
  if (["and", "or"].includes(n)) return "that word is reserved";
  return null;
}

/** Replace custom-ratio names with their (parenthesised) formulas, textually. */
export function substituteRatios(src: string, ratios: Record<string, string>): string {
  let out = src;
  for (let pass = 0; pass < 5; pass++) {
    let changed = false;
    for (const [name, formula] of Object.entries(ratios)) {
      const re = new RegExp(`\\b${name}\\b`, "gi");
      if (re.test(out)) {
        out = out.replace(re, `(${formula})`);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return out;
}

type Tok =
  | { kind: "ident" | "num" | "op" | "arith"; value: string; pos: number }
  | { kind: "lparen" | "rparen" | "and" | "or"; value: string; pos: number };

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "(") { toks.push({ kind: "lparen", value: c, pos: i }); i++; continue; }
    if (c === ")") { toks.push({ kind: "rparen", value: c, pos: i }); i++; continue; }
    if ("+-*/".includes(c)) { toks.push({ kind: "arith", value: c, pos: i }); i++; continue; }
    if ("<>=!".includes(c)) {
      const two = src.slice(i, i + 2);
      if (["<=", ">=", "==", "!="].includes(two)) {
        toks.push({ kind: "op", value: two === "==" ? "=" : two, pos: i });
        i += 2;
      } else if (c === "<" || c === ">" || c === "=") {
        toks.push({ kind: "op", value: c, pos: i });
        i++;
      } else {
        throw new QueryError(`unexpected '${c}'`, i);
      }
      continue;
    }
    const num = /^\d+(\.\d+)?/.exec(src.slice(i));
    if (num) {
      toks.push({ kind: "num", value: num[0], pos: i });
      i += num[0].length;
      if (src[i] === "%") i++; // "20%" - the % is decorative
      continue;
    }
    const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
    if (word) {
      const w = word[0].toLowerCase();
      if (w === "and" || w === "or") toks.push({ kind: w, value: w, pos: i });
      else toks.push({ kind: "ident", value: w, pos: i });
      i += word[0].length;
      continue;
    }
    throw new QueryError(`unexpected character '${c}'`, i);
  }
  return toks;
}

type Arith =
  | { a: "num"; v: number }
  | { a: "field"; name: string }
  | { a: "neg"; v: Arith }
  | { a: "bin"; op: string; l: Arith; r: Arith };

type Node =
  | { t: "cmp"; l: Arith; op: string; r: Arith }
  | { t: "and" | "or"; l: Node; r: Node };

class Parser {
  toks: Tok[];
  i = 0;
  fields = new Set<string>();
  constructor(toks: Tok[]) { this.toks = toks; }

  peek(): Tok | undefined { return this.toks[this.i]; }
  next(): Tok | undefined { return this.toks[this.i++]; }

  parseExpr(): Node {
    let left = this.parseAnd();
    while (this.peek()?.kind === "or") {
      this.next();
      left = { t: "or", l: left, r: this.parseAnd() };
    }
    return left;
  }

  parseAnd(): Node {
    let left = this.parseBoolAtom();
    while (this.peek()?.kind === "and") {
      this.next();
      left = { t: "and", l: left, r: this.parseBoolAtom() };
    }
    return left;
  }

  parseBoolAtom(): Node {
    const mark = this.i;
    try {
      return this.parseComparison();
    } catch (e) {
      if (e instanceof QueryError && this.toks[mark]?.kind === "lparen") {
        this.i = mark;
        this.next();
        const inner = this.parseExpr();
        const close = this.next();
        if (close?.kind !== "rparen") throw new QueryError("missing closing ')'", this.toks[mark].pos);
        return inner;
      }
      throw e;
    }
  }

  parseComparison(): Node {
    const l = this.parseSum();
    const op = this.peek();
    if (op?.kind !== "op") {
      throw new QueryError(`expected <, >, <=, >=, = or !=`, op?.pos ?? 0);
    }
    this.next();
    const r = this.parseSum();
    return { t: "cmp", l, op: op.value, r };
  }

  parseSum(): Arith {
    let left = this.parseProd();
    while (this.peek()?.kind === "arith" && "+-".includes(this.peek()!.value)) {
      const op = this.next()!.value;
      left = { a: "bin", op, l: left, r: this.parseProd() };
    }
    return left;
  }

  parseProd(): Arith {
    let left = this.parseUnary();
    while (this.peek()?.kind === "arith" && "*/".includes(this.peek()!.value)) {
      const op = this.next()!.value;
      left = { a: "bin", op, l: left, r: this.parseUnary() };
    }
    return left;
  }

  parseUnary(): Arith {
    const tok = this.peek();
    if (tok?.kind === "arith" && tok.value === "-") {
      this.next();
      return { a: "neg", v: this.parseUnary() };
    }
    return this.parseArithAtom();
  }

  parseArithAtom(): Arith {
    const tok = this.next();
    if (!tok) throw new QueryError("query ended unexpectedly", 0);
    if (tok.kind === "num") return { a: "num", v: parseFloat(tok.value) };
    if (tok.kind === "ident") {
      const field = ALIASES[tok.value] ?? tok.value;
      if (!NUMERIC_FIELDS.includes(field)) {
        throw new QueryError(`unknown field '${tok.value}' - try: ${NUMERIC_FIELDS.slice(0, 8).join(", ")}...`, tok.pos);
      }
      this.fields.add(field);
      return { a: "field", name: field };
    }
    if (tok.kind === "lparen") {
      const inner = this.parseSum();
      const close = this.next();
      if (close?.kind !== "rparen") throw new QueryError("missing closing ')'", tok.pos);
      return inner;
    }
    throw new QueryError(`expected a field or number, got '${tok.value}'`, tok.pos);
  }
}

function evalArith(node: Arith, row: Row): number | null {
  switch (node.a) {
    case "num":
      return node.v;
    case "field": {
      const v = row[node.name];
      return v === null || v === undefined || typeof v !== "number" || Number.isNaN(v) ? null : v;
    }
    case "neg": {
      const v = evalArith(node.v, row);
      return v === null ? null : -v;
    }
    case "bin": {
      const l = evalArith(node.l, row);
      const r = evalArith(node.r, row);
      if (l === null || r === null) return null;
      switch (node.op) {
        case "+": return l + r;
        case "-": return l - r;
        case "*": return l * r;
        case "/": return r === 0 ? null : l / r;
        default: return null;
      }
    }
  }
}

function evalNode(node: Node, row: Row): boolean | null {
  if (node.t === "cmp") {
    const l = evalArith(node.l, row);
    const r = evalArith(node.r, row);
    if (l === null || r === null) return null;
    switch (node.op) {
      case "<": return l < r;
      case ">": return l > r;
      case "<=": return l <= r;
      case ">=": return l >= r;
      case "=": return l === r;
      case "!=": return l !== r;
      default: return null;
    }
  }
  const l = evalNode(node.l, row);
  const r = evalNode(node.r, row);
  if (node.t === "and") {
    if (l === false || r === false) return false;
    if (l === null || r === null) return null;
    return true;
  }
  if (l === true || r === true) return true;
  if (l === null || r === null) return null;
  return false;
}

export function compile(
  src: string,
  customRatios: Record<string, string> = {}
): { run: (row: Row) => boolean | null; fields: string[] } {
  const substituted = substituteRatios(src, customRatios);
  const toks = tokenize(substituted);
  if (toks.length === 0) throw new QueryError("empty query", 0);
  const p = new Parser(toks);
  const ast = p.parseExpr();
  if (p.i < p.toks.length) {
    const extra = p.toks[p.i];
    throw new QueryError(`unexpected '${extra.value}' - did you forget 'and' / 'or'?`, extra.pos);
  }
  return { run: (row) => evalNode(ast, row), fields: [...p.fields] };
}
