"""Rscreener - coverage expansion: run every deep-data fetcher for the next
band of companies by market cap (the top 500 already have everything).

Usage:
  python expand_coverage.py --start 500 --count 500   # companies ranked 501-1000
"""
import argparse
import sqlite3
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "rscreener.db"
PIPELINE = Path(__file__).resolve().parent


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", type=int, required=True, help="mcap rank offset (0-based)")
    ap.add_argument("--count", type=int, default=500)
    args = ap.parse_args()

    con = sqlite3.connect(DB, timeout=180)
    symbols = [
        r[0] for r in con.execute(
            "SELECT symbol FROM fundamentals WHERE market_cap IS NOT NULL "
            "ORDER BY market_cap DESC LIMIT ? OFFSET ?",
            (args.count, args.start),
        ).fetchall()
    ]
    con.close()
    if not symbols:
        print("no symbols in this band")
        return
    band = ROOT / "data" / f"band_{args.start}_{args.start + len(symbols)}.txt"
    band.write_text(",".join(symbols), encoding="utf-8")
    print(f"band {args.start}-{args.start + len(symbols)}: {len(symbols)} symbols -> {band.name}")

    steps = [
        ["fetch_fundamentals.py", "--symbols", f"@data/{band.name}", "--refresh", "--sleep", "0.6"],
        ["fetch_results_history.py", "--symbols", f"@data/{band.name}", "--quarters-back", "12", "--sleep", "0.35"],
        ["fetch_prices.py", "--symbols", f"@data/{band.name}", "--sleep", "0.4"],
        ["fetch_shareholding.py", "--symbols", f"@data/{band.name}", "--sleep", "0.4"],
        ["fetch_documents.py", "--symbols", f"@data/{band.name}", "--sleep", "0.5"],
    ]
    for step in steps:
        print(f"\n=== {step[0]} ===", flush=True)
        r = subprocess.run([sys.executable, str(PIPELINE / step[0]), *step[1:]], cwd=ROOT)
        if r.returncode != 0:
            print(f"{step[0]} exited {r.returncode} - continuing (fetchers are resumable)")
    print("\nexpansion band complete")


if __name__ == "__main__":
    main()
