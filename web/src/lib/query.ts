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
};

export const NUMERIC_FIELDS = [
  "mcap", "price", "pe", "forward_pe", "pb", "book_value", "roe", "roa", "de",
  "div_yield", "net_margin", "op_margin", "gross_margin", "rev_growth",
  "earn_growth", "revenue", "net_income", "total_debt", "total_cash",
  "free_cashflow", "wk52_high", "wk52_low", "beta",
  "sales_cagr_5y", "sales_cagr_10y", "profit_cagr_5y", "profit_cagr_10y",
];

type Tok =
  | { kind: "ident" | "num" | "op"; value: string; pos: number }
  | { kind: "lparen" | "rparen" | "and" | "or"; value: string; pos: number };

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "(") { toks.push({ kind: "lparen", value: c, pos: i }); i++; continue; }
    if (c === ")") { toks.push({ kind: "rparen", value: c, pos: i }); i++; continue; }
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
    const num = /^-?\d+(\.\d+)?/.exec(src.slice(i));
    if (num) {
      toks.push({ kind: "num", value: num[0], pos: i });
      i += num[0].length;
      if (src[i] === "%") i++; // allow "20%" - the % is decorative
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

type Node =
  | { t: "cmp"; field: string; op: string; num: number }
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
    let left = this.parseAtom();
    while (this.peek()?.kind === "and") {
      this.next();
      left = { t: "and", l: left, r: this.parseAtom() };
    }
    return left;
  }

  parseAtom(): Node {
    const tok = this.peek();
    if (!tok) throw new QueryError("query ended unexpectedly", 0);
    if (tok.kind === "lparen") {
      this.next();
      const inner = this.parseExpr();
      const close = this.next();
      if (close?.kind !== "rparen") throw new QueryError("missing closing ')'", tok.pos);
      return inner;
    }
    if (tok.kind !== "ident") throw new QueryError(`expected a field name, got '${tok.value}'`, tok.pos);
    this.next();
    const raw = tok.value;
    const field = ALIASES[raw] ?? raw;
    if (!NUMERIC_FIELDS.includes(field)) {
      throw new QueryError(`unknown field '${raw}' - try: ${NUMERIC_FIELDS.slice(0, 8).join(", ")}...`, tok.pos);
    }
    this.fields.add(field);
    const op = this.next();
    if (op?.kind !== "op") throw new QueryError(`expected <, >, <=, >=, = or != after '${raw}'`, tok.pos);
    const num = this.next();
    if (num?.kind !== "num") throw new QueryError(`expected a number after '${raw} ${op.value}'`, op.pos);
    return { t: "cmp", field, op: op.value, num: parseFloat(num.value) };
  }
}

function evalNode(node: Node, row: Row): boolean | null {
  if (node.t === "cmp") {
    const v = row[node.field];
    if (v === null || v === undefined || typeof v !== "number" || Number.isNaN(v)) return null;
    switch (node.op) {
      case "<": return v < node.num;
      case ">": return v > node.num;
      case "<=": return v <= node.num;
      case ">=": return v >= node.num;
      case "=": return v === node.num;
      case "!=": return v !== node.num;
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

export function compile(src: string): { run: (row: Row) => boolean | null; fields: string[] } {
  const toks = tokenize(src);
  if (toks.length === 0) throw new QueryError("empty query", 0);
  const p = new Parser(toks);
  const ast = p.parseExpr();
  if (p.i < p.toks.length) {
    const extra = p.toks[p.i];
    throw new QueryError(`unexpected '${extra.value}' - did you forget 'and' / 'or'?`, extra.pos);
  }
  return { run: (row) => evalNode(ast, row), fields: [...p.fields] };
}
