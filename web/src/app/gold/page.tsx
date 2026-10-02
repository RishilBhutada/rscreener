"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import TopNav from "@/components/TopNav";
import InfoTip, { InfoDialog } from "@/components/InfoTip";
import { StarGlyph, ExternalGlyph } from "@/components/Glyphs";
import { Chips, Stat, signed, tone } from "@/components/QuoteUI";
import { COUNTRY, GoldDoc, GoldEvent, GoldFamily, GoldNews, ago, istDate, istDay, istTime } from "@/lib/gold";

/** Gold: what it costs now, and what moves it - the scheduled releases and
 *  decisions of the week, every Fed meeting, and the headlines - each rated
 *  one to five stars for how much it has mattered to gold, with the reason.
 *  A description of what has moved gold, not a forecast or a trade. */

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
type Tab = "calendar" | "news" | "ratings";

function Stars({ n, size = 13 }: { n: number; size?: number }) {
  return (
    <span className="inline-flex shrink-0 text-[var(--warn)]" aria-label={`${n} of 5`} title={`${n} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => <StarGlyph key={i} filled={i <= n} size={size} className={i <= n ? "" : "opacity-30"} />)}
    </span>
  );
}

function basis(f: GoldFamily, min: number): string {
  if (f.fixed) return "Set by rule: an exchange date, not news, so gold's moves around it are not measured.";
  if (f.ratio !== undefined && f.median_move !== undefined && f.normal_move !== undefined) {
    const since = f.since ? new Date(`${f.since}T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" }) : "";
    const rule = f.stars !== f.rule ? ` The rule alone gave ${f.rule}.` : "";
    return `Measured: on ${f.n} of these since ${since}, gold moved a median ${f.median_move}% the next session, against ${f.normal_move}% on an ordinary day - ${f.ratio.toFixed(1)}x.${rule}`;
  }
  return `Rule-based: ${f.n} of these have gold prices around them so far; the stars switch to measured at ${min}.`;
}

/** The kind of event under its title - or, where the title already says
 *  it ("ECB rate decision"), where the date comes from. */
function subtitle(e: GoldEvent, label?: string): string {
  return label && !e.title.toLowerCase().startsWith(label.toLowerCase()) ? label : e.src;
}

function Card({ title, tip, children }: { title: string; tip?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-[var(--line)] bg-[var(--card)] overflow-hidden">
      <h2 className="px-3 pt-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--ink3)] flex items-center gap-1">{title}{tip}</h2>
      {children}
    </section>
  );
}

export default function GoldPage() {
  const [doc, setDoc] = useState<GoldDoc | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("calendar");
  const [when, setWhen] = useState<"next" | "past">("next");
  const [minNews, setMinNews] = useState<"3" | "2">("3");
  const [minEv, setMinEv] = useState<"3" | "1">("3");
  const [ev, setEv] = useState<GoldEvent | null>(null);
  const [item, setItem] = useState<GoldNews | null>(null);
  const [now, setNow] = useState(0);

  useEffect(() => {
    fetch(`${BASE}/gold.json`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d: GoldDoc) => { setDoc(d); setNow(Date.now()); })
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  const days = useMemo(() => {
    if (!doc || !now) return [];
    const list = doc.events.filter((e) => e.stars >= Number(minEv)
      && (when === "next" ? new Date(e.t).getTime() >= now - 3600000 : new Date(e.t).getTime() < now));
    if (when === "past") list.reverse();
    const by = new Map<string, GoldEvent[]>();
    for (const e of list) by.set(istDate(e.t), [...(by.get(istDate(e.t)) ?? []), e]);
    return Array.from(by.entries());
  }, [doc, when, now, minEv]);

  const news = useMemo(() => (doc?.news ?? []).filter((n) => n.stars >= Number(minNews)), [doc, minNews]);
  const fams = useMemo(() => Object.entries(doc?.families ?? {}).filter(([k]) => k !== "other")
    .sort((a, b) => b[1].stars - a[1].stars || b[1].rule - a[1].rule), [doc]);

  const s = doc?.snapshot;
  const evFam = ev && doc ? doc.families[ev.fam] : null;

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <TopNav active="gold" />
      <main className="rs-page-in max-w-3xl mx-auto px-4 py-5 space-y-3">
        <h1 className="text-xl font-bold flex items-center gap-1.5">
          Gold
          <InfoTip title="Gold">
            <p>What gold costs in India and the world, and the events that move it: this week&apos;s scheduled releases, every Fed meeting, and the week&apos;s headlines.</p>
            <p>Each is rated one to five stars for how much that kind of event has mattered to gold, with the reason. Where enough past events have prices around them the stars are measured - how far gold actually moved the session after - rather than set by rule.</p>
            <p>A record of what has moved gold, not a forecast and not advice to buy or sell.</p>
          </InfoTip>
        </h1>

        {error && <p className="text-sm text-[var(--neg)]">{error}</p>}
        {!doc && !error && <div className="rs-skel h-96" aria-busy="true" aria-label="Loading" />}

        {doc && s && (
          <>
            <section className="rounded-xl border border-[var(--line)] bg-[var(--card)] px-3 py-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-[var(--ink3)]">MCX gold · ₹ per 10 g</p>
                  <p className="text-2xl font-bold tabular-nums">{s.mcx ? `₹${s.mcx.close.toLocaleString("en-IN")}` : "—"}</p>
                  {s.mcx && <p className={`text-[13px] font-semibold tabular-nums ${tone(s.mcx.chg)}`}>{signed(s.mcx.chg)}% <span className="font-normal text-[var(--ink3)]">· {istDay(`${s.mcx.date}T12:00:00Z`)}</span></p>}
                </div>
                <div className="text-right">
                  <p className="text-xs text-[var(--ink3)]">COMEX gold · $ per oz</p>
                  <p className="text-2xl font-bold tabular-nums">{s.comex ? `$${s.comex.close.toLocaleString("en-US")}` : "—"}</p>
                  {s.comex && <p className={`text-[13px] font-semibold tabular-nums ${tone(s.comex.chg)}`}>{signed(s.comex.chg)}% <span className="font-normal text-[var(--ink3)]">· {istDay(`${s.comex.date}T12:00:00Z`)}</span></p>}
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-[var(--line)] grid grid-cols-3 gap-x-2 gap-y-3">
                <Stat label="World in ₹" value={s.parity ? `₹${s.parity.toLocaleString("en-IN")}` : "—"} />
                <Stat label={s.duty !== undefined ? `+ ${s.duty}% duty` : "With duty"} value={s.landed ? `₹${s.landed.toLocaleString("en-IN")}` : "—"} />
                <Stat label="MCX vs that" value={s.mcx_vs_landed !== undefined ? `${signed(s.mcx_vs_landed, 1)}%` : "—"} />
                <Stat label="MCX over world" value={s.mcx_prem !== undefined ? `${signed(s.mcx_prem, 1)}%` : "—"} />
                <Stat label="USD/INR" value={s.usdinr ? s.usdinr.close.toFixed(2) : "—"} />
                <Stat label="Gold/silver" value={s.gold_silver ? `${s.gold_silver}` : "—"} />
              </div>
              <div className="mt-3 flex gap-2">
                <Link href="/commodity?s=GOLD" className="rs-press min-h-[34px] px-3 rounded-lg inline-flex items-center text-[12px] font-semibold text-[var(--accent-ink)] bg-[var(--accent-soft)]">MCX expiries</Link>
                <Link href={`/chart?s=${encodeURIComponent("GOLD1!")}`}
                  onClick={() => { try { sessionStorage.setItem("rs_chart_from", "/gold"); } catch { /* private mode */ } }}
                  className="rs-press min-h-[34px] px-3 rounded-lg inline-flex items-center text-[12px] font-semibold text-[var(--accent-ink)] bg-[var(--accent-soft)]">Chart</Link>
                <InfoTip title="Prices">
                  <p>MCX: the nearest gold contract not in its last five days, closing price. COMEX: the front-month settlement, via Yahoo. World in ₹ is COMEX × USD/INR for 10 grams, on the same day as the MCX close.</p>
                  {s.duty !== undefined && <p>India charges {s.duty}% import duty on gold{s.duty_since ? ` since ${istDay(`${s.duty_since}T12:00:00Z`)} ${s.duty_since.slice(0, 4)}` : ""}{s.duty_why ? ` - ${s.duty_why.charAt(0).toLowerCase()}${s.duty_why.slice(1)}` : ""}. MCX prices carry it and COMEX does not, so it is most of the gap. What is left - MCX vs the world price with duty - is the local premium or discount plus a month or two of carry. GST is not in either price.</p>}
                  <p>Gold/silver: grams of silver one gram of gold buys at MCX prices. Prices are as published, not checked further.</p>
                </InfoTip>
              </div>
            </section>

            <div className="flex items-center border-b border-[var(--line)]" role="tablist">
              {([["calendar", "Calendar"], ["news", `News · ${doc.news.filter((n) => n.stars >= 3).length}`], ["ratings", "How it's rated"]] as [Tab, string][]).map(([k, label]) => (
                <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                  className={`px-3 pt-1 pb-2 -mb-px border-b-2 text-[14px] ${tab === k ? "border-[var(--accent)] text-[var(--accent-ink)] font-semibold" : "border-transparent text-[var(--ink2)]"}`}>
                  {label}
                </button>
              ))}
            </div>

            {tab === "calendar" && (
              <>
                <div className="flex items-center gap-2">
                  <Chips value={when} options={[["next", "Coming up"], ["past", "Past 45 days"]] as ["next" | "past", string][]} onChange={setWhen} />
                  <Chips value={minEv} options={[["3", "3+"], ["1", "All"]] as ["3" | "1", string][]} onChange={setMinEv} />
                  <InfoTip title="Calendar">
                    <p>This week&apos;s releases, with forecasts, from Forex Factory&apos;s public calendar. Further ahead, from the publishers&apos; own schedules: Fed decisions (federalreserve.gov), GDP and PCE (BEA), retail sales (Census Bureau), ECB and Bank of Japan meetings, and MCX gold expiries. When the week&apos;s calendar lists a release, its copy is the one shown.</p>
                    {doc.events.some((e) => e.src.startsWith("FRED"))
                      ? <p>CPI, the jobs report, PPI, JOLTS and jobless claims: dates from FRED (St. Louis Fed), and each actual figure as first published.</p>
                      : <p>CPI, the jobs report and PPI appear in the week they come out: their publisher, BLS, refuses programs.</p>}
                    <p>Times are IST. Minor data rated one star is left out. Tap an event for why it matters and, once it has happened, how gold moved.</p>
                  </InfoTip>
                </div>
                {days.length === 0 && <p className="py-10 text-center text-[13px] text-[var(--ink3)]">{minEv === "3" ? "Nothing rated three stars or more" : "Nothing"} {when === "next" ? "ahead" : "in the past 45 days"}</p>}
                {days.map(([d, list]) => (
                  <section key={d} className="rounded-xl border border-[var(--line)] bg-[var(--card)] overflow-hidden">
                    <h3 className="px-3 py-2 text-[13px] font-semibold border-b border-[var(--line)]">{istDay(list[0].t)}</h3>
                    <ul className="divide-y divide-[var(--line)]">
                      {list.map((e) => (
                        <li key={`${e.t}${e.title}`}>
                          <button type="button" onClick={() => setEv(e)} className="w-full flex items-start gap-3 px-3 py-2.5 text-left active:bg-[var(--card2)]">
                            <span className="w-11 shrink-0 text-[12px] tabular-nums text-[var(--ink3)] pt-0.5">{e.src.includes("approximate") ? "~" : ""}{istTime(e.t)}</span>
                            <span className="flex-1 min-w-0">
                              <span className="flex items-center gap-1.5">
                                <span className="text-[10px] font-semibold rounded px-1 py-0.5 bg-[var(--card2)] text-[var(--ink3)]">{COUNTRY[e.c] ?? e.c}</span>
                                <span className="text-[14px] font-medium truncate">{e.title}</span>
                              </span>
                              <span className="block text-[11px] text-[var(--ink3)] tabular-nums truncate">
                                {[e.actual && `Actual ${e.actual}`, e.forecast && `Forecast ${e.forecast}`, e.previous && `Previous ${e.previous}`].filter(Boolean).join(" · ")
                                  || subtitle(e, doc.families[e.fam]?.label)}
                              </span>
                              {(e.comex || e.mcx) && (
                                <span className="block text-[11px] tabular-nums">
                                  <span className="text-[var(--ink3)]">Gold after: </span>
                                  {e.comex && <span className={tone(e.comex[1])}>COMEX {signed(e.comex[1])}%</span>}
                                  {e.comex && e.mcx && <span className="text-[var(--ink3)]"> · </span>}
                                  {e.mcx && <span className={tone(e.mcx[1])}>MCX {signed(e.mcx[1])}%</span>}
                                </span>
                              )}
                            </span>
                            <Stars n={e.stars} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </>
            )}

            {tab === "news" && (
              <>
                <div className="flex items-center gap-2">
                  <Chips value={minNews} options={[["3", "Three stars and up"], ["2", "All"]] as ["3" | "2", string][]} onChange={setMinNews} />
                  <InfoTip title="News">
                    <p>Gold headlines from the last week, from the GDELT news index and the commodity feeds of Economic Times, Business Standard, BusinessLine and FXStreet, refreshed each night. Each is rated by the first rule its headline matches - central-bank buying, India&apos;s import duty and Fed decisions highest; city price lists, miners&apos; press releases and single mining shares are left out.</p>
                    <p>The rating reads the headline only, not the article. Tap one for the rule it matched.</p>
                  </InfoTip>
                </div>
                <ul className="rounded-xl border border-[var(--line)] bg-[var(--card)] divide-y divide-[var(--line)] overflow-hidden">
                  {news.length === 0 && <li className="py-10 text-center text-[13px] text-[var(--ink3)]">No headlines this week</li>}
                  {news.map((n) => (
                    <li key={n.url}>
                      <button type="button" onClick={() => setItem(n)} className="w-full flex items-start gap-3 px-3 py-2.5 text-left active:bg-[var(--card2)]">
                        <span className="flex-1 min-w-0">
                          <span className="block text-[14px] leading-snug">{n.title}</span>
                          <span className="block text-[11px] text-[var(--ink3)] mt-0.5">{n.src} · {ago(n.t, now)}</span>
                        </span>
                        <Stars n={n.stars} />
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {tab === "ratings" && (
              <Card title="Stars by kind of event" tip={
                <InfoTip title="How it's rated">
                  <p>Every kind of event starts with stars set by rule, from how it reaches gold: through US interest rates and the dollar, through India&apos;s duty and the rupee, or through demand.</p>
                  <p>Once {doc.min_measured} past events of a kind have gold prices around them, the stars are measured instead: the median move in gold the session after those events, divided by the median move on any day over the same years. Twice an ordinary day or more is five stars; 1.6x four; 1.3x three; 1.1x two.</p>
                  <p>COMEX settles at 1:30pm New York time, before the Fed&apos;s 2pm decision, so an event after the settlement is measured on the next session.</p>
                </InfoTip>
              }>
                <ul className="divide-y divide-[var(--line)]">
                  {fams.map(([k, f]) => (
                    <li key={k} className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <span className="flex-1 text-[14px] font-semibold">{f.label}</span>
                        <Stars n={f.stars} />
                      </div>
                      <p className="text-[12px] text-[var(--ink2)] mt-1 leading-relaxed">{f.why}</p>
                      <p className={`text-[11px] mt-1 ${f.ratio !== undefined ? "text-[var(--accent-ink)]" : "text-[var(--ink3)]"}`}>{basis(f, doc.min_measured)}</p>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </>
        )}
      </main>

      {ev && doc && evFam && (
        <InfoDialog title={ev.title} onClose={() => setEv(null)}>
          <div className="flex items-center gap-2">
            <Stars n={ev.stars} size={16} />
            <span className="text-[12px] text-[var(--ink3)]">{evFam.label} · {COUNTRY[ev.c] ?? ev.c}</span>
          </div>
          <p className="text-[12px] text-[var(--ink3)]">{istDay(ev.t)}, {istTime(ev.t)} IST</p>
          {(ev.actual || ev.forecast || ev.previous) && (
            <div className="grid grid-cols-3 gap-3 py-1">
              {ev.actual && <Stat label="Actual" value={ev.actual} />}
              {ev.forecast && <Stat label="Forecast" value={ev.forecast} />}
              {ev.previous && <Stat label="Previous" value={ev.previous} />}
            </div>
          )}
          {(ev.comex || ev.mcx) && (
            <div className="grid grid-cols-2 gap-3 py-1">
              {ev.comex && <Stat label={`COMEX, ${istDay(`${ev.comex[0]}T12:00:00Z`)}`} value={`${signed(ev.comex[1])}%`} className={tone(ev.comex[1])} />}
              {ev.mcx && <Stat label={`MCX, ${istDay(`${ev.mcx[0]}T12:00:00Z`)}`} value={`${signed(ev.mcx[1])}%`} className={tone(ev.mcx[1])} />}
            </div>
          )}
          <p><b>Why it matters for gold.</b> {evFam.why}</p>
          <p className="text-[12px]">{basis(evFam, doc.min_measured)}</p>
          <p className="text-[11px] text-[var(--ink3)]">Source: {ev.src}. A day&apos;s move has many causes; this event is one of them.</p>
        </InfoDialog>
      )}

      {item && (
        <InfoDialog title="Headline" onClose={() => setItem(null)}>
          <p className="text-[14px] text-[var(--ink)] leading-snug">{item.title}</p>
          <div className="flex items-center gap-2"><Stars n={item.stars} size={16} /><span className="text-[12px] text-[var(--ink3)]">{item.src} · {ago(item.t, now)}</span></div>
          <p><b>Why this rating.</b> {item.why}.</p>
          <p className="text-[11px] text-[var(--ink3)]">Rated by a rule that reads the headline, not the article.</p>
          <a href={item.url} target="_blank" rel="noopener noreferrer"
            className="rs-press inline-flex items-center justify-center gap-2 w-full min-h-[44px] rounded-xl bg-[var(--accent-fill)] text-[var(--accent-fill-ink)] text-[14px] font-semibold">
            Read at {item.src} <ExternalGlyph size={13} />
          </a>
        </InfoDialog>
      )}
    </div>
  );
}
