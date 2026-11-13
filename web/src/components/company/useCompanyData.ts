/** Everything the company page downloads for one symbol: the company file, its
 *  name for the "Opening ..." pill, the screener row, peers and industry
 *  context, and the next results meeting. Only the file asked for LAST may land. */

import { useEffect, useState } from "react";
import { loadIndex as loadSearchIndex } from "@/lib/index-data";
import { Row } from "@/lib/query";
import { isRefreshLoad } from "@/components/TopNav";
import { ScreenData, Company, NextResults, Cohort } from "@/components/company/types";
import { BASE } from "@/components/company/format";

export function useCompanyData(symbol: string) {
  const [company, setCompany] = useState<Company | null>(null);
  // The symbol whose file is in `company`. While it differs from the one asked
  // for, the new file is on its way: the old page fades behind "Opening ...".
  const [shownSym, setShownSym] = useState("");
  const [openName, setOpenName] = useState<{ sym: string; name: string } | null>(null);
  const [peers, setPeers] = useState<Row[]>([]);
  const [cohort, setCohort] = useState<Cohort | null>(null);
  const [fullRow, setFullRow] = useState<Row | null>(null);
  const [error, setError] = useState("");

  // The next results meeting, from the calendar the Calendar page reads
  // (8 KB on the wire). Undefined while loading, null if NSE lists none.
  const [nextResults, setNextResults] = useState<NextResults>(undefined);
  useEffect(() => {
    if (!symbol) return;
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    fetch(`${BASE}/calendar.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((cal: { events?: { symbol: string; date: string; purpose: string; kind: string; type?: string }[] } | null) => {
        if (!cal?.events) return setNextResults(undefined);
        const hit = cal.events
          .filter((e) => e.symbol === symbol && e.kind === "meeting" && e.date >= today
            && (e.type === "results" || /result/i.test(e.purpose)))
          .sort((a, b) => a.date.localeCompare(b.date))[0];
        setNextResults(hit ? { date: hit.date, purpose: hit.purpose } : null);
      })
      .catch(() => setNextResults(undefined));
  }, [symbol]);

  useEffect(() => {
    if (!symbol) return;
    // Past the HTTP cache on the load a refresh produced - a fresh shell around
    // yesterday's company file is the staleness this button exists to end.
    // Two companies opened in quick succession: only the one asked for LAST may
    // land. Without this a slower first file could arrive second and replace it.
    let live = true;
    loadSearchIndex()
      .then((d) => { if (live) setOpenName({ sym: symbol, name: d.rows.find((r) => r.symbol === symbol)?.name || symbol }); })
      .catch(() => {});
    fetch(`${BASE}/companies/${symbol}.json`, isRefreshLoad() ? { cache: "reload" } : undefined)
      .then((r) => { if (!r.ok) throw new Error(`no data for ${symbol}`); return r.json(); })
      .then((d) => {
        if (!live) return;
        setError("");
        setCompany(d);
        setShownSym((prev) => {
          // Switched from one company to another: start the new one at its top.
          if (prev && prev !== symbol) window.scrollTo(0, 0);
          return symbol;
        });
      })
      .catch((e) => {
        if (!live) return;
        // An ETF's old company link - bookmarked, or shared before ETFs left the
        // company table on 27-Sep-2026. It has a page of its own now.
        const fail = () => setError(String(e.message ?? e));
        fetch(`${BASE}/etf/${encodeURIComponent(symbol)}.json`, { method: "HEAD" })
          .then((r) => (r.ok ? window.location.replace(`${BASE}/etf/?s=${encodeURIComponent(symbol)}`) : fail()))
          .catch(fail);
      });
    return () => { live = false; };
  }, [symbol]);

  useEffect(() => {
    if (!company) return;
    // The row, the peers and the industry context now travel INSIDE this
    // company's own file - about 3 KB of the 32 KB already downloaded. This
    // page used to fetch the whole 5.6 MB screener table and keep three things
    // from it: 99.4% of the transfer discarded, on the app's most-visited page.
    if (company.row || company.peers || company.context) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the row travels in the company file; the older-file fallback below sets the same state from a download
      setFullRow((company.row as Row) ?? null);
      setPeers((company.peers as Row[]) ?? []);
      const c = company.context;
      setCohort(c ? {
        rows: [],
        industry: c.industry ?? "",
        medians: c.medians ?? {},
        rank: c.rank ?? null,
        rankOf: c.rank_of ?? 0,
        indRank: c.ind_rank ?? null,
        indRankOf: c.ind_rank_of ?? 0,
      } : null);
      return;
    }
    // Older company files carry none of that. Rather than show a page with no
    // peers and no context, fall back to what this page used to do.
    // Guarded like the main fetch: a slow download for the company left behind
    // must not fill in the next one's row and peers (review company-page #5).
    let live = true;
    fetch(`${BASE}/data.json`)
      .then((r) => r.json())
      .then((d: ScreenData) => {
        if (!live) return;
        setFullRow(d.rows.find((r) => r.symbol === company.snapshot.symbol) ?? null);
        const ind = company.snapshot.industry;
        // No industry: no peers - not the last company's.
        if (!ind) { setPeers([]); setCohort(null); return; }
        const sameIndustry = d.rows.filter((r) => r.industry === ind);
        setPeers(
          sameIndustry
            .filter((r) => r.symbol !== company.snapshot.symbol)
            .sort((a, b) => ((b.mcap as number) ?? 0) - ((a.mcap as number) ?? 0))
            .slice(0, 8)
        );
        const withCap = d.rows.filter((r) => typeof r.mcap === "number");
        const byCap = [...withCap].sort((a, b) => (b.mcap as number) - (a.mcap as number));
        const rank = byCap.findIndex((r) => r.symbol === company.snapshot.symbol);
        const indByCap = byCap.filter((r) => r.industry === ind);
        const indRank = indByCap.findIndex((r) => r.symbol === company.snapshot.symbol);
        setCohort({
          rows: sameIndustry,
          industry: String(ind),
          medians: {},
          rank: rank >= 0 ? rank + 1 : null,
          rankOf: byCap.length,
          indRank: indRank >= 0 ? indRank + 1 : null,
          indRankOf: indByCap.length,
        });
      })
      .catch(() => { /* peers are optional */ });
    return () => { live = false; };
  }, [company]);

  return { company, shownSym, openName, peers, cohort, fullRow, error, nextResults };
}
