"""Rscreener P1 - downloads the full NSE equity universe list.

Source: NSE's official EQUITY_L.csv (every listed equity).
Output: data/universe.csv + `universe` table in data/rscreener.db
"""
import io
import re
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


BSE_LIST = ("https://api.bseindia.com/BseIndiaAPI/api/ListofScripData/w"
            "?Group=&Scripcode=&industry=&segment=Equity&status=Active")
BSE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://www.bseindia.com/",
}


def _norm_name(n: str) -> str:
    """A company name reduced to something two exchanges can be compared on."""
    n = re.sub(r"[^a-z0-9 ]", " ", (n or "").lower())
    n = re.sub(r"\b(limited|ltd|india|the|company|co|corporation|corp|private|pvt)\b", " ", n)
    return re.sub(r"\s+", "", n)


def bse_only(nse: pd.DataFrame) -> pd.DataFrame:
    """BSE-listed companies that are NOT on the NSE list, in the NSE's shape.

    2,223 of BSE's 4,949 active equity scrips are the same companies already
    covered from the NSE side, so the join has to be right or the universe
    doubles up on the biggest names in the market.

    Three signals, in order, because no single one is sufficient:
      ISIN    the strongest, and enough for 2,223 of them
      symbol  catches a company whose ISIN changed after a corporate action -
              Jupiter Life Line Hospitals is on both exchanges as JLHL but
              carries a different ISIN on each, and ISIN alone called it new
      name    catches the remaining 3, where both other fields differ

    A false match loses a company; a missed match invents a duplicate of one
    that is already there. The name comparison is the loosest of the three and
    is applied last, on the residue, for that reason.
    """
    try:
        rows = requests.get(BSE_LIST, headers=BSE_HEADERS, timeout=60).json()
    except Exception as e:  # noqa: BLE001 - BSE being down must not lose the NSE list
        print(f"  BSE list unavailable ({str(e)[:70]}) - keeping the NSE universe alone")
        return pd.DataFrame()
    have_isin = {i for i in nse["ISIN NUMBER"] if i}
    have_sym = {str(s).upper() for s in nse["SYMBOL"]}
    have_name = {_norm_name(n) for n in nse["NAME OF COMPANY"]}
    out, matched = [], {"isin": 0, "symbol": 0, "name": 0}
    for r in rows:
        isin, sid = r.get("ISIN_NUMBER"), (r.get("scrip_id") or "").strip().upper()
        if not isin or not sid:
            continue
        if isin in have_isin:
            matched["isin"] += 1; continue
        if sid in have_sym:
            matched["symbol"] += 1; continue
        if _norm_name(r.get("Scrip_Name")) in have_name:
            matched["name"] += 1; continue
        out.append({
            "SYMBOL": sid,
            "NAME OF COMPANY": (r.get("Scrip_Name") or "").strip(),
            "SERIES": "EQ",
            "DATE OF LISTING": None,
            "PAID UP VALUE": r.get("FACE_VALUE"),
            "MARKET LOT": 1,
            "ISIN NUMBER": isin,
            "FACE VALUE": r.get("FACE_VALUE"),
            "EXCHANGE": "BSE",
            "BSE_CODE": r.get("SCRIP_CD"),
            "BSE_GROUP": r.get("GROUP"),
        })
    print(f"  BSE: {len(rows)} active scrips, {matched['isin']} matched by ISIN, "
          f"{matched['symbol']} by symbol, {matched['name']} by name")
    return pd.DataFrame(out)


def main() -> None:
    DATA.mkdir(exist_ok=True)
    df = fetch()
    # EQ = normal rolling settlement, BE = trade-for-trade; both are real
    # listed companies. Other series (GB, W1, ...) are bonds/warrants - skip.
    keep = df[df["SERIES"].isin(["EQ", "BE"])].copy()
    keep["EXCHANGE"] = "NSE"
    keep["BSE_CODE"] = None
    keep["BSE_GROUP"] = None

    extra = bse_only(keep)
    universe = pd.concat([keep, extra], ignore_index=True) if len(extra) else keep

    # Which ticker each price source answers to. Fetchers used to hardcode
    # ".NS", which silently means "this project is NSE and always will be".
    # Carrying it as data is what lets a BSE-only company be fetched at all.
    universe["YF_SYMBOL"] = [
        f"{s}.BO" if e == "BSE" else f"{s}.NS"
        for s, e in zip(universe["SYMBOL"], universe["EXCHANGE"])
    ]

    universe.to_csv(DATA / "universe.csv", index=False)
    with sqlite3.connect(DB) as con:
        universe.to_sql("universe", con, if_exists="replace", index=False)
    n_bse = int((universe["EXCHANGE"] == "BSE").sum())
    print(f"universe: {len(universe)} companies - {len(universe) - n_bse} from NSE, "
          f"{n_bse} listed only on BSE")
    print(universe[["SYMBOL", "NAME OF COMPANY", "EXCHANGE"]].head(3).to_string(index=False))


if __name__ == "__main__":
    main()
