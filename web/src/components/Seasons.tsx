/** "Seasons": whether a company's sales, profit and share price follow the
 *  quarter of the year, and whether that is more than luck. The numbers come
 *  from pipeline/seasons_lib.py, which says how they are tested. */
import InfoTip from "@/components/InfoTip";
import { signed, tone } from "@/components/QuoteUI";

export const SEASON_QUARTERS = ["Apr–Jun", "Jul–Sep", "Oct–Dec", "Jan–Mar"];

/** Each quarter against an average quarter of the same year (1.25 = 25% above). */
export type BusinessSeason = { idx: number[]; peak: number; low: number; won: number; of: number; p: number; holds: boolean | null; ok: boolean };
/** Average return against the Nifty 50 per quarter (%), and in how many years it beat it. */
export type PriceSeason = { avg: number[]; beat: number[]; years: number[]; p: number; holds: boolean | null; ok: boolean };
export type Seasons = { sales?: BusinessSeason; profit?: BusinessSeason; price?: PriceSeason };

/** One sentence on a sales or profit season. */
function verdict(what: string, s: BusinessSeason): string {
  if (!s.ok) {
    return s.p >= 0.05
      ? `${what}: no reliable season - its quarters differ about as much as luck would make them.`
      : `${what}: a season in the early years that did not repeat in the later ones - not reliable.`;
  }
  const swing = s.idx[s.peak] / s.idx[s.low] - 1;
  const strength = swing >= 0.6 ? "Strong season" : swing >= 0.2 ? "Clear season" : "Mild season";
  // Two quarters near the top (Voltas: summer is Jan-Mar AND Apr-Jun) - both named.
  const second = s.idx.map((v, i) => [v, i]).filter(([, i]) => i !== s.peak).sort((a, b) => b[0] - a[0])[0];
  const peaks = second && s.idx[s.peak] - second[0] <= 0.1
    ? `${SEASON_QUARTERS[s.peak]} and ${SEASON_QUARTERS[second[1]]}`
    : SEASON_QUARTERS[s.peak];
  const won = s.of >= 3 && s.won * 2 >= s.of ? `, the biggest quarter in ${s.won} of ${s.of} years` : "";
  return `${what}: ${strength.toLowerCase()} - highest in ${peaks}${won}; lowest in ${SEASON_QUARTERS[s.low]}.`;
}

function priceVerdict(s: PriceSeason): string {
  if (!s.ok) return "Share price: no reliable pattern - what is shown could be luck.";
  const best = s.avg.indexOf(Math.max(...s.avg)), worst = s.avg.indexOf(Math.min(...s.avg));
  return `Share price: a pattern that held up in later years - best against the Nifty in ${SEASON_QUARTERS[best]} (beat it in ${s.beat[best]} of ${s.years[best]} years), weakest in ${SEASON_QUARTERS[worst]}.`;
}

function BusinessRow({ label, s }: { label: string; s: BusinessSeason }) {
  return (
    <>
      <span className="text-[13px] text-[var(--ink2)]">{label}</span>
      {s.idx.map((v, i) => {
        const mark = s.ok && i === s.peak ? "font-semibold text-[var(--accent-ink)]" : s.ok && i === s.low ? "text-[var(--ink3)]" : "";
        return <span key={i} className={`text-[13px] text-right tabular-nums ${s.ok ? mark : "text-[var(--ink3)]"}`}>{v.toFixed(2)}×</span>;
      })}
    </>
  );
}

export default function SeasonsCard({ seasons }: { seasons?: Seasons | null }) {
  if (!seasons || !(seasons.sales || seasons.profit || seasons.price)) return null;
  const { sales, profit, price } = seasons;
  return (
    <section className="bg-[var(--card)] rounded-xl border border-[var(--line)] p-4 space-y-3">
      <h3 className="text-[15px] font-semibold flex items-center gap-1.5">
        Seasons
        <InfoTip title="Seasons">
          <p>Whether the company&apos;s sales, profit and share price follow the quarter of the financial year (Apr–Jun is Q1, Jan–Mar is Q4).</p>
          <p>Sales and profit: each quarter against an average quarter of the same year - 1.25× means 25% above it. Worked out against the year around each quarter, so a growing company&apos;s later quarters are not mistaken for a season. A loss quarter leaves a gap.</p>
          <p>Share price: the average return in each quarter against the Nifty 50, and in how many years the stock beat it.</p>
          <p>Called a season only when it passes two tests against luck: the quarters must differ more than in 95% of 499 shuffles of the quarter labels (99% for the share price), and the pattern of the first half of the years must repeat in the second half.</p>
          <p>Across 1,612 companies, 54% of sales patterns pass the first test where luck would give 5%. Share-price patterns are far weaker: a stock&apos;s best quarter of its early years is its best of the later years a third of the time, against a quarter by luck. And much of a smaller stock&apos;s pattern is the whole market&apos;s - the typical stock trailed the Nifty in Jan–Mar in 22 of the last 26 years.</p>
          <p>What happened, not a forecast, and not a reason to buy or sell.</p>
        </InfoTip>
      </h3>
      <div className="grid grid-cols-[minmax(0,1fr)_repeat(4,auto)] gap-x-3 sm:gap-x-6 gap-y-1.5 items-baseline">
        <span />
        {SEASON_QUARTERS.map((q) => <span key={q} className="text-[11px] text-[var(--ink3)] text-right whitespace-nowrap">{q}</span>)}
        {sales && <BusinessRow label="Sales" s={sales} />}
        {profit && <BusinessRow label="Profit" s={profit} />}
        {price && (
          <>
            <span className="text-[13px] text-[var(--ink2)]">Share vs Nifty</span>
            {price.avg.map((v, i) => (
              <span key={i} className={`text-[13px] text-right tabular-nums ${price.ok ? tone(v) : "text-[var(--ink3)]"}`}>{signed(v, 1)}%</span>
            ))}
            <span className="text-[11px] text-[var(--ink3)]">Beat Nifty</span>
            {price.beat.map((b, i) => (
              <span key={i} className="text-[11px] text-right tabular-nums text-[var(--ink3)]">{b}/{price.years[i]}</span>
            ))}
          </>
        )}
      </div>
      <ul className="space-y-1 text-[12px] leading-snug text-[var(--ink2)]">
        {sales && <li>{verdict("Sales", sales)}</li>}
        {profit && <li>{verdict("Profit", profit)}</li>}
        {price && <li>{priceVerdict(price)}</li>}
      </ul>
    </section>
  );
}
