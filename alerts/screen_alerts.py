"""Rscreener alerts - companies entering or leaving the owner's saved screens.

Reads alerts/screens.txt (one screen per line: NAME | QUERY, optionally
| SECTOR, SECTOR) and the company table the nightly run has just exported
(web/public/data.json). Each screen is run in the screener's own query
language; the symbols it matches are compared with last night's, kept in
alerts/screen_state.json (committed by the nightly with the scoreboard), and
any change is pushed to the owner's phone through ntfy.

The first night a screen appears there is nothing to compare with, so it is
recorded silently. A data alert, not a signal: it says which companies now
pass a filter the owner chose.
"""
import json
import re
import sys
from pathlib import Path
from urllib.parse import quote

from ntfy_lib import post

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "web" / "public" / "data.json"
STATE = Path(__file__).with_name("screen_state.json")
SITE = "https://rishilbhutada.github.io/rscreener"
# How many nights in a row a member may be kept on a missing figure before it
# counts as having left.
UNKNOWN_NIGHTS = 3

# The screener's field aliases (web/src/lib/query.ts), the ones a hand-written
# line is likely to use; any other name is read as the field itself.
ALIASES = {
    "marketcap": "mcap", "market_cap": "mcap", "dividend_yield": "div_yield", "dy": "div_yield",
    "debt_to_equity": "de", "opm": "op_margin", "npm": "net_margin", "promoter": "promoter_holding",
    "rsi": "rsi14", "dma50": "vs_dma50", "dma200": "vs_dma200", "fscore": "f_score",
    "piotroski": "f_score", "day_change": "ret_1d", "volume_surge": "vol_surge",
}


def push(title: str, message: str, click: str, priority: str = "default") -> bool:
    return post(title, message, tags="mag", click=click, priority=priority)


# ── the query language, as web/src/lib/query.ts parses it ──

TOKEN = re.compile(r"\s*(?:(\d+(?:\.\d+)?)(%?)|([A-Za-z_][A-Za-z0-9_]*)|(<=|>=|==|!=|<|>|=)|([-+*/])|(\()|(\)))")

# Each field's unit, read from the screener's own catalogue so the two cannot
# drift. A "%" after a number is allowed only against a percent / points field:
# "de < 50%" read as D/E below 50 and matched nearly every company.
_FIELDS_TS = Path(__file__).resolve().parents[1] / "web" / "src" / "lib" / "fields.ts"
try:
    UNIT_OF = dict(re.findall(r'key:\s*"(\w+)".*?unit:\s*"([^"]*)"', _FIELDS_TS.read_text(encoding="utf-8")))
except OSError:
    UNIT_OF = {}
PCT_UNITS = {"%", "%/yr", "pts"}
MONEY_FIELDS = {"revenue", "net_income", "total_debt", "total_cash", "free_cashflow"}


def tokenize(src: str) -> list[tuple[str, str]]:
    out, i = [], 0
    while i < len(src):
        if src[i].isspace():
            i += 1
            continue
        m = TOKEN.match(src, i)
        if not m or m.end() == i:
            raise ValueError(f"unexpected character {src[i]!r}")
        num, pct, word, op, ar, lp, rp = m.groups()
        if num:
            out.append(("pnum" if pct else "num", num))
        elif word:
            w = word.lower()
            out.append((w, w) if w in ("and", "or") else ("ident", ALIASES.get(w, w)))
        elif op:
            out.append(("op", "=" if op == "==" else op))
        elif ar:
            out.append(("arith", ar))
        elif lp:
            out.append(("(", "("))
        else:
            out.append((")", ")"))
        i = m.end()
    return out


class Parser:
    def __init__(self, toks):
        self.t, self.i = toks, 0

    def peek(self):
        return self.t[self.i] if self.i < len(self.t) else (None, None)

    def take(self):
        tok = self.peek()
        self.i += 1
        return tok

    def expr(self):
        node = self.conj()
        while self.peek()[0] == "or":
            self.take()
            node = ("or", node, self.conj())
        return node

    def conj(self):
        node = self.atom()
        while self.peek()[0] == "and":
            self.take()
            node = ("and", node, self.atom())
        return node

    def atom(self):
        mark = self.i
        try:
            return self.comparison()
        except ValueError:
            if mark >= len(self.t) or self.t[mark][0] != "(":
                raise
            self.i = mark + 1
            inner = self.expr()
            if self.take()[0] != ")":
                raise ValueError("missing ')'")
            return inner

    def comparison(self):
        left = self.sum()
        kind, op = self.take()
        if kind != "op":
            raise ValueError("expected a comparison")
        return ("cmp", op, left, self.sum())

    def sum(self):
        node = self.prod()
        while self.peek()[0] == "arith" and self.peek()[1] in "+-":
            node = (self.take()[1], node, self.prod())
        return node

    def prod(self):
        node = self.unary()
        while self.peek()[0] == "arith" and self.peek()[1] in "*/":
            node = (self.take()[1], node, self.unary())
        return node

    def unary(self):
        if self.peek() == ("arith", "-"):
            self.take()
            return ("neg", self.unary())
        kind, val = self.take()
        if kind == "num":
            return ("num", float(val))
        if kind == "pnum":
            return ("num", float(val), "%")
        if kind == "ident":
            return ("field", val)
        if kind == "(":
            inner = self.sum()
            if self.take()[0] != ")":
                raise ValueError("missing ')'")
            return inner
        raise ValueError(f"expected a field or number, got {val!r}")


def _check_percents(node) -> None:
    if node[0] in ("and", "or"):
        for sub in node[1:]:
            _check_percents(sub)
        return
    if node[0] != "cmp":
        return
    _, _, left, right = node
    for side, other in ((left, right), (right, left)):
        if side[0] == "num" and len(side) > 2 and other[0] == "field":
            unit = UNIT_OF.get(other[1])
            if unit is not None and unit not in PCT_UNITS:
                raise ValueError(f"'{other[1]}' is not a percentage - write {side[1] / 100:g} for {side[1]:g}%")


def compile_query(src: str):
    p = Parser(tokenize(src))
    tree = p.expr()
    if p.i != len(p.t):
        raise ValueError(f"unexpected {p.t[p.i][1]!r}")
    _check_percents(tree)
    return tree


def num(node, row):
    k = node[0]
    if k == "num":
        return node[1]
    if k == "field":
        v = row.get(node[1])
        if not (isinstance(v, (int, float)) and v == v):
            return None
        # Money figures read in crore, as the screener reads them (query.ts MONEY_FIELDS).
        return v / 1e7 if node[1] in MONEY_FIELDS else v
    if k == "neg":
        v = num(node[1], row)
        return None if v is None else -v
    a, b = num(node[1], row), num(node[2], row)
    if a is None or b is None:
        return None
    if k == "+":
        return a + b
    if k == "-":
        return a - b
    if k == "*":
        return a * b
    return None if b == 0 else a / b


def test(node, row):
    """True, False, or None where a figure it needs is missing - and a
    missing figure leaves the company out, as on the site."""
    if node[0] == "cmp":
        a, b = num(node[2], row), num(node[3], row)
        if a is None or b is None:
            return None
        return {"<": a < b, ">": a > b, "<=": a <= b, ">=": a >= b, "=": a == b, "!=": a != b}[node[1]]
    a, b = test(node[1], row), test(node[2], row)
    if node[0] == "and":
        return False if (a is False or b is False) else (None if (a is None or b is None) else True)
    return True if (a is True or b is True) else (None if (a is None or b is None) else False)


def load_screens() -> list[tuple[str, str, list[str]]]:
    out = []
    for line in Path(__file__).with_name("screens.txt").read_text(encoding="utf-8").splitlines():
        line = line.split("#")[0].strip()
        if not line:
            continue
        parts = [x.strip() for x in line.split("|")]
        if len(parts) < 2 or not parts[0] or not parts[1]:
            print(f"  skipped a line it could not read: {line}")
            continue
        sectors = [s.strip() for s in parts[2].split(",") if s.strip()] if len(parts) > 2 else []
        out.append((parts[0], parts[1], sectors))
    return out


def names(syms: list[str], cap: int = 12) -> str:
    return ", ".join(syms[:cap]) + (f" and {len(syms) - cap} more" if len(syms) > cap else "")


def main() -> None:
    screens = load_screens()
    print(f"screens to watch: {[s[0] for s in screens]}")
    if not screens:
        return
    data = json.loads(DATA.read_text(encoding="utf-8"))
    rows, asof = data["rows"], data.get("price_asof")
    state = json.loads(STATE.read_text(encoding="utf-8")) if STATE.exists() else {}
    sent = 0
    for name, query, sectors in screens:
        try:
            tree = compile_query(query)
        except ValueError as e:
            print(f"  {name}: cannot read the query ({e})")
            continue
        # "A" keeps only listed sectors; "!A" leaves one out and keeps the rest,
        # companies with no sector included (as web/src/lib/saved-screens.ts).
        inc = {x for x in sectors if not x.startswith("!")}
        exc = {x[1:] for x in sectors if x.startswith("!")}
        prev = state.get(name, {})
        before = prev.get("symbols")
        # Members are carried over a missing figure only while the screen is
        # the one they passed: same query, same sectors. (A state saved
        # before sectors were stored has none; it is taken as the same.)
        same = prev.get("query") == query and prev.get("sectors", sectors) == sectors
        had = set(before or []) if same else set()
        streak = prev.get("unknown_nights", {}) if same else {}
        now, unknown, nights = [], 0, {}
        for r in rows:
            sct = r.get("sector") or ""
            if (inc and sct not in inc) or sct in exc:
                continue
            res = test(tree, r)
            sym = r["symbol"]
            # A figure missing tonight is "unknown", not "fails": a member
            # whose figure went blank stays a member rather than "leaving"
            # tonight and "joining" again when the figure comes back - for
            # UNKNOWN_NIGHTS nights at most, then it counts as gone.
            if res is True:
                now.append(sym)
            elif res is None and sym in had and streak.get(sym, 0) < UNKNOWN_NIGHTS:
                now.append(sym)
                nights[sym] = streak.get(sym, 0) + 1
                unknown += 1
        now.sort()
        new_state = {"asof": asof, "query": query, "sectors": sectors, "symbols": now, "unknown_nights": nights}
        if before is None:
            state[name] = new_state
            print(f"  {name}: {len(now)} today - recorded, nothing to compare with yet")
            continue
        added = [s for s in now if s not in set(before)]
        removed = [s for s in before if s not in set(now)]
        print(f"  {name}: {len(now)} today, +{len(added)} -{len(removed)}"
              + (f", {unknown} kept on a missing figure" if unknown else ""))
        if added or removed:
            body = []
            if added:
                body.append(f"New: {names(added)}")
            if removed:
                body.append(f"Left: {names(removed)}")
            click = f"{SITE}/screens/?q={quote(query)}" + (f"&sec={quote(','.join(sectors))}" if sectors else "")
            if not push(f"{name}: +{len(added)} / -{len(removed)}", "\n".join(body) + f"\n{len(now)} pass it now.", click):
                continue    # not delivered: keep last night's list, so tomorrow tells these changes again
            sent += 1
        state[name] = new_state
        # Saved after every screen: a failure further down cannot make the
        # screens already told repeat themselves tomorrow.
        STATE.write_text(json.dumps(state, indent=1, sort_keys=True), encoding="utf-8")
    STATE.write_text(json.dumps(state, indent=1, sort_keys=True), encoding="utf-8")
    print(f"screen alerts sent: {sent}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001 - a silent failure looks exactly like "no change"
        push("Screen alert check FAILED", f"{type(e).__name__}: {e}"[:300], f"{SITE}/screens/", "high")
        sys.exit(1)
