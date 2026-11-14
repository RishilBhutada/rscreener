"use client";

/** "What's new" - shown once after the app has been updated, listing every
 *  update since this device last saw one (owner, 14-Nov-2026). On a device's
 *  very first visit nothing is shown: everything is new, so nothing is. */

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Update, loadUpdates, markSeen, seenUpdate, updateWhen } from "@/lib/updates";

const SHOW = 8;

export default function WhatsNew() {
  const path = usePathname();
  const [news, setNews] = useState<{ latest: number; list: Update[] } | null>(null);

  useEffect(() => {
    let live = true;
    loadUpdates().then((u) => {
      if (!live || !u || !u.latest) return;
      const seen = seenUpdate();
      if (seen === null) { markSeen(u.latest); return; }       // first visit on this device
      if (u.latest <= seen) return;
      setNews({ latest: u.latest, list: u.updates.filter((x) => x.n > seen) });
    });
    return () => { live = false; };
  }, []);

  if (!news || path?.startsWith("/settings")) return null;
  const close = () => { markSeen(news.latest); setNews(null); };
  const more = news.list.length - SHOW;

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label="What's new">
      <div className="absolute inset-0 bg-black/50" onClick={close} aria-hidden="true" />
      <div className="rs-fade relative w-full sm:max-w-md max-h-[80vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-[var(--card)] border border-[var(--line)] p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <h2 className="text-lg font-bold text-[var(--ink)]">What&apos;s new</h2>
        <p className="text-[12.5px] text-[var(--ink3)] mt-0.5">
          {news.list.length === 1 ? "1 update" : `${news.list.length} updates`} since you last opened the app
        </p>
        <ul className="mt-3 space-y-2.5">
          {news.list.slice(0, SHOW).map((u) => (
            <li key={u.n} className="rounded-xl bg-[var(--card2)] px-3 py-2">
              <p className="text-[11px] text-[var(--ink3)] tabular-nums">Update {u.n} · {updateWhen(u.at)}</p>
              <p className="text-[13.5px] text-[var(--ink)] leading-snug mt-0.5">{u.text}</p>
            </li>
          ))}
        </ul>
        {more > 0 && <p className="text-[12px] text-[var(--ink3)] mt-2">and {more} more in Settings</p>}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Link href="/settings?p=updates" onClick={close}
            className="rs-press min-h-[44px] rounded-xl border border-[var(--line)] text-[14px] font-medium text-[var(--ink2)] flex items-center justify-center">
            All updates
          </Link>
          <button type="button" onClick={close}
            className="rs-press min-h-[44px] rounded-xl bg-[var(--accent)] text-white text-[14px] font-semibold">Got it</button>
        </div>
      </div>
    </div>
  );
}
