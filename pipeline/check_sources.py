"""Fails the build when a published figure did not come from the company's own filing.

Why this exists: Dixon Technologies showed Rs 171cr profit for Dec-2024 where the
filing says Rs 216cr. Nothing was stale and nothing was corrupt - we simply held
the same quantity from two sources and published the wrong one. Yahoo's
"Net Income" is profit attributable to owners, net of minority interest; the
filing reports total net profit. Both numbers are correct answers to different
questions, which is what makes this class so hard to spot by eye: neither figure
looks wrong on its own.

The owner found it on the one company he happened to check. Across the universe
the two sources sit more than 5% apart on 1,323 quarterly profit figures across
524 companies, and 445 annual profit figures across 306. Checking by hand does
not scale, so it is checked here instead - every company, every run.

The rule: where the NSE filings have been parsed for a company, that is what must
be published. Yahoo is a fallback for companies with nothing parsed, never a
substitute for a filing we already hold.

Usage:
  python check_sources.py            # verify every exported company file
  python check_sources.py --sample 200
"""
import argparse
import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "rscreener.db"
COMPANIES = ROOT / "web" / "public" / "companies"

TOLERANCE = 0.02      # 2% relative
ABS_TOLERANCE = 0.06  # ...OR half a display step. The table prints one decimal in
                      # crore, so a filed Rs 0.94cr shows as 0.9 - a 4% relative
                      # difference on a tiny number that is really just rounding.
                      # Relative-only flagged 4,791 such figures as wrong.
MAX_BAD = 0        # a published figure contradicting its own filing is never acceptable


def filed(con) -> dict:
    """{(symbol, period_type, period_end): {'pat':…, 'revenue':…}} in Rs crore."""
    out: dict = {}
    for sym, ptype, period, item, val in con.execute(
        "SELECT symbol, period_type, period_end, item, value FROM results_history "
        "WHERE item IN ('pat','revenue') AND value IS NOT NULL"
    ):
        out.setdefault((sym, ptype, period), {})[item] = val / 1e7
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sample", type=int, default=0, help="check only the first N files (dev shortcut)")
    args = ap.parse_args()

    con = sqlite3.connect(DB, timeout=180)
    # per PERIOD TYPE, not per symbol: Gradiente has quarterly filings but no
    # annual ones, so Yahoo is the correct source for its annual table and
    # flagging it was the guard being wrong, not the data
    have_filings = {(r[0], r[1]) for r in
                    con.execute("SELECT DISTINCT symbol, period_type FROM results_history")}
    book = filed(con)
    con.close()

    files = sorted(COMPANIES.glob("*.json"))
    if args.sample:
        files = files[:args.sample]

    wrong_source: list[str] = []
    wrong_value: list[str] = []
    checked = 0

    for f in files:
        sym = f.stem
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            continue
        sources = d.get("sources") or {}
        for key, ptype in (("quarterly_results", "quarterly"), ("annual_pnl", "annual")):
            table = (d.get("statements") or {}).get(key)
            if not table:
                continue
            # 1. did it come from the filing, where we have one?
            if (sym, ptype) in have_filings and sources.get(key) != "as-filed (NSE)":
                wrong_source.append(f"{sym}.{key}: published from {sources.get(key) or 'unknown'} "
                                    f"while its NSE filings are on hand")
                continue
            # 2. does what we published equal what was filed?
            rows = {i["label"]: i["values"] for i in table.get("items", [])}
            for label, item in (("Net Profit", "pat"), ("Revenue", "revenue")):
                vals = rows.get(label)
                if not vals:
                    continue
                for period, shown in zip(table["periods"], vals):
                    truth = book.get((sym, ptype, period), {}).get(item)
                    if shown is None or truth is None or truth == 0:
                        continue
                    checked += 1
                    gap = abs(shown - truth)
                    if gap > ABS_TOLERANCE and gap / abs(truth) > TOLERANCE:
                        wrong_value.append(
                            f"{sym}.{key} {period} {label}: showing {shown:,.1f} "
                            f"but the filing says {truth:,.1f}")

    print(f"checked {len(files):,} company files, {checked:,} published figures against their filings")
    print(f"  published from the wrong source : {len(wrong_source):,}")
    print(f"  disagreeing with the filing     : {len(wrong_value):,}")
    for line in (wrong_source[:8] + wrong_value[:8]):
        print(f"    ! {line}")
    total = len(wrong_source) + len(wrong_value)
    if total > MAX_BAD:
        print(
            f"\nSOURCE CHECK FAILED - {total:,} published figures do not match the company's own filing.\n"
            "Neither number looks wrong on screen, which is exactly why this is checked here."
        )
        raise SystemExit(1)
    print("\nevery published figure traces back to the filing it came from")


if __name__ == "__main__":
    main()
