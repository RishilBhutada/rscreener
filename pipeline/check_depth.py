"""Fails the build when chart history goes BACKWARDS.

Why this exists: the nightly job restores the database from a release asset,
re-exports, and deploys. When that asset was stale, every night quietly
overwrote 20 years of ratio history with ~7 and shipped it - the site looked
fine, nothing errored, and the loss was only visible by reading a chart. A
deploy that silently deletes history is worse than a deploy that fails.

So: measure the depth of what we are about to publish, compare it to the best
we have ever published (data/depth_baseline.json), and exit non-zero on a
material regression. Improvements update the baseline.

Usage:
  python check_depth.py            # verify, and record improvements
  python check_depth.py --update   # force-accept current depth as the baseline
"""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
COMPANIES = ROOT / "web" / "public" / "companies"
# deliberately NOT under data/ - that directory is gitignored (it holds the DB),
# so a baseline there would never reach CI and the guard would pass vacuously
BASELINE = Path(__file__).resolve().parent / "depth_baseline.json"

# Names whose charts must stay deep. They are the most-viewed, and any pipeline
# breakage shows up here first.
WATCH = [
    "RELIANCE", "HDFCBANK", "TCS", "INFY", "ICICIBANK", "SBIN",
    "ITC", "LT", "BHARTIARTL", "HINDUNILVR",
]
TOLERANCE = 0.85  # a band may lose 15% of its points to data revisions, no more


def measure() -> dict:
    """Depth metrics for the export sitting in web/public/companies."""
    out: dict = {"symbols": {}, "totals": {}}
    deep = 0
    total_bands = 0
    for sym in WATCH:
        f = COMPANIES / f"{sym}.json"
        if not f.exists():
            continue
        d = json.loads(f.read_text(encoding="utf-8"))
        rec = {}
        for key in ("pe_band", "ev_band", "pb_band", "ps_band"):
            b = d.get(key)
            if b and b.get("series"):
                rec[key] = {"n": len(b["series"]), "start": b["series"][0][0]}
        tq = (d.get("trend") or {}).get("quarterly") or {}
        if tq.get("periods"):
            rec["trend_quarters"] = {"n": len(tq["periods"]), "start": tq["periods"][0]}
        if rec:
            out["symbols"][sym] = rec
    for f in COMPANIES.glob("*.json"):
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            continue
        b = d.get("pe_band")
        if b and b.get("series"):
            total_bands += 1
            if b["series"][0][0] < "2012-01-01":
                deep += 1
    out["totals"] = {"companies_with_pe_band": total_bands, "pe_bands_reaching_pre_2012": deep}
    return out


def compare(cur: dict, base: dict) -> list[str]:
    fails: list[str] = []
    for sym, metrics in base.get("symbols", {}).items():
        cm = cur.get("symbols", {}).get(sym)
        if cm is None:
            fails.append(f"{sym}: disappeared from the export entirely")
            continue
        for key, want in metrics.items():
            got = cm.get(key)
            if got is None:
                fails.append(f"{sym}.{key}: missing (was {want['n']} pts from {want['start']})")
                continue
            if got["n"] < want["n"] * TOLERANCE:
                fails.append(
                    f"{sym}.{key}: {got['n']} pts from {got['start']} "
                    f"- was {want['n']} pts from {want['start']}"
                )
    bt = base.get("totals", {})
    ct = cur.get("totals", {})
    for key in ("companies_with_pe_band", "pe_bands_reaching_pre_2012"):
        if key in bt and ct.get(key, 0) < bt[key] * TOLERANCE:
            fails.append(f"totals.{key}: {ct.get(key)} - was {bt[key]}")
    return fails


def merge_best(cur: dict, base: dict) -> dict:
    """Baseline tracks the BEST depth ever shipped, so a bad day can't lower the bar."""
    out = {"symbols": {}, "totals": {}, "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")}
    syms = set(cur.get("symbols", {})) | set(base.get("symbols", {}))
    for s in syms:
        c, b = cur.get("symbols", {}).get(s, {}), base.get("symbols", {}).get(s, {})
        rec = {}
        for k in set(c) | set(b):
            cv, bv = c.get(k), b.get(k)
            rec[k] = cv if (cv and (not bv or cv["n"] >= bv["n"])) else bv
        out["symbols"][s] = {k: v for k, v in rec.items() if v}
    for k in set(cur.get("totals", {})) | set(base.get("totals", {})):
        out["totals"][k] = max(cur.get("totals", {}).get(k, 0), base.get("totals", {}).get(k, 0))
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--update", action="store_true", help="accept current depth as the baseline")
    args = ap.parse_args()

    cur = measure()
    print("current depth:")
    for sym, m in cur["symbols"].items():
        pe = m.get("pe_band")
        tq = m.get("trend_quarters")
        print(f"  {sym:11} PE {pe['n']:>4} pts from {pe['start']}" if pe else f"  {sym:11} PE none", end="")
        print(f" | {tq['n']:>3} quarters from {tq['start']}" if tq else "")
    print(f"  totals: {cur['totals']}")

    base = json.loads(BASELINE.read_text(encoding="utf-8")) if BASELINE.exists() else None
    if base is None or args.update:
        # --update is a deliberate override, so it REPLACES the bar rather than
        # merging. The reason to reach for it is that the old numbers were wrong
        # - a Price/Book series that was long only because it divided by paid-up
        # capital - and merging would keep defending that bad figure forever.
        BASELINE.parent.mkdir(parents=True, exist_ok=True)
        cur["updated_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        BASELINE.write_text(json.dumps(cur, indent=1), encoding="utf-8")
        print(f"baseline {'replaced' if base else 'created'} -> {BASELINE}")
        return

    fails = compare(cur, base)
    if fails:
        print("\nDEPTH REGRESSION - refusing to publish:")
        for f in fails:
            print(f"  ! {f}")
        print(
            "\nThe export has LESS history than what is already live. This is what a stale\n"
            "restored database looks like. Fix the source data (or pass --update if the loss\n"
            "is genuinely intended) rather than shipping a chart that lost its history."
        )
        raise SystemExit(1)

    BASELINE.write_text(json.dumps(merge_best(cur, base), indent=1), encoding="utf-8")
    print("depth OK - no regression; baseline holds the best depth shipped so far")


if __name__ == "__main__":
    main()
