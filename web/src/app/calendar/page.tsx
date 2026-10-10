"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import TopNav from "@/components/TopNav";
import InfoTip, { InfoDialog } from "@/components/InfoTip";
import { StarGlyph, ExternalGlyph } from "@/components/Glyphs";
import { Chips, Icon, Stat, signed, tone } from "@/components/QuoteUI";
import { allWatched } from "@/lib/watchlists";
import { SEASON_QUARTERS } from "@/components/Seasons";
import { loadPortfolio } from "@/lib/portfolio";
import { shortName } from "@/lib/names";
import {
  CalEvent, CalKind, GROUPS, KIND_LABEL, PastDoc, UpcomingDoc, clock, crore, dayLabel, docUrl, fromPast, fromUpcoming, matches, quarterDue,
} from "@/lib/calendar";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
/** Rows drawn at a time: the past year holds about 11,000 events. */
const PAGE = 250;
/** How often an open page looks for newly published results. The results
 *  watcher publishes within minutes of NSE listing them (results-watch.yml). */
const RECHECK_MS = 3 * 60_000;

const COLOR: Record<CalKind, string> = {
  results: "var(--accent)", dividend: "var(--ca-div)", bonus: "var(--ca-bon)", split: "var(--ca-spl)",
  rights: "var(--ca-rgt)", buyback: "var(--ca-buy)", other: "var(--ca-oth)", ipo: "var(--warn)", meeting: "var(--ink3)",
};

function Badge({ kind }: { kind: CalKind }) {
  return (
    <span className="shrink-0 text-[10px] font-semibold rounded px-1.5 py-0.5"
      style={{ color: COLOR[kind], background: `color-mix(in srgb, ${COLOR[kind]} 14%, transparent)` }}>
      {KIND_LABEL[kind]}
    </span>
  );
}

const pctText = (v: number | undefined, dec = 1) => (v === undefined ? "" : `${signed(v, dec)}%`);
/** ₹5.5 reads as ₹5.50. */
const rs = (v: number) => `₹${Number.isInteger(v) ? v : v.toFixed(2)}`;

/** Growth against a year before (y) or against the quarter before (q). */
type Basis = "y" | "q";
const BASIS_KEY = "rs.calendar.growth";
const COL = "w-[50px] shrink-0 text-right";

/** Sales and profit growth on the chosen basis - for a coming result, its
 *  last one's. Null for anything that is not a result. */
function growth(e: CalEvent, b: Basis): { rv?: number; pt?: number; loss: boolean } | null {
  // A result still to come shows nothing until it is out. Its LAST quarter's
  // growth used to sit in these columns, and on Anand Rathi Wealth's row the
  // day before its Q2 results that read as if Q2 were already known.
  if (e.next?.type === "results") return { loss: false };
  const r = e.past?.k === "results" ? e.past : undefined;
  if (!r) return null;
  return { rv: b === "y" ? r.rvy : r.rvq, pt: b === "y" ? r.pty : r.ptq, loss: (r.pt ?? 0) < 0 };
}

/** One figure in a column. A loss says so; a jump of 1,000% or more reads "24×". */
function Cell({ v, loss = false, cls = COL }: { v?: number; loss?: boolean; cls?: string }) {
  const text = loss ? "Loss" : v === undefined ? "—" : v >= 1000 ? `${Math.round(1 + v / 100)}×` : `${signed(v, 1)}%`;
  return <span className={`${cls} text-[12px] font-semibold tabular-nums ${loss ? "text-[var(--neg)]" : tone(v)}`}>{text}</span>;
}

/** The one line under a company's name. */
function line(e: CalEvent): string {
  const p = e.past, n = e.next;
  // The time first: on a phone the line is cut off after thirty-odd letters.
  if (p?.k === "results") {
    return [p.at && clock(p.at), p.q, !p.at && p.rv === undefined && p.pt === undefined && "figures not in yet"]
      .filter(Boolean).join(" · ");
  }
  if (p?.k === "dividend") return [p.amt && `${rs(p.amt)} a share`, p.yld !== undefined && `${p.yld}% of the price`, !p.amt && p.x].filter(Boolean).join(" · ");
  if (p?.k === "ipo") return [p.seg, p.ip && `issue ${rs(p.ip)}`, p.lc && `first close ${rs(p.lc)}`].filter(Boolean).join(" · ");
  if (p?.k === "meeting") return p.x ?? "";
  if (p) return p.x ?? "";
  if (n?.type === "results") {
    // "Financial Results/Dividend": what else the meeting takes up.
    const also = n.purpose.split("/").map((x) => x.trim()).filter((x) => x && !/^financial results?$/i.test(x));
    return [n.usual && `~${clock(n.usual)}`, `${quarterDue(n.date)} due`, also.length && `also ${also.join(", ").toLowerCase()}`]
      .filter(Boolean).join(" · ");
  }
  if (n?.type === "dividend" && n.amt) return [`${rs(n.amt)} a share`, n.yld !== undefined && `${n.yld}% of the price`].filter(Boolean).join(" · ");
  return n?.desc ?? "";
}

/** The row's second line; a coming result or IPO also says what it is. */
function sub(e: CalEvent): string {
  const l = line(e);
  if (e.upcoming && e.kind === "ipo") return [e.what, l].filter(Boolean).join(" · ");
  return l || e.what;
}

/** The figure on the right: how the stock moved. */
function figure(e: CalEvent): { v: number; label: string } | null {
  const p = e.past;
  if (p?.k === "results" && p.mv !== undefined) return { v: p.mv, label: "stock" };
  if (p?.k === "ipo" && p.lg !== undefined) return { v: p.lg, label: "day one" };
  return null;
}

export default function CalendarPage() {
  const [next, setNext] = useState<UpcomingDoc | null>(null);
  const [past, setPast] = useState<PastDoc | null>(null);
  const [error, setError] = useState("");
  const [pastError, setPastError] = useState("");
  const [when, setWhen] = useState<"next" | "past">("next");
  const [group, setGroup] = useState("all");
  const [mineOnly, setMineOnly] = useState(false);
  const [mine, setMine] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<CalEvent | null>(null);
  const [today, setToday] = useState("");
  const [basis, setBasis] = useState<Basis>("y");
  const pickBasis = (b: Basis) => {
    setBasis(b);
    try { localStorage.setItem(BASIS_KEY, b); } catch { /* the choice just is not remembered */ }
  };

  // A new URL each minute: GitHub Pages' CDN keeps a file for ten minutes, so
  // the plain one could show results published nine minutes ago as not out.
  const loadNext = useCallback((first: boolean) => {
    fetch(`${BASE}/calendar.json?t=${Math.floor(Date.now() / 60_000)}`, { cache: "no-store" })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d: UpcomingDoc) => setNext((cur) => (cur && cur.updated && cur.updated === d.updated ? cur : d)))
      .catch((e) => { if (first) setError(String(e.message ?? e)); });
  }, []);

  useEffect(() => {
    const look = () => { if (document.visibilityState === "visible") loadNext(false); };
    const timer = setInterval(look, RECHECK_MS);
    document.addEventListener("visibilitychange", look);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", look); };
  }, [loadNext]);

  useEffect(() => {
    loadNext(true);
    // The past year is the larger file (about 500 KB on the wire); it loads
    // behind the upcoming list rather than in front of it. Hourly is fresh
    // enough: its last three days come from calendar.json.
    fetch(`${BASE}/calendar-past.json?h=${Math.floor(Date.now() / 3_600_000)}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(setPast)
      .catch((e) => setPastError(String(e.message ?? e)));
    setMine(new Set([...allWatched(), ...loadPortfolio().map((h) => h.symbol)]));
    const d = new Date();
    setToday(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
    // A link can open the page on a company: /calendar?q=TCS
    try { if (localStorage.getItem(BASIS_KEY) === "q") setBasis("q"); } catch { /* default: yearly */ }
    const fromUrl = new URLSearchParams(window.location.search).get("q");
    if (fromUrl) setQ(fromUrl);
  }, []);

  const coming = useMemo(() => (next?.events ?? []).filter((e) => !today || e.date >= today)
    .map((e, i) => fromUpcoming(e, i, shortName)), [next, today]);
  // The past year, its last three days from the fresher calendar.json.
  const history = useMemo(() => {
    const from = next?.recent ? next.recent_from ?? "" : "";
    const names = { ...(past?.names ?? {}), ...(next?.recent_names ?? {}) };
    const events = [...(next?.recent ?? []), ...(past?.events ?? []).filter((e) => !from || e.d < from)];
    return past || next?.recent ? events.map((e, i) => fromPast(e, i, names, shortName)) : [];
  }, [past, next]);
  // Coming up opens on today: the results already out, latest first, above
  // the ones still to come.
  const outToday = useMemo(() => history.filter((e) => e.date === today), [history, today]);
  const upcoming = useMemo(() => [...outToday, ...coming], [outToday, coming]);

  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const searching = words.length > 0;
  const kinds = GROUPS.find(([k]) => k === group)?.[2] ?? [];
  const keep = (e: CalEvent) => (!kinds.length || kinds.includes(e.kind)) && (!mineOnly || mine.has(e.symbol))
    && (!searching || matches(e, words));

  // Searching looks both ways at once: what is coming, then the past year.
  // While searching, today's results show once - under the past year.
  const nextList = useMemo(() => (searching ? coming : upcoming).filter(keep), [upcoming, coming, searching, group, mineOnly, mine, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const pastList = useMemo(() => history.filter(keep), [history, group, mineOnly, mine, q]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => setShown(PAGE), [when, group, mineOnly, q]);

  const sections: [string, CalEvent[], number][] = searching
    ? [["Coming up", nextList, nextList.length], ["Past year", pastList, pastList.length]]
    : [["", when === "next" ? nextList : pastList, (when === "next" ? nextList : pastList).length]];

  let budget = shown;
  const drawn = sections.map(([title, list, total]) => {
    const slice = list.slice(0, Math.max(0, budget));
    budget -= slice.length;
    // One card per day - two for today on Coming up: out, and still to come.
    const days: [string, CalEvent[]][] = [];
    for (const e of slice) {
      const last = days[days.length - 1];
      if (last && last[0] === e.date && last[1][0].upcoming === e.upcoming) last[1].push(e);
      else days.push([e.date, [e]]);
    }
    return { title, days, total, hidden: total - slice.length };
  });
  const hidden = drawn.reduce((a, s) => a + s.hidden, 0);

  const loadingPast = (when === "past" || searching) && !past && !pastError;
  const stale = next?.generated_at
    ? Math.floor((Date.now() - Date.parse(next.generated_at.replace(" UTC", "Z").replace(" ", "T"))) / 86400000) : 0;

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <TopNav active="calendar" />
      <main className="rs-page-in max-w-3xl mx-auto px-4 py-5 space-y-3">
        <h1 className="text-xl font-bold flex items-center gap-1.5">
          Calendar
          <InfoTip title="Calendar">
            <p>Coming up: board meetings (results, dividends, fund raising), ex-dates for dividends, bonuses, splits and rights, and IPOs, from NSE&apos;s event calendar and each company&apos;s corporate actions.</p>
            <p>Past year: every results announcement with the quarter&apos;s sales and net profit against the same quarter a year before, and how the stock moved; dividends with what they were worth against the price; splits, bonuses, rights, buybacks and demergers; IPO listings with the first day&apos;s close against the issue price.</p>
            <p>&quot;Stock&quot; on a result is the move from the last close before the day NSE published it to the close of the next session after it - results often come out after the market shuts, so the window spans two sessions. A split or bonus inside the window leaves it blank. Nifty 50 over the same window is in the detail.</p>
            <p>Search covers both the coming weeks and the past year. A record of what happened, not a forecast and not advice to buy or sell.</p>
          </InfoTip>
        </h1>

        <div className="relative">
          <Icon name="search" size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--ink3)] pointer-events-none" />
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setQ(""); }}
            placeholder="Search a company or ticker" aria-label="Search a company or ticker" autoComplete="off" enterKeyHint="search"
            className="w-full rounded-xl border border-[var(--line2)] bg-[var(--card)] pl-10 pr-10 py-3 text-base text-[var(--ink)]
                       placeholder:text-[var(--ink3)] focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)]" />
          {q && (
            <button type="button" onClick={() => setQ("")} aria-label="Clear search"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 w-9 h-9 inline-flex items-center justify-center rounded-full text-[var(--ink3)] active:bg-[var(--card2)]">
              <Icon name="close" size={16} />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {!searching && (
            <Chips value={when} options={[["next", "Coming up"], ["past", "Past year"]] as ["next" | "past", string][]} onChange={setWhen} />
          )}
          <button type="button" onClick={() => setMineOnly(!mineOnly)} aria-pressed={mineOnly}
            className={`rs-press inline-flex items-center gap-1 min-h-[34px] px-3 rounded-full text-[13px] border ${mineOnly
              ? "bg-[var(--accent-soft)] text-[var(--accent-ink)] border-[var(--accent-line)] font-semibold" : "text-[var(--ink2)] border-[var(--line)]"}`}>
            <StarGlyph filled={mineOnly} size={13} />My stocks
          </button>
        </div>
        <div className="-mx-4 px-4 flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {GROUPS.map(([k, label]) => (
            <button key={k} type="button" onClick={() => setGroup(k)} aria-pressed={group === k}
              className={`rs-press shrink-0 min-h-[34px] px-3 rounded-full text-[13px] border ${group === k
                ? "bg-[var(--accent-soft)] text-[var(--accent-ink)] border-[var(--accent-line)] font-semibold" : "text-[var(--ink2)] border-[var(--line)]"}`}>
              {label}
            </button>
          ))}
        </div>

        {(group === "all" || group === "results") && (
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-[var(--ink3)]">Growth</span>
            <Chips value={basis} options={[["y", "Yearly"], ["q", "Quarterly"]] as [Basis, string][]} onChange={pickBasis} />
            <InfoTip title="Growth">
              <p>Yearly: the quarter&apos;s sales and net profit against the same quarter a year before (YoY). Quarterly: against the quarter just before it (QoQ).</p>
              <p>Many businesses are seasonal - festive quarters, monsoon quarters - so quarter-on-quarter swings can be large without meaning much; yearly is the steadier read.</p>
              <p>&quot;Loss&quot; means the quarter itself was a loss; a dash, that the earlier quarter was a loss or is not in the database. A coming result stays blank until it is released. &quot;Usual&quot; is the middle of the stock&apos;s moves on its last four results.</p>
              <p>Results are published here within minutes of NSE listing them. The time on a result is when NSE published the company&apos;s announcement; the figures come from the company&apos;s data filing (XBRL), which can follow hours later - until then the row says &quot;figures awaited&quot;. &quot;Usually ~3:45 pm&quot; is the middle of the times of its last four results.</p>
            </InfoTip>
          </div>
        )}

        {error && <p className="text-[var(--neg)] text-sm">The calendar did not load ({error}).</p>}
        {stale > 3 && !searching && when === "next" && (
          <div className="text-sm rounded-xl border border-[var(--neg-line)] bg-[var(--neg-soft)] text-[var(--neg)] p-3">
            <span className="font-semibold">NSE&apos;s calendar was last read {stale} days ago</span> ({next?.generated_at}).
            Meetings announced since then are missing.
          </div>
        )}
        {(!next && !error) || loadingPast ? (
          <div className="space-y-3" aria-busy="true" aria-label="Loading">
            <div className="rs-skel h-28" /><div className="rs-skel h-28" /><div className="rs-skel h-28" />
          </div>
        ) : null}
        {pastError && (when === "past" || searching) && <p className="text-[var(--neg)] text-sm">The past year did not load ({pastError}).</p>}

        {!loadingPast && (next || past) && drawn.map((s) => (
          <Fragment key={s.title || "list"}>
            {s.title && (
              <h2 className="pt-2 text-[13px] font-bold">{s.title} <span className="font-normal text-[var(--ink3)]">· {s.total.toLocaleString("en-IN")}</span></h2>
            )}
            {s.total === 0 && (
              <p className="py-6 text-center text-[13px] text-[var(--ink3)]">
                Nothing{searching ? ` for “${q.trim()}”` : ""}{mineOnly ? " in your stocks" : ""}{group !== "all" ? " of this type" : ""}{(searching ? s.title === "Coming up" : when === "next") ? " coming up" : " in the past year"}
              </p>
            )}
            {s.days.map(([d, list], i) => (
              <Fragment key={`${s.title}${d}`}>
                {(i === 0 || s.days[i - 1][0].slice(0, 7) !== d.slice(0, 7)) && s.days[i - 1]?.[0] !== d && (
                  <h3 className="pt-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--ink3)]">
                    {new Date(`${d}T12:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" })}
                  </h3>
                )}
                <section className="rounded-xl border border-[var(--line)] bg-[var(--card)] overflow-hidden">
                  <h3 className="px-3 py-2 text-[13px] font-semibold border-b border-[var(--line)] flex items-center gap-3">
                    <span className="flex-1">
                      {d === today ? "Today" : dayLabel(d)}
                      {d === today && (when === "next" || searching) && s.title !== "Past year" && list.some((e) => e.kind === "results") && (
                        <span className="font-normal text-[var(--ink2)]">{list[0].upcoming ? " · still to come" : " · out"}</span>
                      )}
                      <span className="font-normal text-[var(--ink3)]"> · {list.length}</span>
                    </span>
                    {list.some((e) => growth(e, basis)) && (
                      <span className="flex text-[10px] font-medium uppercase tracking-wide text-[var(--ink3)]">
                        <span className={COL}>Sales</span><span className={COL}>Profit</span>
                        <span className={COL}>{list[0].upcoming ? "Usual" : "Stock"}</span>
                      </span>
                    )}
                  </h3>
                  <ul className="divide-y divide-[var(--line)]">
                    {list.map((e) => {
                      const f = figure(e), g = growth(e, basis);
                      return (
                        <li key={e.id}>
                          <button type="button" onClick={() => setOpen(e)} className="w-full flex items-start gap-3 px-3 py-2.5 text-left active:bg-[var(--card2)]">
                            <span className="flex-1 min-w-0">
                              {/* The name gets the whole first line: beside three
                                  columns of figures it had room for five letters. */}
                              <span className="block text-[14px] font-medium truncate">{e.name}</span>
                              <span className="flex items-center gap-1.5 min-w-0 text-[12px] text-[var(--ink3)] tabular-nums">
                                <Badge kind={e.kind} />
                                <span className="shrink-0">{e.symbol}</span>
                                <span className="truncate">· {sub(e)}</span>
                              </span>
                            </span>
                            {g && e.past?.at && e.past.rv === undefined && e.past.pt === undefined ? (
                              <span className="w-[150px] shrink-0 pt-0.5 text-right text-[12px] text-[var(--ink3)]">Figures awaited</span>
                            ) : g ? (
                              <span className="flex pt-0.5">
                                <Cell v={g.rv} /><Cell v={g.pt} loss={g.loss} />
                                {e.upcoming
                                  ? <span className={`${COL} text-[12px] tabular-nums text-[var(--ink2)]`}>{e.next?.typ !== undefined ? `±${e.next.typ}%` : "—"}</span>
                                  : <Cell v={e.past?.mv} />}
                              </span>
                            ) : f && (
                              <span className="shrink-0 text-right">
                                <span className={`block text-[13px] font-semibold tabular-nums ${tone(f.v)}`}>{signed(f.v, 1)}%</span>
                                <span className="block text-[10px] text-[var(--ink3)]">{f.label}</span>
                              </span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              </Fragment>
            ))}
          </Fragment>
        ))}

        {hidden > 0 && !loadingPast && (
          <button type="button" onClick={() => setShown(shown + PAGE)}
            className="rs-press w-full min-h-[44px] rounded-xl border border-[var(--line)] bg-[var(--card)] text-[14px] font-medium text-[var(--accent-ink)]">
            Show {Math.min(PAGE, hidden).toLocaleString("en-IN")} more <span className="text-[var(--ink3)] font-normal">of {hidden.toLocaleString("en-IN")}</span>
          </button>
        )}
        {next && (
          <p className="text-[11px] text-[var(--ink3)]">
            {next.updated ? `Updated ${new Date(next.updated).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })} IST, re-checked every 3 minutes while open · ` : ""}
            NSE event calendar read {next.generated_at ?? "—"}{past ? ` · past year ${dayLabel(past.from, true)} to ${dayLabel(past.to, true)}, prices to ${past.prices_to ? dayLabel(past.prices_to, true) : "—"}` : ""}
          </p>
        )}
      </main>

      {open && <Detail e={open} onClose={() => setOpen(null)} basis={basis} pickBasis={pickBasis}
        earlier={history.filter((h) => h.symbol === open.symbol && h.kind === "results" && h.date < open.date).slice(0, 4)} />}
    </div>
  );
}

/** The company's results before this one, newest first. */
function Earlier({ list, basis, pickBasis }: { list: CalEvent[]; basis: Basis; pickBasis: (b: Basis) => void }) {
  if (!list.length) return null;
  const cell = (v: number | undefined, dec = 1) => <span className={`tabular-nums text-right ${tone(v)}`}>{v === undefined ? "—" : pctText(v, dec)}</span>;
  return (
    <div>
      <div className="flex items-center justify-between gap-2 pb-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--ink3)]">Its last {list.length === 1 ? "result" : `${list.length} results`}</p>
        <Chips value={basis} options={[["y", "Yearly"], ["q", "Quarterly"]] as [Basis, string][]} onChange={pickBasis} />
      </div>
      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 gap-y-1 text-[12px]">
        <span className="text-[var(--ink3)]">Quarter</span><span className="text-[var(--ink3)] text-right">Sales</span>
        <span className="text-[var(--ink3)] text-right">Profit</span><span className="text-[var(--ink3)] text-right">Stock</span>
        {list.map((r) => (
          <Fragment key={r.id}>
            <span>{r.past?.q} <span className="text-[var(--ink3)]">· {dayLabel(r.date).replace(/^\w+, /, "")}</span></span>
            {cell(basis === "y" ? r.past?.rvy : r.past?.rvq)}{cell(basis === "y" ? r.past?.pty : r.past?.ptq)}{cell(r.past?.mv)}
          </Fragment>
        ))}
      </div>
      <p className="text-[11px] text-[var(--ink3)] pt-1">Sales and profit against {basis === "y" ? "the same quarter a year before" : "the quarter before"}.</p>
    </div>
  );
}

function Detail({ e, onClose, earlier, basis, pickBasis }: {
  e: CalEvent; onClose: () => void; earlier: CalEvent[]; basis: Basis; pickBasis: (b: Basis) => void;
}) {
  const p = e.past, n = e.next;
  const rel = p?.mv !== undefined && p?.nf !== undefined ? p.mv - p.nf : undefined;
  return (
    <InfoDialog title={e.name} onClose={onClose}>
      <div className="flex items-center gap-2 flex-wrap">
        <Badge kind={e.kind} />
        <span className="text-[12px] text-[var(--ink3)]">{e.symbol} · {dayLabel(e.date, true)}</span>
      </div>
      <p className="text-[14px] text-[var(--ink)] font-medium leading-snug">{e.what}</p>

      {p?.k === "results" && (
        <>
          {(p.rv !== undefined || p.pt !== undefined) && (
            <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 gap-y-1.5 items-baseline py-1">
              <span /><span className="text-[11px] text-[var(--ink3)] text-right">{p.q}</span>
              <span className="text-[11px] text-[var(--ink3)] text-right">Quarterly</span>
              <span className="text-[11px] text-[var(--ink3)] text-right">Yearly</span>
              {p.rv !== undefined && (
                <>
                  <span className="text-[13px] text-[var(--ink2)]">Sales</span>
                  <span className="text-[14px] font-medium tabular-nums text-right">{crore(p.rv)}</span>
                  <Cell v={p.rvq} cls="text-right" /><Cell v={p.rvy} cls="text-right" />
                </>
              )}
              {p.pt !== undefined && (
                <>
                  <span className="text-[13px] text-[var(--ink2)]">Net profit</span>
                  <span className="text-[14px] font-medium tabular-nums text-right">{crore(p.pt)}</span>
                  <Cell v={p.ptq} cls="text-right" /><Cell v={p.pty} cls="text-right" />
                </>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 py-1">
            {p.at && <Stat label="Out at" value={`${clock(p.at)} IST`} />}
            {p.eps !== undefined && <Stat label="EPS" value={`₹${p.eps}`} />}
            {p.mv !== undefined && <Stat label="Stock, over the results" value={pctText(p.mv, 2)} className={tone(p.mv)} />}
            {p.nf !== undefined && <Stat label="Nifty 50, same days" value={pctText(p.nf, 2)} className={tone(p.nf)} />}
            {rel !== undefined && <Stat label="Stock against Nifty" value={`${signed(rel, 2)} pts`} className={tone(rel)} />}
          </div>
          {p.rv === undefined && p.pt === undefined && (
            <p className="text-[12px]">{p.at
              ? "The results are out; their figures come from the company's data filing (XBRL), which often follows hours later, and appear here once it is filed. Until then the announcement itself has them."
              : "The quarter's figures are not in the database yet."}</p>
          )}
          {(p.rv !== undefined || p.pt !== undefined) && (
            <p className="text-[11px] text-[var(--ink3)]">{p.sa ? "Standalone" : "Consolidated"} figures from the company&apos;s filing with NSE. Quarterly: against the quarter before; yearly: against the same quarter a year before.{p.mv !== undefined ? " Stock: last close before the day of the results to the close of the next session after it." : ""}</p>
          )}
          <Earlier list={earlier} basis={basis} pickBasis={pickBasis} />
          {(p.cc || p.doc) && (
            <div className="grid grid-cols-2 gap-2">
              {p.doc && <DocLink href={docUrl(p.doc)}>Results announcement</DocLink>}
              {p.cc?.t && <DocLink href={docUrl(p.cc.t)}>Call transcript</DocLink>}
              {p.cc?.r && <DocLink href={docUrl(p.cc.r)}>Call recording</DocLink>}
            </div>
          )}
        </>
      )}

      {p?.k === "dividend" && (
        <div className="grid grid-cols-2 gap-3 py-1">
          {p.amt !== undefined && <Stat label="Per share" value={`${rs(p.amt)}`} />}
          {p.yld !== undefined && <Stat label="Of the price the day before" value={`${p.yld}%`} />}
        </div>
      )}
      {p?.k === "ipo" && (
        <div className="grid grid-cols-2 gap-3 py-1">
          {p.seg && <Stat label="Segment" value={p.seg} />}
          {p.ip !== undefined && <Stat label="Issue price" value={`${rs(p.ip)}`} />}
          {p.lc !== undefined && <Stat label="First close" value={`${rs(p.lc)}`} />}
          {p.lg !== undefined && <Stat label="First close vs issue" value={pctText(p.lg)} className={tone(p.lg)} />}
        </div>
      )}
      {p && ["bonus", "split", "rights", "buyback", "other"].includes(p.k) && (
        <p className="text-[12px]">{p.k === "bonus" || p.k === "split"
          ? "The share count changed on this date; prices before it are not comparable without adjusting for it."
          : p.k === "rights" ? "Shareholders on the record date could buy new shares at the stated price."
          : p.k === "buyback" ? "The company bought back its own shares." : "A change to the company's shares or securities."}</p>
      )}
      {p?.k === "meeting" && p.x && <p className="text-[13px]">{p.x}</p>}

      {n && (
        <>
          {n.desc && <p className="text-[13px]">{n.desc}</p>}
          {n.type === "results" && n.usual && (
            <>
              <Stat label="Usually out" value={`~${clock(n.usual)} IST`} />
              <p className="text-[11px] text-[var(--ink3)]">The middle of the times NSE published its last {n.un} results. When it was, not when it will be.</p>
            </>
          )}
          {n.type === "results" && n.ssn && (
            <p className="text-[13px]">
              {SEASON_QUARTERS[n.ssn.q]} is usually {n.ssn.pk ? "its strongest quarter" : n.ssn.lo ? "its weakest quarter" : "an ordinary quarter"} for sales:{" "}
              <span className="font-semibold tabular-nums">{n.ssn.i.toFixed(2)}×</span> an average one, so a change from the quarter before can be the season rather than news.
            </p>
          )}
          {n.type === "results" && n.typ !== undefined && (
            <Stat label={`Typical move on its last ${n.n} results`} value={`±${n.typ}%`} />
          )}
          {n.type === "results" && n.typ !== undefined && (
            <p className="text-[11px] text-[var(--ink3)]">Typical move: the middle of the stock&apos;s moves on its last {n.n} results, up or down. What happened before, not a forecast.</p>
          )}
          {n.type === "results" && <Earlier list={earlier} basis={basis} pickBasis={pickBasis} />}
          {n.type === "dividend" && n.amt !== undefined && (
            <div className="grid grid-cols-2 gap-3 py-1">
              <Stat label="Per share" value={`${rs(n.amt)}`} />
              {n.yld !== undefined && <Stat label="Of the latest price" value={`${n.yld}%`} />}
            </div>
          )}
          {n.kind === "exdate" && <p className="text-[11px] text-[var(--ink3)]">Shares bought on or after the ex-date do not carry this entitlement.</p>}
        </>
      )}

      <Link href={`/company?s=${encodeURIComponent(e.symbol)}`}
        className="rs-press inline-flex items-center justify-center w-full min-h-[44px] rounded-xl bg-[var(--accent-fill)] text-[var(--accent-fill-ink)] text-[14px] font-semibold">
        Open {e.name}
      </Link>
      <p className="text-[11px] text-[var(--ink3)]">Source: NSE - {e.upcoming ? "event calendar and corporate actions" : p?.k === "results" ? "results filings and daily prices" : p?.k === "ipo" ? "IPO list and daily prices" : "corporate actions"}.</p>
    </InfoDialog>
  );
}

function DocLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className="rs-press inline-flex items-center justify-center gap-1.5 min-h-[40px] rounded-xl border border-[var(--line)] text-[13px] font-medium text-[var(--accent-ink)]">
      {children} <ExternalGlyph size={12} />
    </a>
  );
}
