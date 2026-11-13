"use client";

/** The top of a company page: the strip to step through the list it was opened
 *  from, the name block, and the price line with its icons. */

import { prefetchCompany } from "@/lib/prefetch";
import { symbolHref } from "@/lib/index-data";
import Link from "next/link";
import { titleCase } from "@/lib/names";
import { Row } from "@/lib/query";
import WatchStar from "@/components/WatchStar";
import { IconButton, dayMove, signed as signedNum, tone } from "@/components/QuoteUI";
import { Company } from "@/components/company/types";
import { fmtNum, num } from "@/components/company/format";
import { IndexChips, PriceAsOf, CompanyMark, RefetchButton } from "@/components/company/Panels";

/** Opened from a watchlist or screen results: step to the previous or next
 *  company in it (M1). */
export function ListStrip({ around }: { around: { name: string; prev: string | null; next: string | null; at: number; of: number } }) {
  return (
    <nav aria-label={`Companies in ${around.name}`} className="flex items-center gap-2 text-[12.5px]">
      {around.prev ? (
        <Link href={symbolHref(around.prev)} onPointerEnter={() => { if (symbolHref(around.prev!).startsWith("/company")) prefetchCompany(around.prev); }}
          className="rs-press inline-flex items-center gap-1 rounded-full border border-[var(--line2)] px-3 py-1.5 text-[var(--ink2)]">&lsaquo; {around.prev}</Link>
      ) : <span />}
      <span className="flex-1 text-center text-[var(--ink3)] truncate">{around.at} of {around.of} in {around.name}</span>
      {around.next ? (
        <Link href={symbolHref(around.next)} onPointerEnter={() => { if (symbolHref(around.next!).startsWith("/company")) prefetchCompany(around.next); }}
          className="rs-press inline-flex items-center gap-1 rounded-full border border-[var(--line2)] px-3 py-1.5 text-[var(--ink2)]">{around.next} &rsaquo;</Link>
      ) : <span />}
    </nav>
  );
}

/** Name, then the ticker and where it sits on one quiet line; the export is
 *  an icon beside the star, not a button above the price. */
export function CompanyTitle({ symbol, company, fullRow }: { symbol: string; company: Company; fullRow: Row | null }) {
  const s = company.snapshot;
  const nseSector = (company.context?.nse_sector as string | undefined) ?? (fullRow?.["nse_sector"] as string | undefined);
  const nseBasic = (company.context?.nse_basic as string | undefined) ?? (fullRow?.["nse_basic"] as string | undefined);
  return (
    <div className="flex items-start gap-2">
      <CompanyMark name={String(s.name ?? symbol)} symbol={symbol} logo={company.logo} />
      <div className="flex-1 min-w-0">
        <h1 className="text-xl font-bold text-[var(--ink)] leading-tight line-clamp-2">{titleCase(String(s.name ?? "")) || symbol}</h1>
        <p className="text-[13px] text-[var(--ink3)] mt-0.5">
          <span className="font-semibold text-[var(--ink2)]">{symbol}</span>
          {company.exchange ? ` · ${company.exchange}` : ""}
          {company.fno && <span className="ml-1.5 align-middle text-[10px] font-bold rounded px-1.5 py-0.5 bg-[var(--accent-soft)] text-[var(--accent-ink)]" title="Trades in NSE's futures & options segment">F&amp;O</span>}
          <IndexChips list={company.indices} />
        </p>
        {/* Sector on a line of its own, one line high: it wrapped the header
            onto four lines when it shared the ticker's line. */}
        <p className="text-[12px] text-[var(--ink3)] mt-0.5 truncate">
          {/* NSE's own sector (and basic industry) where NSE's index files
              carry it; the source's sector and industry otherwise. */}
          {nseSector ? (
            <span title="NSE's classification">{nseSector}{nseBasic ? ` · ${nseBasic}` : ""}</span>
          ) : (
            <>
              {s.sector ? (
                <Link href={`/sectors?s=${encodeURIComponent(String(s.sector))}`} className="hover:text-[var(--accent-ink)] hover:underline">{String(s.sector)}</Link>
              ) : "—"}
              {s.industry ? ` · ${String(s.industry)}` : ""}
            </>
          )}
          {typeof s.website === "string" && /^https?:\/\//.test(s.website) && (
            <>
              {" · "}
              <a href={s.website} target="_blank" rel="noopener noreferrer" className="hover:text-[var(--accent-ink)] hover:underline">
                {s.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
              </a>
            </>
          )}
        </p>
      </div>
    </div>
  );
}

/** The price, the day's move and the icons; the icons alone when there is no price. */
export function PriceLine({ symbol, price, fullRow, s, onAlerts, onExport }: {
  symbol: string; price: number | null; fullRow: Row | null; s: Row; onAlerts: () => void; onExport: () => void;
}) {
  const off = num(fullRow, "off_52w_high");
  return (
    <>
      {/* No price: the icons still need a home. */}
      {price === null && (
        <div className="flex justify-end">
        <div className="flex items-center gap-1 shrink-0 self-center">
          <IconButton name="bell" label="Price alerts" onClick={onAlerts} />
          <IconButton name="download" label="Export to Excel" onClick={onExport} />
          <RefetchButton symbol={symbol} />
          <WatchStar symbol={symbol} />
        </div>
        </div>
      )}
      {price !== null && (() => {
        // The day's move first, as a broker shows it; the distance from the
        // year's high is the second line.
        const chg = num(fullRow, "ret_1d");
        return (
          <div>
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex flex-wrap items-baseline gap-x-2.5">
                <span className="text-3xl font-bold text-[var(--ink)] tabular-nums">₹ {fmtNum(price)}</span>
                {chg !== null && (
                  <span className={`text-[15px] font-semibold tabular-nums ${tone(chg)}`}>
                    {signedNum(dayMove(price, chg))} ({signedNum(chg)}%)
                  </span>
                )}
              </div>
            <div className="ml-auto flex items-center gap-1 shrink-0 self-center">
              <IconButton name="bell" label="Price alerts" onClick={onAlerts} />
              <IconButton name="download" label="Export to Excel" onClick={onExport} />
              <RefetchButton symbol={symbol} />
              <WatchStar symbol={symbol} />
            </div>
            </div>
            <p className="flex flex-wrap items-baseline gap-x-2 mt-0.5">
              {off !== null && (
                <span className={`text-xs font-medium ${off < 0 ? "text-[var(--neg)]" : "text-[var(--pos)]"}`}>
                  {off < 0 ? "" : "+"}{off.toFixed(1)}% from 52-week high ·
                </span>
              )}
              <PriceAsOf row={fullRow} snapshot={s} />
            </p>
          </div>
        );
      })()}
    </>
  );
}
