/** Company search: one matcher, shared by the top bar and the home page.
 *
 *  The old scorer compared the whole query against the symbol and against the
 *  name as single strings, so a query with a space in it could only match if the
 *  company's name happened to start with exactly those words in exactly that
 *  order. Measured against the real 4,746-row data.json, every one of these
 *  returned NOTHING:
 *
 *      bank baroda        larsen toubro
 *      mahindra mahindra  oil natural gas
 *
 *  Those are four companies the owner holds or follows, typed the way anybody
 *  says them out loud, and the box went silent as though they were not in his
 *  own database.
 *
 *  Ranking was wrong too, because symbol-prefix outranked name-prefix as a
 *  separate tier: "vedanta" put VEDANTASSET - a Rs 21.6 crore namesake - above
 *  Vedanta Ltd, and "tata" did not return TCS at all inside eight results.
 *
 *  Tiers here, best first. Within a tier the larger company wins, because when
 *  two companies match equally the one someone means is almost always the
 *  bigger one:
 *
 *      0  exact       the query IS the symbol, or the name with punctuation removed
 *      1  prefix      symbol, name, or squashed name starts with it
 *                     (one tier, so "vedanta" ranks VEDL and VEDANTASSET together
 *                      and market cap decides - which is the fix)
 *      2  word gap    every query word prefixes a later word of the name, in order
 *                     ("bank baroda" -> "Bank of Baroda"). Multi-word queries only.
 *      3  contains    a bare substring, three characters or more
 */

export type SearchRow = {
  symbol: string;
  name: string;
  mcap: number;
  exchange?: string;
};

type Indexed = SearchRow & {
  sym: string;   // lowercased symbol
  ssq: string;   // symbol, alphanumerics only - typing "mm" must reach "M&M"
  nl: string;    // lowercased name
  nsq: string;   // name, alphanumerics only - "M&M" and "MM" both reach it
  toks: string[];
};

export type SearchIndex = Indexed[];

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function buildIndex(rows: SearchRow[]): SearchIndex {
  return rows.map((r) => {
    const nl = (r.name || "").toLowerCase();
    return {
      ...r,
      sym: r.symbol.toLowerCase(),
      ssq: squash(r.symbol),
      nl,
      nsq: squash(nl),
      toks: nl.split(/[^a-z0-9]+/).filter(Boolean),
    };
  });
}

/** Every query word prefixes a later word of the name, in order.
 *  "oil natural gas" matches "Oil & Natural Gas Corporation" - the words are
 *  separated by an ampersand the query does not contain, which is precisely
 *  what defeated a whole-string comparison. */
function wordGap(toks: string[], qt: string[]): boolean {
  let j = 0;
  for (const q of qt) {
    while (j < toks.length && !toks[j].startsWith(q)) j++;
    if (j === toks.length) return false;
    j++;
  }
  return true;
}

function tier(r: Indexed, ql: string, qsq: string, qt: string[]): number {
  // Compared against the SQUASHED symbol as well as the raw one. Testing found
  // that "m&m" returned MMTC, MMFL and MMP but not Mahindra & Mahindra: the
  // query squashes to "mm" while the symbol stayed "m&m", so the company whose
  // ticker the query literally is never matched at all.
  if (qsq === r.ssq || qsq === r.nsq) return 0;
  if (r.ssq.startsWith(qsq) || r.nl.startsWith(ql) || r.nsq.startsWith(qsq)) return 1;
  if (qt.length > 1 && wordGap(r.toks, qt)) return 2;
  if (qsq.length >= 3 && (r.sym.includes(qsq) || r.nsq.includes(qsq))) return 3;
  return 9;
}

export function search(index: SearchIndex, query: string, limit = 15):
  { hits: SearchRow[]; total: number } {
  const ql = query.trim().toLowerCase();
  if (ql.length < 2) return { hits: [], total: 0 };
  const qsq = squash(ql);
  const qt = ql.split(/[^a-z0-9]+/).filter(Boolean);

  const scored: [number, number, string, Indexed][] = [];
  for (const r of index) {
    const t = tier(r, ql, qsq, qt);
    if (t < 9) scored.push([t, -(r.mcap || 0), r.symbol, r]);
  }
  scored.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2].localeCompare(b[2]));
  return { hits: scored.slice(0, limit).map((s) => s[3]), total: scored.length };
}

/** A single suggestion when nothing matched, so a typo names itself instead of
 *  leaving a blank panel that reads as a broken app. Deliberately tight: one
 *  edit under eight characters, two at eight or more, and the first letter must
 *  agree - loose fuzzy matching over 4,746 names offers nonsense confidently. */
export function didYouMean(index: SearchIndex, query: string): SearchRow | null {
  const q = squash(query);
  if (q.length < 4) return null;
  const budget = q.length >= 8 ? 2 : 1;
  let best: { r: Indexed; d: number } | null = null;
  for (const r of index) {
    for (const cand of [r.ssq, ...r.toks.filter((t) => t.length >= 4)]) {
      if (cand[0] !== q[0]) continue;
      if (Math.abs(cand.length - q.length) > budget) continue;
      const d = editDistance(cand, q, budget);
      if (d <= budget && (!best || d < best.d || (d === best.d && r.mcap > best.r.mcap))) {
        best = { r, d };
      }
    }
  }
  return best ? best.r : null;
}

/** Levenshtein, abandoned as soon as it exceeds the budget. */
function editDistance(a: string, b: string, budget: number): number {
  if (Math.abs(a.length - b.length) > budget) return budget + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j - 1], prev[j], cur[j - 1]);
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > budget) return budget + 1;
    prev = cur;
  }
  return prev[b.length];
}
