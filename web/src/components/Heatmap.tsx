"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { heatColor, squarify } from "@/lib/treemap";
import { signed } from "@/lib/commodity";

/** Heatmaps: a grid of equal tiles, a treemap sized by market cap, and the
 *  scale under them. One colour rule for all three (lib/treemap.ts), so a
 *  shade means the same move on the indices list, an index's page and the
 *  World page. Green and red are the price moving - nothing here calls a
 *  figure good or bad. */

export type HeatTile = {
  key: string;
  label: string;
  /** A second, quieter line: a country. */
  sub?: string;
  /** Beside the figure, small: a level. */
  right?: string;
  /** Under everything, small: a date, when it is not the one in the heading. */
  note?: string;
  v: number | null | undefined;
  href?: string;
};

/** Equal tiles, as many across as fit. Tiles with a page are links. */
export function HeatTiles({ tiles, full, digits = 2, unit = "%", min = 104 }: {
  tiles: HeatTile[];
  /** The move at which a tile is fully coloured. */
  full: number;
  digits?: number;
  unit?: string;
  /** Narrowest a tile may be, in px. */
  min?: number;
}) {
  return (
    <ul className="grid gap-1" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))` }}>
      {tiles.map((t) => {
        const cls = "block h-full min-h-[54px] rounded-lg px-2 py-1.5 text-[var(--ink)]";
        const style = { background: heatColor(t.v, full) };
        const body = (
          <>
            <span className="block text-[12px] font-semibold leading-tight line-clamp-2">{t.label}</span>
            {t.sub && <span className="block text-[10.5px] leading-tight opacity-70 truncate">{t.sub}</span>}
            <span className="mt-0.5 flex items-baseline justify-between gap-1 tabular-nums">
              <span className={`text-[13px] font-bold ${typeof t.v === "number" ? "" : "opacity-50"}`}>{signed(t.v, digits, unit)}</span>
              {t.right && <span className="text-[10.5px] opacity-70 truncate">{t.right}</span>}
            </span>
            {t.note && <span className="block text-[10px] leading-tight opacity-70">{t.note}</span>}
          </>
        );
        return (
          <li key={t.key}>
            {t.href
              ? <Link href={t.href} className={`rs-press ${cls}`} style={style}>{body}</Link>
              : <div className={cls} style={style}>{body}</div>}
          </li>
        );
      })}
    </ul>
  );
}

/** The scale: seven shades from a full fall to a full rise. */
export function HeatLegend({ full, unit = "%" }: { full: number; unit?: string }) {
  const steps = [-1, -2 / 3, -1 / 3, 0, 1 / 3, 2 / 3, 1];
  return (
    <p className="flex items-center gap-1.5 text-[10.5px] text-[var(--ink3)] tabular-nums" aria-label={`Colour scale: full red at minus ${full}${unit}, full green at plus ${full}${unit}`}>
      <span>-{full}{unit}</span>
      <span className="flex gap-px" aria-hidden="true">
        {steps.map((s) => <span key={s} className="w-4 h-2.5 first:rounded-l last:rounded-r" style={{ background: heatColor(s * full, full) }} />)}
      </span>
      <span>+{full}{unit}</span>
    </p>
  );
}

export type TreeItem = {
  key: string;
  /** On the tile: a symbol. */
  label: string;
  /** In the readout: the full name. */
  name?: string;
  /** Tiles are gathered into blocks by this: an industry. */
  group: string;
  size: number | null | undefined;
  v: number | null | undefined;
  href: string;
};

type Tile = { item: TreeItem; x: number; y: number; w: number; h: number };
type Block = { name: string; x: number; y: number; w: number; h: number; head: number };

/** A treemap in two levels: blocks by group, tiles inside each, both sized by
 *  `size`. Most tiles of a large index are too small for a finger or a name,
 *  so a tap selects one and its name, figure and link appear underneath;
 *  the tiles are left out of the tab order, since the members list under the
 *  map carries the same companies as ordinary links. */
export function HeatTreemap({ items, full, height, digits = 2, label }: {
  items: TreeItem[];
  full: number;
  height: number;
  digits?: number;
  /** What the map shows, for a screen reader. */
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((es) => setWidth(Math.round(es[0].contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { tiles, blocks } = useMemo(() => {
    const tiles: Tile[] = [], blocks: Block[] = [];
    if (!width) return { tiles, blocks };
    const by = new Map<string, TreeItem[]>();
    for (const it of items) {
      if (!(typeof it.size === "number" && it.size > 0)) continue;
      const xs = by.get(it.group);
      if (xs) xs.push(it); else by.set(it.group, [it]);
    }
    const groups = Array.from(by, ([name, xs]) => ({ name, xs, size: xs.reduce((s, x) => s + (x.size as number), 0) }));
    const one = groups.length === 1;
    for (const g of squarify(groups, (x) => x.size, { x: 0, y: 0, w: width, h: height })) {
      // A block's name sits in a strip above its tiles, where there is room.
      const head = !one && g.w >= 56 && g.h >= 40 ? 13 : 0;
      blocks.push({ name: g.item.name, x: g.x, y: g.y, w: g.w, h: g.h, head });
      tiles.push(...squarify(g.item.xs, (x) => x.size, { x: g.x + 1, y: g.y + head + 1, w: g.w - 2, h: g.h - head - 2 }));
    }
    return { tiles, blocks };
  }, [items, width, height]);

  const sel = tiles.find((t) => t.item.key === picked)?.item ?? null;

  return (
    <div>
      <div ref={ref} role="group" aria-label={label} className="relative w-full overflow-hidden rounded-lg bg-[var(--card)]" style={{ height }}>
        {blocks.map((b) => b.head > 0 && (
          <span key={b.name} aria-hidden="true" className="absolute px-1 text-[9.5px] leading-[13px] font-semibold uppercase tracking-wide text-[var(--ink3)] truncate"
            style={{ left: b.x, top: b.y, width: b.w, height: b.head }}>{b.name}</span>
        ))}
        {tiles.map((t) => {
          const name = t.w >= 38 && t.h >= 18;
          const fig = t.w >= 38 && t.h >= 32;
          const big = t.w >= 92 && t.h >= 54;
          const on = t.item.key === picked;
          return (
            <button key={t.item.key} type="button" tabIndex={-1} onClick={() => setPicked(on ? null : t.item.key)}
              aria-pressed={on} aria-label={`${t.item.label} ${signed(t.item.v, digits)}`} title={`${t.item.name ?? t.item.label} ${signed(t.item.v, digits)}`}
              className="absolute overflow-hidden text-[var(--ink)] flex flex-col items-center justify-center leading-tight"
              style={{
                left: t.x, top: t.y, width: t.w, height: t.h, background: heatColor(t.item.v, full),
                boxShadow: on ? "inset 0 0 0 2px var(--ink)" : "inset 0 0 0 0.5px var(--card)",
              }}>
              {name && <span className={`max-w-full px-0.5 truncate font-semibold ${big ? "text-[13px]" : "text-[10px]"}`}>{t.item.label}</span>}
              {fig && <span className={`tabular-nums ${big ? "text-[12px]" : "text-[9.5px]"}`}>{signed(t.item.v, digits)}</span>}
            </button>
          );
        })}
      </div>
      <p className="mt-2 min-h-[20px] text-[12.5px] flex items-baseline gap-1.5 flex-wrap" aria-live="polite">
        {sel ? (
          <>
            <span className="font-semibold">{sel.label}</span>
            {sel.name && <span className="text-[var(--ink2)] truncate max-w-[45%]">{sel.name}</span>}
            <span className="text-[var(--ink3)]">{sel.group}</span>
            <span className={`tabular-nums font-semibold ${typeof sel.v !== "number" || sel.v === 0 ? "text-[var(--ink3)]" : sel.v > 0 ? "text-[var(--pos)]" : "text-[var(--neg)]"}`}>{signed(sel.v, digits)}</span>
            <Link href={sel.href} className="ml-auto font-semibold text-[var(--accent-ink)]">Open</Link>
          </>
        ) : <span className="text-[var(--ink3)]">Tap a tile for its name and figure</span>}
      </p>
    </div>
  );
}
