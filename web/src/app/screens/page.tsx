"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { saveFile } from "@/lib/download";
import TopNav from "@/components/TopNav";
import InfoTip, { InfoDialog } from "@/components/InfoTip";
import { Row, canonicalField, compile, isValidRatioName } from "@/lib/query";
import { FIELD_CATALOG, FieldDef, Universe, catalogFor } from "@/lib/fields";
import { LIBRARY, LibraryScreen, libraryById } from "@/lib/screen-library";
import { SavedScreen, diff, loadSaved, matchesOf, storeSaved } from "@/lib/saved-screens";
import { WatchState, loadLists, toggleIn } from "@/lib/watchlists";
import { shortName } from "@/lib/names";
import {
  Chips, Icon, IconButton, SheetAction, Stat, dayMove, money, shortDay, shownSymbol, signed, tone,
} from "@/components/QuoteUI";

/** The screener, built for a phone: filters as chips, a searchable field
 *  picker, results as one line per company, and everything else in sheets.
 *  Three tabs - your own screen, ready-made ones, and saved ones with what
 *  changed in each since you last opened it. It filters; it recommends
 *  nothing. */

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const DEFAULT_QUERY = "roce > 20 and pe < 25";

type Data = { generated_at: string; price_asof?: string | null; rows: Row[] };
type Cond = { field: string; op: string; value: string };
type Ratio = { name: string; formula: string };
type Tab = "screen" | "ready" | "saved";
type Sheet =
  | { kind: "pick" }
  | { kind: "cond"; index: number | null; field: string }
  | { kind: "sectors" }
  | { kind: "sort" }
  | { kind: "formula" }
  | { kind: "more" }
  | { kind: "save" }
  | { kind: "ratios" }
  | { kind: "row"; sym: string }
  | { kind: "saved"; name: string }
  | null;

type ByKey = Map<string, FieldDef>;
const COMPANY_BY: ByKey = new Map<string, FieldDef>(FIELD_CATALOG.map((f) => [f.key, f]));
const UNIVERSES: [Universe, string][] = [["companies", "Companies"], ["indices", "Indices"], ["commodities", "Commodities"]];
const OPS: [string, string, string][] = [
  [">", "Above", ">"], [">=", "At least", "≥"], ["<", "Below", "<"], ["<=", "At most", "≤"], ["=", "Equals", "="],
];
const OP_SYM: Record<string, string> = { ">": ">", ">=": "≥", "<": "<", "<=": "≤", "=": "=", "!=": "≠" };
const MONEY = new Set(["revenue", "net_income", "total_debt", "total_cash", "free_cashflow"]);
const UNIT_SUFFIX: Record<string, string> = { "%": "%", "%/yr": "%", "₹Cr": " Cr", pts: " pts", "×": "×" };

function labelOf(key: string, by: ByKey = COMPANY_BY): string {
  const f = by.get(key);
  return f?.short ?? f?.label ?? key;
}

function fmtVal(key: string, v: unknown, by: ByKey = COMPANY_BY): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  const crore = (cr: number) => (Math.abs(cr) >= 1e5 ? `₹${(cr / 1e5).toFixed(2)}L Cr` : `₹${Math.round(cr).toLocaleString("en-IN")} Cr`);
  if (key === "mcap") return crore(v);
  if (MONEY.has(key)) return crore(v / 1e7);
  const u = by.get(key)?.unit ?? "";
  if (u === "₹" || ["wk52_high", "wk52_low", "book_value"].includes(key)) return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  if (key === "f_score") return `${Math.round(v)}/9`;
  if (u === "%" || u === "%/yr") return `${v.toLocaleString("en-IN", { maximumFractionDigits: 1 })}%`;
  if (u === "pts") return `${signed(v, 2)} pts`;
  if (u === "×") return `${v.toFixed(2)}×`;
  return v.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

/** Simple queries - "field op number" joined by one kind of and/or - become
 *  chips. Anything else (arithmetic, brackets, custom ratios) stays a formula. */
function parseConds(q: string, by: ByKey = COMPANY_BY): { conds: Cond[]; joiner: "and" | "or" } | null {
  const t = q.trim();
  if (!t) return { conds: [], joiner: "and" };
  const parts = t.split(/\s+(and|or)\s+/i);
  const joins = parts.filter((_, i) => i % 2 === 1).map((x) => x.toLowerCase());
  if (joins.length && !joins.every((j) => j === joins[0])) return null;
  const conds: Cond[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const m = /^([a-z_][a-z0-9_]*)\s*(<=|>=|!=|<|>|=)\s*(-?\d+(?:\.\d+)?)$/i.exec(parts[i].trim());
    if (!m) return null;
    const field = canonicalField(m[1]);
    if (!by.has(field)) return null;
    conds.push({ field, op: m[2], value: m[3] });
  }
  return { conds, joiner: (joins[0] as "and" | "or") ?? "and" };
}

function toQuery(conds: Cond[], joiner: "and" | "or"): string {
  return conds.map((c) => `${c.field} ${c.op} ${c.value}`).join(` ${joiner} `);
}

function readJSON<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback; } catch { return fallback; }
}

function ScreensInner() {
  const router = useRouter();
  const params = useSearchParams();
  // What is being screened: companies, indices, or MCX and NCDEX contracts.
  const uniRaw = params.get("u");
  const uni: Universe = uniRaw === "indices" || uniRaw === "commodities" ? uniRaw : "companies";
  const catalog = useMemo(() => catalogFor(uni), [uni]);
  const by = useMemo<ByKey>(() => new Map(catalog.map((f) => [f.key, f])), [catalog]);
  const groupsOf = useMemo(() => Array.from(new Set(catalog.map((f) => f.group))), [catalog]);
  const query = params.has("q") ? params.get("q") ?? "" : uni === "companies" ? DEFAULT_QUERY : "";
  const sectors = useMemo(() => (params.get("sec") ?? "").split(",").filter(Boolean), [params]);
  const libId = params.get("lib");
  const lib = useMemo(() => libraryById(libId), [libId]);

  const [data, setData] = useState<Data | null>(null);
  const [idxRows, setIdxRows] = useState<Row[] | null>(null);
  const [comRows, setComRows] = useState<Row[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState<Tab>("screen");
  const [sheet, setSheet] = useState<Sheet>(null);
  const [sort, setSort] = useState<{ key: string; desc: boolean } | null>(null);
  const [rowLimit, setRowLimit] = useState(25);
  const [saved, setSaved] = useState<SavedScreen[]>([]);
  const [ratios, setRatios] = useState<Ratio[]>([]);
  const [lists, setLists] = useState<WatchState>({ lists: [], activeId: "" });
  // sheet inputs
  const [pickText, setPickText] = useState("");
  const [opText, setOpText] = useState(">");
  const [valText, setValText] = useState("");
  const [formulaText, setFormulaText] = useState("");
  const [nameText, setNameText] = useState("");
  const [ratioName, setRatioName] = useState("");
  const [ratioFormula, setRatioFormula] = useState("");
  const [ratioError, setRatioError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch(`${BASE}/data.json`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(setData)
      .catch((e) => setLoadError(`Could not load the company data (${e.message}).`));
    // Indices and commodities are small files, read once and shaped into the
    // same rows the query engine reads; the group filter is NSE's index group
    // for an index and the exchange for a contract.
    fetch(`${BASE}/indices.json`).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!d?.items) return;
      setIdxRows(d.items.map((x: Record<string, unknown>) => ({
        symbol: x.s, name: x.name, sector: x.group, price: x.close, ret_1d: x.chg_pct, ret_1m: x.r1m, ret_1y: x.r1y,
        pe: x.pe, pb: x.pb, div_yield: x.dy, pe_pct: x.pe_pct, from_ath: x.from_ath, members: x.n || null,
      }) as unknown as Row));
    }).catch(() => {});
    fetch(`${BASE}/commodities.json`).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!d?.items) return;
      setComRows(d.items.map((x: Record<string, unknown>) => ({
        symbol: x.s, name: x.name, sector: x.exchange ?? "MCX", price: x.close, ret_1d: x.chg, next_prem: x.next_prem,
        carry_pa: x.carry_pa, world_prem: x.world_prem, spot_prem: x.spot_prem ?? null, oi: x.oi || null, vol: x.vol || null,
      }) as unknown as Row));
    }).catch(() => {});
    setSaved(loadSaved());
    setRatios(readJSON<Ratio[]>("rscreener_ratios", []));
    setLists(loadLists());
  }, []);

  const ratiosMap = useMemo(() => Object.fromEntries(ratios.map((r) => [r.name, r.formula])), [ratios]);
  const parsed = useMemo(() => parseConds(query, by), [query, by]);
  // The rows of whatever is being screened.
  const rows = uni === "indices" ? idxRows : uni === "commodities" ? comRows : data?.rows ?? null;
  const hrefOf = (sym: string) => uni === "indices" ? `/indices/view?s=${encodeURIComponent(sym)}`
    : uni === "commodities" ? `/commodity?s=${encodeURIComponent(sym)}` : `/company?s=${encodeURIComponent(sym)}`;
  const chartOf = (sym: string) => `/chart?s=${encodeURIComponent(uni === "commodities" ? `${sym}1!` : sym)}`;

  /** The screen is the address: Back, reload and a shared link all land on
   *  the same result. Editing a filter replaces the entry; opening another
   *  screen adds one. */
  const go = (next: { q?: string; sec?: string[]; lib?: string | null; u?: Universe }, push = false) => {
    const u = next.u ?? uni;
    const q = next.q ?? query;
    const sec = next.sec ?? sectors;
    const l = next.lib === undefined ? lib?.id : next.lib;
    const sp = new URLSearchParams();
    if (u !== "companies") sp.set("u", u);
    sp.set("q", q);
    if (sec.length) sp.set("sec", sec.join(","));
    if (l) sp.set("lib", l);
    const url = `/screens?${sp.toString()}`;
    if (push) router.push(url, { scroll: false }); else router.replace(url, { scroll: false });
    setRowLimit(25);
  };
  const setConds = (conds: Cond[], joiner: "and" | "or" = parsed?.joiner ?? "and") => go({ q: toQuery(conds, joiner) });

  const allSectors = useMemo(
    () => Array.from(new Set((rows ?? []).map((r) => String(r.sector ?? "")).filter(Boolean))).sort(),
    [rows]);

  const result = useMemo(() => {
    if (!rows) return null;
    try {
      const { run, fields } = query.trim()
        ? compile(query, uni === "companies" ? ratiosMap : {}, uni === "companies" ? undefined : catalog.map((f) => f.key))
        : { run: () => true as boolean | null, fields: [] as string[] };
      const sec = sectors.length ? new Set(sectors) : null;
      const matches: Row[] = [];
      let skipped = 0;
      for (const r of rows) {
        if (sec && !sec.has(String(r.sector ?? ""))) continue;
        const res = run(r);
        if (res === true) matches.push(r);
        else if (res === null) skipped++;
      }
      return { matches, skipped, fields, error: "" };
    } catch (e) {
      return { matches: [] as Row[], skipped: 0, fields: [] as string[], error: e instanceof Error ? e.message : String(e) };
    }
  }, [rows, uni, catalog, query, sectors, ratiosMap]);

  const sortKey = sort?.key ?? (lib?.rank ? "__rank" : lib?.sort?.[0] ?? (uni === "companies" ? "mcap" : uni === "indices" ? "members" : "oi"));
  const sortDesc = sort ? sort.desc : lib?.rank ? false : lib?.sort ? lib.sort[1] === -1 : true;

  const sorted = useMemo(() => {
    if (!result) return [];
    const rows = [...result.matches];
    if (sortKey === "__rank" && lib?.rank) {
      // Each field ranked on its own, the ranks added: lowest total first.
      const total = new Map<string, number>();
      for (const [f, dir] of lib.rank) {
        const by = [...rows].sort((a, b) => {
          const av = a[f] as number | null, bv = b[f] as number | null;
          if (typeof av !== "number") return 1;
          if (typeof bv !== "number") return -1;
          return dir === -1 ? bv - av : av - bv;
        });
        by.forEach((r, i) => total.set(String(r.symbol), (total.get(String(r.symbol)) ?? 0) + i));
      }
      return rows.sort((a, b) => (total.get(String(a.symbol)) ?? 0) - (total.get(String(b.symbol)) ?? 0));
    }
    return rows.sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === "string" || typeof bv === "string") return String(av).localeCompare(String(bv)) * (sortDesc ? -1 : 1);
      return ((av as number) - (bv as number)) * (sortDesc ? -1 : 1);
    });
  }, [result, sortKey, sortDesc, lib]);

  // The figures each result row shows: the ones being filtered on.
  const rowFields = useMemo(() => {
    const own = (result?.fields ?? []).filter((f) => !["price", "ret_1d"].includes(f));
    const pick = own.length ? own
      : uni === "indices" ? ["pe", "ret_1y", "from_ath"] : uni === "commodities" ? ["next_prem", "world_prem", "spot_prem"] : ["pe", "roce", "mcap"];
    return pick.slice(0, 3);
  }, [result, uni]);

  // Each figure's median across companies - the value a new filter starts at,
  // so "ROCE above" opens on a sensible number rather than a blank.
  const medianOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of catalog) {
      const v = (rows ?? []).map((r) => r[f.key]).filter((x): x is number => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
      if (v.length) m.set(f.key, v[Math.floor(v.length / 2)]);
    }
    return m;
  }, [rows, catalog]);
  const medians = (key: string): number | null => medianOf.get(key) ?? null;

  // ── saved screens and what changed in them ──
  const savedState = useMemo(() => {
    if (!data) return [];
    return saved.map((s) => {
      const now = matchesOf(s, data.rows, ratiosMap);
      return { s, now, ...diff(now ?? [], s.seen) };
    });
  }, [saved, data, ratiosMap]);
  const newCount = savedState.reduce((n, x) => n + x.added.length, 0);

  const openSaved = (s: SavedScreen) => {
    const now = data ? matchesOf(s, data.rows, ratiosMap) : null;
    if (now) setSaved(storeSaved(saved.map((x) => (x.name === s.name ? { ...x, seen: now, seenAsof: data?.price_asof ?? undefined } : x))));
    setSort(null);
    setTab("screen");
    setSheet(null);
    go({ q: s.query, sec: s.sectors ?? [], lib: s.lib ?? null, u: "companies" }, true);
  };

  const openLibrary = (l: LibraryScreen) => {
    setSort(null);
    setTab("screen");
    const sec = l.excludeSectors ? allSectors.filter((x) => !l.excludeSectors!.includes(x)) : [];
    go({ q: l.query, sec, lib: l.id, u: "companies" }, true);
  };

  const saveScreen = () => {
    const name = nameText.trim();
    if (!name || !result) return;
    const entry: SavedScreen = {
      name, query, sectors: sectors.length ? sectors : undefined, lib: lib?.id,
      seen: result.matches.map((r) => String(r.symbol)), seenAsof: data?.price_asof ?? undefined,
    };
    setSaved(storeSaved([...saved.filter((x) => x.name !== name), entry]));
    setSheet(null);
  };

  const addRatio = () => {
    const name = ratioName.trim().toLowerCase();
    const formula = ratioFormula.trim();
    const nameErr = isValidRatioName(name);
    if (nameErr) { setRatioError(nameErr); return; }
    if (!formula) { setRatioError("The formula is empty"); return; }
    try { compile(`${name} > 0`, { ...ratiosMap, [name]: formula }); } catch (e) {
      setRatioError(e instanceof Error ? e.message : String(e)); return;
    }
    const next = [...ratios.filter((r) => r.name !== name), { name, formula }];
    setRatios(next);
    try { localStorage.setItem("rscreener_ratios", JSON.stringify(next)); } catch { /* private mode */ }
    setRatioName(""); setRatioFormula(""); setRatioError("");
  };
  const deleteRatio = (name: string) => {
    const next = ratios.filter((r) => r.name !== name);
    setRatios(next);
    try { localStorage.setItem("rscreener_ratios", JSON.stringify(next)); } catch { /* private mode */ }
  };

  const exportCsv = () => {
    if (!result) return;
    const cols = ["symbol", "name", "sector", "price", "ret_1d", ...(uni === "companies" ? ["mcap"] : []), ...result.fields.filter((f) => !["price", "ret_1d", "mcap"].includes(f))];
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [cols.map((c) => (c === "symbol" ? "Symbol" : c === "name" ? "Name" : c === "sector" ? "Sector" : by.get(c)?.label ?? c)).join(",")];
    for (const r of sorted) lines.push(cols.map((c) => esc(r[c])).join(","));
    void saveFile("rscreener_screen.csv", String.fromCharCode(0xfeff) + lines.join("\r\n"));
  };

  const openCond = (index: number | null, field: string) => {
    const c = index !== null ? parsed?.conds[index] : undefined;
    const med = medians(field);
    setOpText(c?.op ?? ">");
    setValText(c?.value ?? (med === null ? "" : String(Math.round(med * 10) / 10)));
    setSheet({ kind: "cond", index, field });
  };

  const applyCond = () => {
    if (sheet?.kind !== "cond" || !parsed) return;
    const v = parseFloat(valText);
    if (!Number.isFinite(v)) return;
    const c: Cond = { field: sheet.field, op: opText, value: String(v) };
    const conds = [...parsed.conds];
    if (sheet.index === null) conds.push(c); else conds[sheet.index] = c;
    setConds(conds);
    setSheet(null);
  };

  const pickList = useMemo(() => {
    const q = pickText.trim().toLowerCase();
    return catalog.filter((f) => !q || f.label.toLowerCase().includes(q) || f.key.includes(q) || (f.short ?? "").toLowerCase().includes(q));
  }, [pickText, catalog]);

  const sheetRow = sheet?.kind === "row" ? rows?.find((r) => r.symbol === sheet.sym) : undefined;
  const sheetSaved = sheet?.kind === "saved" ? savedState.find((x) => x.s.name === sheet.name) : undefined;

  const chip = "rs-press inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-full text-[13px] border";

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <TopNav active="screens" />
      <main className="max-w-3xl mx-auto px-4 pt-4 pb-24">
        <div className="flex items-center gap-2 mb-3">
          <h1 className="text-[22px] font-bold tracking-tight">Screener</h1>
          <InfoTip title="Screener">
            <p>Filters every listed company on the figures you choose. It screens; it never says what to buy or sell.</p>
            <p>Most figures come from Yahoo Finance and the companies&apos; filings, worked out nightly. Every number is unverified until checked against a filing.</p>
            <p>A company missing a figure you filter on is left out, never treated as zero.</p>
          </InfoTip>
          {data?.price_asof && <span className="ml-auto text-[11px] text-[var(--ink3)] tabular-nums">Close {shortDay(data.price_asof)}</span>}
        </div>

        <div className="flex items-center border-b border-[var(--line)] mb-3" role="tablist">
          {([["screen", "Screen"], ["ready", "Ready-made"], ["saved", "Saved"]] as [Tab, string][]).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={`px-3 pt-1 pb-2 -mb-px border-b-2 text-[14px] ${
                tab === k ? "border-[var(--accent)] text-[var(--accent-ink)] font-semibold" : "border-transparent text-[var(--ink2)]"}`}>
              {label}
              {k === "saved" && newCount > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--accent-fill)] text-[var(--accent-fill-ink)] text-[10px] font-bold tabular-nums">{newCount}</span>
              )}
            </button>
          ))}
        </div>

        {loadError && <p className="text-[13px] text-[var(--neg)] mb-3">{loadError}</p>}

        {/* ── your screen ── */}
        {tab === "screen" && (
          <>
            <div role="radiogroup" aria-label="What to screen" className="flex gap-1 mb-3">
              {UNIVERSES.map(([k, label]) => (
                <button key={k} type="button" role="radio" aria-checked={uni === k}
                  onClick={() => { if (k !== uni) { setSort(null); go({ u: k, q: k === "companies" ? DEFAULT_QUERY : "", sec: [], lib: null }, true); } }}
                  className={`min-h-[32px] px-3 rounded-full text-[13px] border ${uni === k
                    ? "bg-[var(--card2)] text-[var(--ink)] border-[var(--line2)] font-semibold" : "text-[var(--ink3)] border-transparent"}`}>
                  {label}
                </button>
              ))}
            </div>
            {lib && (
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[13px] font-semibold text-[var(--accent-ink)]">{lib.name}</span>
                <InfoTip title={lib.name}><p>{lib.about}</p></InfoTip>
                <button type="button" onClick={() => go({ lib: null })} aria-label="Stop using this ready-made screen's ranking"
                  className="ml-auto p-1 -m-1 text-[var(--ink3)]"><Icon name="close" size={14} /></button>
              </div>
            )}
            <div className="flex flex-wrap gap-2 mb-3">
              {parsed ? (
                <>
                  {parsed.conds.map((c, i) => (
                    <span key={`${c.field}-${i}`} className={`${chip} pr-1 bg-[var(--accent-soft)] border-[var(--accent-line)] text-[var(--accent-ink)] font-semibold`}>
                      <button type="button" onClick={() => openCond(i, c.field)} className="tabular-nums">
                        {labelOf(c.field, by)} {OP_SYM[c.op] ?? c.op} {c.value}{UNIT_SUFFIX[by.get(c.field)?.unit ?? ""] ?? ""}
                      </button>
                      <button type="button" onClick={() => setConds(parsed.conds.filter((_, j) => j !== i))}
                        aria-label={`Remove ${labelOf(c.field, by)}`} className="w-6 h-6 inline-flex items-center justify-center opacity-70">
                        <Icon name="close" size={13} />
                      </button>
                    </span>
                  ))}
                  {parsed.conds.length > 1 && (
                    <button type="button" onClick={() => setConds(parsed.conds, parsed.joiner === "and" ? "or" : "and")}
                      className={`${chip} border-[var(--line)] text-[var(--ink2)]`} title="Switch between all filters and any filter">
                      {parsed.joiner === "and" ? "Match all" : "Match any"}
                    </button>
                  )}
                </>
              ) : (
                <button type="button" onClick={() => { setFormulaText(query); setSheet({ kind: "formula" }); }}
                  className={`${chip} bg-[var(--accent-soft)] border-[var(--accent-line)] text-[var(--accent-ink)] font-mono text-[12px] max-w-full`}>
                  <span className="truncate">{query}</span>
                </button>
              )}
              <button type="button" onClick={() => { setPickText(""); setSheet({ kind: "pick" }); }}
                className={`${chip} border-dashed border-[var(--line2)] text-[var(--ink2)]`}>
                <Icon name="plus" size={14} /> Filter
              </button>
              <button type="button" onClick={() => setSheet({ kind: "sectors" })}
                className={`${chip} ${sectors.length ? "bg-[var(--accent-soft)] border-[var(--accent-line)] text-[var(--accent-ink)] font-semibold" : "border-[var(--line)] text-[var(--ink2)]"}`}>
                {sectors.length === 0 ? (uni === "indices" ? "All groups" : uni === "commodities" ? "MCX and NCDEX" : "All sectors")
                  : sectors.length === 1 ? sectors[0] : `${sectors.length} ${uni === "indices" ? "groups" : uni === "commodities" ? "exchanges" : "sectors"}`}
              </button>
            </div>

            {result?.error && <p className="text-[13px] text-[var(--neg)] mb-2">{result.error}</p>}

            {result && !result.error && (
              <>
                <div className="flex items-center gap-1 border-b border-[var(--line)] pb-1">
                  <p className="text-[13px] text-[var(--ink2)] flex items-center">
                    <strong className="text-[var(--ink)] tabular-nums mr-1">{result.matches.length.toLocaleString("en-IN")}</strong>
                    {uni === "indices" ? (result.matches.length === 1 ? "index" : "indices")
                      : uni === "commodities" ? (result.matches.length === 1 ? "contract type" : "contract types")
                      : result.matches.length === 1 ? "company" : "companies"}
                    {result.skipped > 0 && (
                      <InfoTip title="Left out" className="ml-1.5">
                        <p>{result.skipped.toLocaleString("en-IN")} companies are missing one of the figures filtered on, so they are left out rather than counted as zero.</p>
                      </InfoTip>
                    )}
                  </p>
                  <div className="ml-auto flex items-center">
                    <IconButton name="sliders" label="Sort" onClick={() => setSheet({ kind: "sort" })} />
                    <IconButton name="more" label="Save, share and more" onClick={() => setSheet({ kind: "more" })} />
                  </div>
                </div>
                <ul className="divide-y divide-[var(--line)]">
                  {sorted.slice(0, rowLimit).map((r) => {
                    const sym = String(r.symbol);
                    const chg = typeof r.ret_1d === "number" ? r.ret_1d : null;
                    const price = typeof r.price === "number" ? r.price : null;
                    return (
                      <li key={sym}>
                        <button type="button" onClick={() => setSheet({ kind: "row", sym })}
                          className="w-full py-2.5 text-left active:bg-[var(--card2)]">
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="min-w-0 truncate text-[15px] font-medium text-[var(--ink)]">{uni === "indices" ? String(r.name) : shownSymbol(sym)}</span>
                            <span className={`shrink-0 text-[15px] font-medium tabular-nums ${tone(chg)}`}>{money(price)}</span>
                          </div>
                          <div className="flex items-baseline justify-between gap-3 text-[11px] text-[var(--ink3)]">
                            <span className="min-w-0 truncate">{uni === "companies" ? shortName(String(r.name ?? ""), sym) : String(r.sector ?? "")}</span>
                            <span className="shrink-0 tabular-nums">{chg === null ? "—" : <>{signed(dayMove(price, chg))} <span className={tone(chg)}>({signed(chg)}%)</span></>}</span>
                          </div>
                          <p className="mt-0.5 text-[12px] text-[var(--ink2)] tabular-nums truncate">
                            {rowFields.filter((f) => uni === "companies" || r[f] != null).map((f, i) => (
                              <span key={f}>{i > 0 && <span className="text-[var(--ink3)]"> · </span>}<span className="text-[var(--ink3)]">{labelOf(f, by)}</span> {fmtVal(f, r[f], by)}</span>
                            ))}
                          </p>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {sorted.length > rowLimit && (
                  <button type="button" onClick={() => setRowLimit(rowLimit + 50)}
                    className="rs-press w-full mt-3 min-h-[44px] rounded-xl border border-[var(--line)] text-[14px] font-semibold text-[var(--ink2)]">
                    Show more · {(sorted.length - rowLimit).toLocaleString("en-IN")} left
                  </button>
                )}
                {sorted.length === 0 && <p className="py-12 text-center text-[13px] text-[var(--ink3)]">Nothing passes every filter</p>}
              </>
            )}
            {!rows && !loadError && <p className="py-12 text-center text-[13px] text-[var(--ink3)]">Loading…</p>}
          </>
        )}

        {/* ── ready-made ── */}
        {tab === "ready" && (
          <ul className="divide-y divide-[var(--line)]">
            {LIBRARY.map((l) => (
              <li key={l.id} className="flex items-center gap-2">
                <button type="button" onClick={() => openLibrary(l)} className="flex-1 min-w-0 py-3 text-left active:bg-[var(--card2)]">
                  <p className="text-[15px] font-medium text-[var(--ink)]">{l.name}</p>
                  <p className="text-[12px] text-[var(--ink3)] truncate">{l.blurb}</p>
                </button>
                <InfoTip title={l.name}><p>{l.about}</p><p className="font-mono text-[12px]">{l.query}</p></InfoTip>
              </li>
            ))}
          </ul>
        )}

        {/* ── saved ── */}
        {tab === "saved" && (
          savedState.length === 0 ? (
            <div className="py-14 text-center">
              <p className="text-[15px] text-[var(--ink2)] mb-1">No saved screens</p>
              <p className="text-[13px] text-[var(--ink3)]">Build one, then Save from <Icon name="more" size={14} className="inline" /> above the results. Each night&apos;s new entries and exits show here.</p>
            </div>
          ) : (
            <ul className="divide-y divide-[var(--line)]">
              {savedState.map(({ s, now, added, removed }) => (
                <li key={s.name} className="flex items-center gap-2">
                  <button type="button" onClick={() => openSaved(s)} className="flex-1 min-w-0 py-3 text-left active:bg-[var(--card2)]">
                    <p className="flex items-center gap-2 text-[15px] font-medium text-[var(--ink)]">
                      <span className="truncate">{s.name}</span>
                      <span className="text-[12px] font-normal text-[var(--ink3)] tabular-nums">{now === null ? "Broken" : now.length}</span>
                    </p>
                    <p className="text-[12px] tabular-nums truncate">
                      {added.length > 0 && <span className="text-[var(--pos)] font-semibold">+{added.length} new </span>}
                      {removed.length > 0 && <span className="text-[var(--neg)] font-semibold">−{removed.length} left </span>}
                      {added.length + removed.length === 0 && <span className="text-[var(--ink3)]">No change</span>}
                      {s.seenAsof && <span className="text-[var(--ink3)]"> since {shortDay(s.seenAsof)}</span>}
                    </p>
                  </button>
                  <IconButton name="more" label={`${s.name} details`} onClick={() => { setConfirmDelete(false); setSheet({ kind: "saved", name: s.name }); }} />
                </li>
              ))}
            </ul>
          )
        )}
      </main>

      {/* ── field picker ── */}
      {sheet?.kind === "pick" && (
        <InfoDialog title="Add a filter" onClose={() => setSheet(null)}>
          <label className="flex items-center gap-2 h-10 px-3 rounded-lg border border-[var(--line)] bg-[var(--card2)]">
            <Icon name="search" size={16} className="text-[var(--ink3)]" />
            <input autoFocus value={pickText} onChange={(e) => setPickText(e.target.value)} placeholder="Search figures"
              className="flex-1 min-w-0 bg-transparent outline-none text-[14px] text-[var(--ink)]" />
          </label>
          <div className="max-h-[52vh] overflow-y-auto -mx-1 px-1">
            {groupsOf.map((g) => {
              const fs = pickList.filter((f) => f.group === g);
              if (!fs.length) return null;
              return (
                <div key={g} className="pt-2">
                  <p className="text-[11px] uppercase tracking-wide text-[var(--ink3)] mb-1">{g}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {fs.map((f) => (
                      <button key={f.key} type="button" onClick={() => openCond(null, f.key)}
                        className="rs-press min-h-[34px] px-3 rounded-full border border-[var(--line)] text-[13px] text-[var(--ink)]">
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
            <button type="button" onClick={() => { setFormulaText(query); setSheet({ kind: "formula" }); }}
              className="mt-3 text-[13px] font-semibold text-[var(--accent-ink)]">Write a formula instead</button>
          </div>
        </InfoDialog>
      )}

      {/* ── one filter ── */}
      {sheet?.kind === "cond" && (() => {
        const f = by.get(sheet.field);
        const med = medians(sheet.field);
        return (
          <InfoDialog title={f?.label ?? sheet.field} onClose={() => setSheet(null)}>
            <p className="flex items-center gap-1">{f?.desc && <><span className="truncate">{f.desc.split(/[.—]/)[0]}</span><InfoTip title={f.label}><p>{f.desc}</p></InfoTip></>}</p>
            <div className="grid grid-cols-5 gap-1">
              {OPS.map(([op, label]) => (
                <button key={op} type="button" onClick={() => setOpText(op)}
                  className={`rs-press min-h-[40px] rounded-lg text-[12px] border ${
                    opText === op ? "bg-[var(--accent-soft)] border-[var(--accent-line)] text-[var(--accent-ink)] font-semibold" : "border-[var(--line)] text-[var(--ink2)]"}`}>
                  {label}
                </button>
              ))}
            </div>
            <form onSubmit={(e) => { e.preventDefault(); applyCond(); }} className="space-y-3">
              <label className="flex items-center gap-2 h-11 px-3 rounded-lg border border-[var(--line)] bg-[var(--card2)] focus-within:border-[var(--accent-line)]">
                <input autoFocus value={valText} onChange={(e) => setValText(e.target.value)} inputMode="decimal" aria-label="Value"
                  className="flex-1 min-w-0 bg-transparent outline-none text-[16px] tabular-nums text-[var(--ink)]" />
                <span className="text-[13px] text-[var(--ink3)]">{f?.unit}</span>
              </label>
              {med !== null && (
                <p className="text-[12px] text-[var(--ink3)]">
                  Median across {uni === "companies" ? "companies" : uni}: <button type="button" onClick={() => setValText(String(Math.round(med * 10) / 10))}
                    className="font-semibold text-[var(--accent-ink)] tabular-nums">{fmtVal(sheet.field, med, by)}</button>
                </p>
              )}
              <button type="submit" disabled={!Number.isFinite(parseFloat(valText))}
                className="rs-press w-full min-h-[44px] rounded-xl bg-[var(--accent-fill)] text-[var(--accent-fill-ink)] text-[14px] font-semibold disabled:opacity-40">
                {sheet.index === null ? "Add filter" : "Apply"}
              </button>
            </form>
            {sheet.index !== null && parsed && (
              <SheetAction icon="trash" danger onClick={() => { setConds(parsed.conds.filter((_, j) => j !== sheet.index)); setSheet(null); }}>
                Remove filter
              </SheetAction>
            )}
          </InfoDialog>
        );
      })()}

      {/* ── sectors ── */}
      {sheet?.kind === "sectors" && (
        <InfoDialog title="Sectors" onClose={() => setSheet(null)}>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => go({ sec: [] })}
              className={`rs-press min-h-[34px] px-3 rounded-full text-[13px] border ${sectors.length === 0
                ? "bg-[var(--accent-soft)] text-[var(--accent-ink)] border-[var(--accent-line)] font-semibold" : "text-[var(--ink2)] border-[var(--line)]"}`}>
              All
            </button>
            {allSectors.map((s) => {
              const on = sectors.includes(s);
              return (
                <button key={s} type="button" onClick={() => go({ sec: on ? sectors.filter((x) => x !== s) : [...sectors, s] })}
                  className={`rs-press min-h-[34px] px-3 rounded-full text-[13px] border ${on
                    ? "bg-[var(--accent-soft)] text-[var(--accent-ink)] border-[var(--accent-line)] font-semibold" : "text-[var(--ink2)] border-[var(--line)]"}`}>
                  {s}
                </button>
              );
            })}
          </div>
        </InfoDialog>
      )}

      {/* ── sort ── */}
      {sheet?.kind === "sort" && (() => {
        const base = uni === "companies" ? ["mcap", "ret_1d", "price"] : uni === "indices" ? ["members", "ret_1d", "ret_1y", "pe"] : ["oi", "ret_1d", "next_prem"];
        const keys = Array.from(new Set([...(lib?.rank ? ["__rank"] : []), ...base, ...(result?.fields ?? [])]));
        const opts = keys.map((k) => [k, k === "__rank" ? "Combined rank" : by.get(k)?.label ?? k] as [string, string]);
        return (
          <InfoDialog title="Sort" onClose={() => setSheet(null)}>
            <Chips value={sortKey} options={opts}
              onChange={(k) => setSort({ key: k, desc: k === sortKey ? !sortDesc : k !== "__rank" })} />
            {sortKey !== "__rank" && (
              <button type="button" onClick={() => setSort({ key: sortKey, desc: !sortDesc })} className="text-[13px] text-[var(--accent-ink)] font-semibold">
                {sortDesc ? "Highest first" : "Lowest first"} · Reverse
              </button>
            )}
          </InfoDialog>
        );
      })()}

      {/* ── formula ── */}
      {sheet?.kind === "formula" && (
        <InfoDialog title="Formula" onClose={() => setSheet(null)}>
          <p className="flex items-center gap-1">Field names, &lt; &gt; = and or, and arithmetic.
            <InfoTip title="Formula">
              <p>Example: <code className="font-mono">roce &gt; 20 and pe &lt; median_pe_5y * 0.8</code></p>
              <p>Field names are the ones in the filter list, written in lower case with underscores: {catalog.slice(0, 12).map((f) => f.key).join(", ")} and so on.{uni === "companies" ? " Custom ratios work too." : ""}</p>
            </InfoTip>
          </p>
          <textarea value={formulaText} onChange={(e) => setFormulaText(e.target.value)} rows={3} spellCheck={false} autoFocus
            className="w-full font-mono text-[13px] px-3 py-2 rounded-lg border border-[var(--line)] bg-[var(--card2)] text-[var(--ink)] outline-none focus:border-[var(--accent-line)]" />
          {(() => {
            try { if (formulaText.trim()) compile(formulaText, uni === "companies" ? ratiosMap : {}, uni === "companies" ? undefined : catalog.map((f) => f.key)); return null; }
            catch (e) { return <p className="text-[12px] text-[var(--neg)]">{e instanceof Error ? e.message : String(e)}</p>; }
          })()}
          <button type="button" onClick={() => { go({ q: formulaText.trim() }); setSheet(null); }}
            className="rs-press w-full min-h-[44px] rounded-xl bg-[var(--accent-fill)] text-[var(--accent-fill-ink)] text-[14px] font-semibold">
            Run
          </button>
        </InfoDialog>
      )}

      {/* ── more ── */}
      {sheet?.kind === "more" && (
        <InfoDialog title="This screen" onClose={() => setSheet(null)}>
          {uni === "companies" && <SheetAction icon="check" onClick={() => { setNameText(lib?.name ?? ""); setSheet({ kind: "save" }); }}>Save screen</SheetAction>}
          <SheetAction icon="page" onClick={() => {
            navigator.clipboard?.writeText(location.href).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }, () => {});
          }}>{copied ? "Link copied" : "Copy link"}</SheetAction>
          <SheetAction icon="upload" onClick={() => { exportCsv(); setSheet(null); }}>Export to Excel (CSV)</SheetAction>
          <SheetAction icon="edit" onClick={() => { setFormulaText(query); setSheet({ kind: "formula" }); }}>Edit as formula</SheetAction>
          {uni === "companies" && <SheetAction icon="sliders" onClick={() => { setRatioError(""); setSheet({ kind: "ratios" }); }}>Custom ratios</SheetAction>}
        </InfoDialog>
      )}

      {/* ── save ── */}
      {sheet?.kind === "save" && (
        <InfoDialog title="Save screen" onClose={() => setSheet(null)}>
          <form onSubmit={(e) => { e.preventDefault(); saveScreen(); }} className="space-y-3">
            <input autoFocus value={nameText} onChange={(e) => setNameText(e.target.value)} placeholder="Name" aria-label="Name"
              className="w-full h-11 px-3 rounded-lg border border-[var(--line)] bg-[var(--card2)] text-[14px] text-[var(--ink)] outline-none focus:border-[var(--accent-line)]" />
            {saved.some((s) => s.name === nameText.trim()) && <p className="text-[12px] text-[var(--warn-ink)]">Replaces the saved screen of that name</p>}
            <button type="submit" disabled={!nameText.trim()}
              className="rs-press w-full min-h-[44px] rounded-xl bg-[var(--accent-fill)] text-[var(--accent-fill-ink)] text-[14px] font-semibold disabled:opacity-40">
              Save
            </button>
          </form>
        </InfoDialog>
      )}

      {/* ── custom ratios ── */}
      {sheet?.kind === "ratios" && (
        <InfoDialog title="Custom ratios" onClose={() => setSheet(null)}>
          <p className="flex items-center gap-1">Your own figures, usable in formulas.
            <InfoTip title="Custom ratios"><p>Example: name <code className="font-mono">earnings_yield</code>, formula <code className="font-mono">100 / pe</code>; then screen <code className="font-mono">earnings_yield &gt; 6</code>.</p></InfoTip>
          </p>
          {ratios.map((r) => (
            <div key={r.name} className="flex items-center gap-2 font-mono text-[12px]">
              <span className="flex-1 min-w-0 truncate"><strong>{r.name}</strong> = {r.formula}</span>
              <button type="button" onClick={() => deleteRatio(r.name)} aria-label={`Delete ${r.name}`} className="p-1 text-[var(--ink3)]"><Icon name="trash" size={15} /></button>
            </div>
          ))}
          <div className="grid grid-cols-2 gap-2">
            <input value={ratioName} onChange={(e) => setRatioName(e.target.value)} placeholder="Name" aria-label="Ratio name"
              className="h-10 px-3 rounded-lg border border-[var(--line)] bg-[var(--card2)] font-mono text-[13px] text-[var(--ink)] outline-none" />
            <input value={ratioFormula} onChange={(e) => setRatioFormula(e.target.value)} placeholder="Formula" aria-label="Ratio formula"
              className="h-10 px-3 rounded-lg border border-[var(--line)] bg-[var(--card2)] font-mono text-[13px] text-[var(--ink)] outline-none" />
          </div>
          {ratioError && <p className="text-[12px] text-[var(--neg)]">{ratioError}</p>}
          <button type="button" onClick={addRatio}
            className="rs-press w-full min-h-[40px] rounded-xl border border-[var(--line2)] text-[14px] font-semibold">Add ratio</button>
        </InfoDialog>
      )}

      {/* ── one company ── */}
      {sheet?.kind === "row" && sheetRow && (() => {
        const sym = String(sheetRow.symbol);
        const price = typeof sheetRow.price === "number" ? sheetRow.price : null;
        const chg = typeof sheetRow.ret_1d === "number" ? sheetRow.ret_1d : null;
        const more = uni === "companies" ? ["pe", "roce", "mcap", "roe", "de", "ret_1y"]
          : uni === "indices" ? ["pe", "pb", "div_yield", "pe_pct", "ret_1m", "ret_1y", "from_ath", "members"]
          : ["next_prem", "carry_pa", "world_prem", "spot_prem", "oi", "vol"];
        const figs = Array.from(new Set([...(result?.fields ?? []), ...more])).filter((f) => !["price", "ret_1d"].includes(f) && sheetRow[f] != null).slice(0, 9);
        return (
          <InfoDialog title={shortName(String(sheetRow.name ?? ""), sym)} onClose={() => setSheet(null)}>
            <div className="flex items-baseline flex-wrap gap-x-2">
              <span className="text-[24px] font-semibold tabular-nums text-[var(--ink)]">{money(price)}</span>
              <span className={`text-[13px] tabular-nums ${tone(chg)}`}>{signed(dayMove(price, chg))} ({signed(chg)}%)</span>
            </div>
            <p className="text-[11px] text-[var(--ink3)]">{sym}{sheetRow.sector ? ` · ${sheetRow.sector}` : ""}</p>
            <div className="grid grid-cols-3 gap-3 py-2">
              {figs.map((f) => <Stat key={f} label={labelOf(f, by)} value={fmtVal(f, sheetRow[f], by)} />)}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Link href={hrefOf(sym)}
                className="rs-press inline-flex items-center justify-center gap-2 min-h-[44px] rounded-xl bg-[var(--accent-fill)] text-[var(--accent-fill-ink)] text-[14px] font-semibold">
                <Icon name="page" size={16} /> Overview
              </Link>
              <Link href={chartOf(sym)}
                onClick={() => { try { sessionStorage.setItem("rs_chart_from", location.pathname + location.search); } catch { /* private mode */ } }}
                className="rs-press inline-flex items-center justify-center gap-2 min-h-[44px] rounded-xl border border-[var(--line2)] text-[var(--ink)] text-[14px] font-semibold">
                <Icon name="chart" size={16} /> Chart
              </Link>
            </div>
            {lists.lists.length > 0 && (
              <div className="pt-2">
                <p className="text-[11px] uppercase tracking-wide text-[var(--ink3)] mb-1.5">Watchlists</p>
                <div className="flex flex-wrap gap-2">
                  {lists.lists.map((l) => {
                    const on = l.symbols.includes(sym);
                    return (
                      <button key={l.id} type="button" onClick={() => setLists(toggleIn(l.id, sym))}
                        className={`rs-press inline-flex items-center gap-1 min-h-[34px] px-3 rounded-full text-[13px] border ${on
                          ? "bg-[var(--accent-soft)] text-[var(--accent-ink)] border-[var(--accent-line)] font-semibold" : "text-[var(--ink2)] border-[var(--line)]"}`}>
                        <Icon name={on ? "check" : "plus"} size={13} /> {l.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </InfoDialog>
        );
      })()}

      {/* ── a saved screen ── */}
      {sheet?.kind === "saved" && sheetSaved && (
        <InfoDialog title={sheetSaved.s.name} onClose={() => setSheet(null)}>
          <p className="font-mono text-[12px] break-words">{sheetSaved.s.query}{sheetSaved.s.sectors?.length ? ` · ${sheetSaved.s.sectors.length} sectors` : ""}</p>
          {sheetSaved.added.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-[var(--pos)] mb-1">New since {shortDay(sheetSaved.s.seenAsof)}</p>
              <p className="text-[13px] text-[var(--ink)] break-words">{sheetSaved.added.join(", ")}</p>
            </div>
          )}
          {sheetSaved.removed.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-[var(--neg)] mb-1">Left since {shortDay(sheetSaved.s.seenAsof)}</p>
              <p className="text-[13px] text-[var(--ink)] break-words">{sheetSaved.removed.join(", ")}</p>
            </div>
          )}
          <div className="flex items-center">
            <div className="flex-1">
              <SheetAction icon="page" onClick={() => {
                const line = [sheetSaved.s.name.replace(/[|#]/g, " "), sheetSaved.s.query, (sheetSaved.s.sectors ?? []).join(", ")].filter(Boolean).join(" | ");
                navigator.clipboard?.writeText(line).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }, () => {});
              }}>
                {copied ? "Copied" : "Copy for phone alerts"}
              </SheetAction>
            </div>
            <InfoTip title="Phone alerts" className="mr-3">
              <p>The app shows what changed each time you open it. To be told on your phone after each night&apos;s refresh, paste this line into alerts/screens.txt in the Rscreener repository — the GitHub app on your phone can edit it.</p>
            </InfoTip>
          </div>
          <button type="button" onClick={() => openSaved(sheetSaved.s)}
            className="rs-press w-full min-h-[44px] rounded-xl bg-[var(--accent-fill)] text-[var(--accent-fill-ink)] text-[14px] font-semibold">
            Open{sheetSaved.added.length + sheetSaved.removed.length > 0 ? " and mark seen" : ""}
          </button>
          {confirmDelete ? (
            <div className="flex items-center gap-2 px-3 min-h-[46px]">
              <span className="flex-1 text-[13px] text-[var(--neg)]">Delete {sheetSaved.s.name}?</span>
              <button type="button" onClick={() => { setSaved(storeSaved(saved.filter((x) => x.name !== sheetSaved.s.name))); setSheet(null); }}
                className="rs-press min-h-[34px] px-3 rounded-full bg-[var(--neg)] text-white text-[13px] font-semibold">Delete</button>
              <button type="button" onClick={() => setConfirmDelete(false)}
                className="rs-press min-h-[34px] px-3 rounded-full border border-[var(--line)] text-[13px]">Keep</button>
            </div>
          ) : (
            <SheetAction icon="trash" danger onClick={() => setConfirmDelete(true)}>Delete screen</SheetAction>
          )}
        </InfoDialog>
      )}
    </div>
  );
}

/** useSearchParams needs a Suspense boundary under static export. */
export default function ScreensPage() {
  return (
    <Suspense fallback={null}>
      <ScreensInner />
    </Suspense>
  );
}
