"""Rscreener P1 - downloads the full NSE equity universe list.

Source: NSE's official EQUITY_L.csv (every listed equity).
Output: data/universe.csv + `universe` table in data/rscreener.db
"""
import io
import sqlite3
from pathlib import Path

import pandas as pd
import requests

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
DB = DATA / "rscreener.db"

# NSE has moved this file between hosts over the years; try newest first.
URLS = [
    "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv",
    "https://archives.nseindia.com/content/equities/EQUITY_L.csv",
]
# NSE rejects requests without a browser-like User-Agent.
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    "Accept": "*/*",
}


def fetch() -> pd.DataFrame:
    last_err = None
    for url in URLS:
        try:
            r = requests.get(url, headers=HEADERS, timeout=30)
            r.raise_for_status()
            df = pd.read_csv(io.StringIO(r.text))
            df.columns = [c.strip() for c in df.columns]
            if "SYMBOL" in df.columns:
                return df
            last_err = f"{url}: unexpected columns {list(df.columns)[:6]}"
        except Exception as e:  # noqa: BLE001 - try the next mirror
            last_err = f"{url}: {e}"
    raise SystemExit(f"universe download failed - {last_err}")


def main() -> None:
    DATA.mkdir(exist_ok=True)
    df = fetch()
    # EQ = normal rolling settlement, BE = trade-for-trade; both are real
    # listed companies. Other series (GB, W1, ...) are bonds/warrants - skip.
    keep = df[df["SERIES"].isin(["EQ", "BE"])].copy()
    keep.to_csv(DATA / "universe.csv", index=False)
    with sqlite3.connect(DB) as con:
        keep.to_sql("universe", con, if_exists="replace", index=False)
    print(f"universe: {len(df)} rows downloaded, {len(keep)} kept (EQ+BE series)")
    print(keep[["SYMBOL", "NAME OF COMPANY"]].head(5).to_string(index=False))


if __name__ == "__main__":
    main()
