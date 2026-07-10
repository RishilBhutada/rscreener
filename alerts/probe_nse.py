"""Probe: can a GitHub Actions runner reach NSE (and Yahoo) at all?

Run this ON the runner before building any alert logic. Exit is always 0 -
the VERDICT line is the result, not the exit code.
"""
import sys

import requests

H = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.nseindia.com/",
}


def probe(name: str, fn) -> bool:
    try:
        r = fn()
        body = r.text[:120].replace("\n", " ")
        print(f"{name}: HTTP {r.status_code} len={len(r.text)} :: {body}")
        return r.status_code == 200
    except Exception as e:  # noqa: BLE001 - report every failure kind
        print(f"{name}: FAIL {type(e).__name__}: {e}")
        return False


def main() -> None:
    s = requests.Session()
    s.headers.update(H)
    ok_home = probe("nse-home", lambda: s.get("https://www.nseindia.com", timeout=20))
    ok_api = probe(
        "nse-announcements-api",
        lambda: s.get("https://www.nseindia.com/api/corporate-announcements?index=equities", timeout=25),
    )
    ok_arch = probe(
        "nse-archives-csv",
        lambda: requests.get("https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv", headers=H, timeout=20),
    )
    ok_yahoo = probe(
        "yahoo-quote",
        lambda: requests.get("https://query2.finance.yahoo.com/v8/finance/chart/RELIANCE.NS", headers=H, timeout=20),
    )
    if ok_api:
        verdict = "API_OK"
    elif ok_home or ok_arch or ok_yahoo:
        verdict = "PARTIAL"
    else:
        verdict = "ALL_BLOCKED"
    print(f"VERDICT: {verdict} (home={ok_home} api={ok_api} archives={ok_arch} yahoo={ok_yahoo})")
    sys.exit(0)


if __name__ == "__main__":
    main()
