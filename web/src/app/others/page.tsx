"use client";

import { FormEvent, ReactNode, useEffect, useState } from "react";
import TopNav from "@/components/TopNav";
import InfoTip, { InfoDialog } from "@/components/InfoTip";
import { PageTitle } from "@/components/ListUI";

/** Other people's sites, grouped by what you would go to them for, as small
 *  tiles with each site's own logo (Step 5, owner 31-Oct-2026). You can add a
 *  site to any group, or a section of your own; those are kept in
 *  `rs_others_custom` and follow you when signed in.
 *
 *  Everything here is a link out. None of it can be held to the standard the
 *  rest of the app is - grey-market premiums have no filing behind them, and
 *  another site's portfolio tables are its own reading of the shareholding
 *  filings - so it is kept apart from the data this app produces and checks,
 *  and labelled as someone else's. */

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const KEY = "rs_others_custom";

/** `logo` is a file in public/sites, fetched once from the site's icon. */
type Site = { name: string; url: string; what?: string; logo?: string };
type Section = { id: string; title: string; tip?: ReactNode; tipTitle?: string; sites: Site[] };
type Custom = { sections: { id: string; title: string; sites: Site[] }[]; extra: Record<string, Site[]> };

const GROUPS: Section[] = [
  {
    id: "news", title: "News",
    sites: [
      { name: "Moneycontrol", logo: "moneycontrol", url: "https://www.moneycontrol.com/news/business/markets/", what: "Market news, results and company updates" },
      { name: "Sovrenn", logo: "sovrenn", url: "https://www.sovrenn.com/", what: "Small and micro-cap company news, digested" },
      { name: "Investing.com", logo: "investing", url: "https://in.investing.com/news/stock-market-news", what: "Indian and global markets news" },
    ],
  },
  {
    id: "stocks", title: "Stocks",
    sites: [
      { name: "Tickertape", logo: "tickertape", url: "https://www.tickertape.in/", what: "Stock pages, screener and scorecards" },
      { name: "Screener", logo: "screener", url: "https://www.screener.in/", what: "Company financials and screens" },
    ],
  },
  {
    id: "funds", title: "Mutual funds",
    sites: [
      { name: "Smallcase", logo: "smallcase", url: "https://www.smallcase.com/", what: "Model portfolios and funds by theme" },
    ],
  },
  {
    id: "ipo", title: "IPO",
    tip: (
      <p>
        Rscreener does not track IPOs. Grey-market premium is an unofficial number quoted by
        dealers &mdash; there is no filing to check it against. Once a company lists, it appears
        in Rscreener like any other.
      </p>
    ),
    sites: [
      { name: "InvestorGain", logo: "investorgain", url: "https://www.investorgain.com/report/live-ipo-gmp/331/", what: "Live GMP, subscription and allotment" },
      { name: "IPO Premium", logo: "ipopremium", url: "https://ipopremium.in/", what: "Open, upcoming and closed issues" },
    ],
  },
  {
    id: "data", title: "Important data",
    sites: [
      { name: "Forex Factory", logo: "forexfactory", url: "https://www.forexfactory.com/calendar", what: "Global economic calendar" },
    ],
  },
  {
    id: "investors", title: "Celebrity investors",
    tip: (
      <p>
        What well-known investors hold, as these sites read it from the shareholding filings.
        Their tables, not Rscreener&rsquo;s &mdash; check against the filing before relying on one.
      </p>
    ),
    sites: [
      { name: "Trendlyne", logo: "trendlyne", url: "https://trendlyne.com/portfolio/superstar-shareholders/index/", what: "Superstar shareholders" },
      { name: "Finology Ticker", logo: "finology", url: "https://ticker.finology.in/investor", what: "Investor portfolios" },
    ],
  },
  {
    id: "others", title: "Others",
    tipTitle: "Research 360",
    tip: (
      <p>
        Research 360 is Motilal Oswal&rsquo;s research platform. Its stock ideas are a broker&rsquo;s
        paid advice, not Rscreener&rsquo;s &mdash; check the adviser&rsquo;s SEBI registration before acting on one.
      </p>
    ),
    sites: [
      { name: "Research 360", logo: "research360", url: "https://www.research360.in/", what: "Motilal Oswal's research, scans and screeners" },
    ],
  },
];

function readCustom(): Custom {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (v && Array.isArray(v.sections) && v.extra && typeof v.extra === "object") return v as Custom;
  } catch { /* none yet */ }
  return { sections: [], extra: {} };
}

/** "https://www.example.com/x" from what was typed ("example.com/x" works too). */
function cleanUrl(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`);
    return u.hostname.includes(".") ? u.toString() : null;
  } catch { return null; }
}

/** A site's tile: its logo (the stored file, else the site's own icon, else
 *  its initials) above its name. Opens the site in a new tab. */
function Tile({ s, onRemove }: { s: Site; onRemove?: () => void }) {
  const [broken, setBroken] = useState(false);
  const host = (() => { try { return new URL(s.url).hostname; } catch { return ""; } })();
  const src = s.logo ? `${BASE}/sites/${s.logo}.png` : host ? `https://${host}/favicon.ico` : "";
  const initials = s.name.replace(/[^A-Za-z0-9 ]/g, " ").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return (
    <div className="relative">
      <a href={s.url} target="_blank" rel="noopener noreferrer" title={s.what ? `${s.name} - ${s.what}` : s.name}
        className="rs-press flex flex-col items-center gap-1 rounded-xl border border-[var(--line)] bg-[var(--card)] px-1 pt-2.5 pb-2 active:bg-[var(--card2)]">
        {/* The initials sit underneath; the logo covers them once it loads, so a
            slow or missing icon still leaves a mark rather than a gap. */}
        <span className="relative w-7 h-7 rounded-md bg-[var(--card2)] flex items-center justify-center text-[11px] font-bold text-[var(--ink2)]">
          {initials}
          {src && !broken && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt="" width={28} height={28} onError={() => setBroken(true)}
              className="absolute inset-0 w-7 h-7 rounded-md object-contain bg-[var(--card)]" />
          )}
        </span>
        <span className="w-full truncate text-center text-[11px] text-[var(--ink2)]">{s.name}</span>
      </a>
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={`Remove ${s.name}`}
          className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[var(--neg)] text-white text-[12px] leading-5">×</button>
      )}
    </div>
  );
}

export default function OthersPage() {
  const [custom, setCustom] = useState<Custom>({ sections: [], extra: {} });
  const [editing, setEditing] = useState(false);
  // What the add sheet is adding: a site to a section, or a new section.
  const [adding, setAdding] = useState<{ kind: "site"; section: string } | { kind: "section" } | null>(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    const read = () => setCustom(readCustom());
    read();
    const other = (e: StorageEvent) => { if (e.key === KEY) read(); };
    window.addEventListener("storage", other);
    return () => window.removeEventListener("storage", other);
  }, []);

  const save = (next: Custom) => {
    setCustom(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* kept for this visit */ }
  };

  const open = (a: { kind: "site"; section: string } | { kind: "section" }) => { setAdding(a); setName(""); setUrl(""); setErr(""); };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!adding) return;
    const n = name.trim();
    if (adding.kind === "section") {
      if (!n) { setErr("Give the section a name"); return; }
      const id = `c${Date.now().toString(36)}`;
      save({ ...custom, sections: [...custom.sections, { id, title: n, sites: [] }] });
      setAdding(null);
      return;
    }
    const u = cleanUrl(url);
    if (!u) { setErr("That doesn't look like a web address"); return; }
    const site: Site = { name: n || new URL(u).hostname.replace(/^www\./, ""), url: u };
    const own = custom.sections.find((x) => x.id === adding.section);
    save(own
      ? { ...custom, sections: custom.sections.map((x) => (x.id === own.id ? { ...x, sites: [...x.sites, site] } : x)) }
      : { ...custom, extra: { ...custom.extra, [adding.section]: [...(custom.extra[adding.section] ?? []), site] } });
    setAdding(null);
  };

  const sections: (Section & { own?: boolean })[] = [
    ...GROUPS.map((g) => ({ ...g, sites: [...g.sites, ...(custom.extra[g.id] ?? [])] })),
    ...custom.sections.map((s) => ({ ...s, own: true })),
  ];
  const builtIn = (sec: string, i: number) => i < (GROUPS.find((g) => g.id === sec)?.sites.length ?? 0);

  const removeSite = (sec: Section & { own?: boolean }, i: number) => {
    if (sec.own) {
      save({ ...custom, sections: custom.sections.map((x) => (x.id === sec.id ? { ...x, sites: x.sites.filter((_, j) => j !== i) } : x)) });
    } else {
      const base = GROUPS.find((g) => g.id === sec.id)?.sites.length ?? 0;
      save({ ...custom, extra: { ...custom.extra, [sec.id]: (custom.extra[sec.id] ?? []).filter((_, j) => j !== i - base) } });
    }
  };
  const anyCustom = custom.sections.length > 0 || Object.values(custom.extra).some((x) => x.length);

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <TopNav active="others" />
      <main className="max-w-xl mx-auto px-4 pt-6 sm:pt-10 pb-12">
        <div className="flex items-center">
          <PageTitle>
            Others
            <InfoTip title="Others" className="ml-2">
              <p>Links to other websites. Each opens in a new tab.</p>
              <p>None is affiliated with Rscreener, and their numbers are theirs &mdash; not checked by this app.</p>
              <p>Sites and sections you add are kept on this device, and in your account when signed in.</p>
            </InfoTip>
          </PageTitle>
          {anyCustom && (
            <button type="button" onClick={() => setEditing(!editing)} aria-pressed={editing}
              className="ml-auto text-[13px] font-semibold text-[var(--accent-ink)]">{editing ? "Done" : "Edit"}</button>
          )}
        </div>

        {sections.map((sec) => (
          <section key={sec.id} className="mt-5">
            <div className="flex items-center gap-1.5 mb-2 px-0.5">
              <h2 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ink3)]">{sec.title}</h2>
              {sec.tip && <InfoTip title={sec.tipTitle ?? sec.title}>{sec.tip}</InfoTip>}
              {editing && sec.own && (
                <button type="button" onClick={() => save({ ...custom, sections: custom.sections.filter((x) => x.id !== sec.id) })}
                  className="text-[12px] font-semibold text-[var(--neg)]">Remove section</button>
              )}
              <button type="button" onClick={() => open({ kind: "site", section: sec.id })}
                className="ml-auto text-[12px] font-semibold text-[var(--accent-ink)]">+ Site</button>
            </div>
            {sec.sites.length > 0 ? (
              <div className="grid grid-cols-4 gap-2">
                {sec.sites.map((s, i) => (
                  <Tile key={`${s.url}-${i}`} s={s}
                    onRemove={editing && (sec.own || !builtIn(sec.id, i)) ? () => removeSite(sec, i) : undefined} />
                ))}
              </div>
            ) : (
              <p className="text-[12px] text-[var(--ink3)] px-0.5">No sites yet</p>
            )}
          </section>
        ))}

        <button type="button" onClick={() => open({ kind: "section" })}
          className="rs-press mt-6 w-full min-h-[44px] rounded-xl border border-dashed border-[var(--line2)] text-[13.5px] font-semibold text-[var(--accent-ink)]">
          + Add section
        </button>
      </main>

      {adding && (
        <InfoDialog title={adding.kind === "section" ? "New section" : `Add a site to ${sections.find((x) => x.id === adding.section)?.title ?? ""}`}
          onClose={() => setAdding(null)}>
          <form onSubmit={submit} className="space-y-3">
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} aria-label="Name"
              placeholder={adding.kind === "section" ? "Section name" : "Name (optional)"}
              className="w-full h-11 px-3 rounded-lg border border-[var(--line)] bg-[var(--card2)] text-[14px] text-[var(--ink)] outline-none focus:border-[var(--accent-line)]" />
            {adding.kind === "site" && (
              <input value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Web address" inputMode="url" autoCapitalize="none"
                placeholder="Web address, e.g. nseindia.com"
                className="w-full h-11 px-3 rounded-lg border border-[var(--line)] bg-[var(--card2)] text-[14px] text-[var(--ink)] outline-none focus:border-[var(--accent-line)]" />
            )}
            {err && <p className="text-[12px] text-[var(--neg)]">{err}</p>}
            <button type="submit"
              className="rs-press w-full min-h-[44px] rounded-xl bg-[var(--accent-fill)] text-[var(--accent-fill-ink)] text-[14px] font-semibold">
              {adding.kind === "section" ? "Add section" : "Add site"}
            </button>
          </form>
        </InfoDialog>
      )}
    </div>
  );
}
