"""Rscreener - NCDEX futures, read through the owner's own Angel One login.

NCDEX's website refuses anything but a real browser, and no open feed carries
its prices (checked 30-Sep-2026: the NCDEX site, Upstox, Zerodha, Moneycontrol).
Angel One lists every NCDEX contract in its public instrument file, and its
SmartAPI serves prices to a logged-in account. The owner holds that account;
the login comes from four GitHub Actions secrets he set himself:

    ANGEL_API_KEY  ANGEL_CLIENT_CODE  ANGEL_PIN  ANGEL_TOTP_SECRET

Without all four this says so and stops, successfully - the rest of the run
does not depend on it. Nothing here prints them, or the session token.

READ-ONLY BY CONSTRUCTION. The only SmartAPI calls in this file are login,
logout, daily candles and market quotes. No order, GTT, funds or position
endpoint appears here, and none may be added: the app never places, changes
or cancels anything, whatever account it can see.

Two ways to the prices, tried in this order, and the log says which worked:
  1. Daily candles (historical API): each contract's life so far - open,
     high, low, close, volume; no open interest.
  2. Today's quote (market-data API, FULL mode): one bar a day with open
     interest, stored as it comes, so history builds from here.
Angel does not document either for NCDEX; the first run finds out.

Stored beside MCX in the commodity tables, keyed "NCDEX|<token>", under
"<NAME>_NCDEX" contract types - Kapas and Cotton trade on both exchanges.

Usage:  python fetch_ncdex.py [--days 400]
"""
import argparse
import base64
import hashlib
import hmac
import os
import sqlite3
import struct
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

from commodities_lib import NCDEX_SUFFIX
from fetch_commodities import schema

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "rscreener.db"
IST = timezone(timedelta(hours=5, minutes=30))
MASTER = "https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json"
API = "https://apiconnect.angelone.in"
LOGIN = API + "/rest/auth/angelbroking/user/v1/loginByPassword"
LOGOUT = API + "/rest/secure/angelbroking/user/v1/logout"
CANDLES = API + "/rest/secure/angelbroking/historical/v1/getCandleData"
QUOTE = API + "/rest/secure/angelbroking/market/v1/quote/"
SECRETS = ("ANGEL_API_KEY", "ANGEL_CLIENT_CODE", "ANGEL_PIN", "ANGEL_TOTP_SECRET")


def totp(secret: str, at: float | None = None) -> str:
    """The six-digit code an authenticator app shows (RFC 6238, 30 seconds)."""
    key = base64.b32decode(secret.replace(" ", "").upper() + "=" * (-len(secret.replace(" ", "")) % 8))
    digest = hmac.new(key, struct.pack(">Q", int((at or time.time()) // 30)), hashlib.sha1).digest()
    o = digest[-1] & 0x0F
    return f"{(struct.unpack('>I', digest[o:o + 4])[0] & 0x7FFFFFFF) % 1_000_000:06d}"


class Angel:
    """A logged-in SmartAPI session holding nothing but read calls."""

    def __init__(self, api_key: str):
        self.s = requests.Session()
        self.s.headers.update({
            "Content-Type": "application/json", "Accept": "application/json",
            "X-UserType": "USER", "X-SourceID": "WEB", "X-ClientLocalIP": "127.0.0.1",
            "X-ClientPublicIP": "127.0.0.1", "X-MACAddress": "00:00:00:00:00:00", "X-PrivateKey": api_key,
        })
        self.client = ""

    def _post(self, url: str, body: dict) -> dict:
        r = self.s.post(url, json=body, timeout=40)
        try:
            j = r.json()
        except ValueError:
            raise RuntimeError(f"HTTP {r.status_code}, not JSON") from None
        if not j.get("status"):
            raise RuntimeError(f"{j.get('errorcode') or r.status_code}: {j.get('message') or 'refused'}")
        return j

    def login(self, client: str, pin: str, totp_secret: str) -> None:
        j = self._post(LOGIN, {"clientcode": client, "password": pin, "totp": totp(totp_secret)})
        token = (j.get("data") or {}).get("jwtToken") or ""
        if not token:
            raise RuntimeError("login answered without a session token")
        self.s.headers["Authorization"] = token if token.startswith("Bearer ") else f"Bearer {token}"
        self.client = client

    def logout(self) -> None:
        try:
            self._post(LOGOUT, {"clientcode": self.client})
        except Exception:  # noqa: BLE001 - the token expires on its own by morning
            pass

    def candles(self, token: str, frm: datetime, to: datetime) -> list[list]:
        j = self._post(CANDLES, {"exchange": "NCDEX", "symboltoken": token, "interval": "ONE_DAY",
                                 "fromdate": frm.strftime("%Y-%m-%d 09:00"), "todate": to.strftime("%Y-%m-%d 23:59")})
        return j.get("data") or []

    def quotes(self, tokens: list[str]) -> list[dict]:
        j = self._post(QUOTE, {"mode": "FULL", "exchangeTokens": {"NCDEX": tokens}})
        return (j.get("data") or {}).get("fetched") or []


def contracts(con: sqlite3.Connection, today: str) -> list[dict]:
    """Every live NCDEX future in Angel's public instrument file, recorded
    add-only like MCX's, so an expired contract's history stays findable."""
    r = requests.get(MASTER, timeout=120)
    r.raise_for_status()
    out = []
    for x in r.json():
        if x.get("exch_seg") != "NCDEX" or not str(x.get("instrumenttype", "")).startswith("FUT"):
            continue
        try:
            expiry = datetime.strptime(x["expiry"], "%d%b%Y").date().isoformat()
        except (KeyError, ValueError):
            continue
        if expiry < today:
            continue
        key, root = f"NCDEX|{x['token']}", f"{x['name']}{NCDEX_SUFFIX}"
        con.execute("""
            INSERT INTO commodity_contracts VALUES (?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(key) DO UPDATE SET last_seen=excluded.last_seen, lot=excluded.lot, tick=excluded.tick""",
            (key, "NCDEX", root, expiry, None, int(float(x.get("lotsize") or 0)),
             float(x.get("tick_size") or 0) / 100, None, x.get("symbol"), today, today))
        out.append({"key": key, "token": str(x["token"]), "root": root})
    con.commit()
    print(f"NCDEX: {len(out)} live futures in Angel's instrument file")
    return out


def by_candles(api: Angel, con: sqlite3.Connection, live: list[dict], today: str, days: int) -> int:
    last = dict(con.execute("SELECT key, MAX(date) FROM commodity_bars WHERE key LIKE 'NCDEX|%' GROUP BY key"))
    now = datetime.now(IST)
    stored = failed = 0
    for c in live:
        frm = now - timedelta(days=days)
        if last.get(c["key"]):
            frm = datetime.fromisoformat(last[c["key"]]) - timedelta(days=10)
        try:
            rows = api.candles(c["token"], frm, now)
        except Exception as e:  # noqa: BLE001
            failed += 1
            # Three refusals before a single success: the API does not serve
            # NCDEX, and asking 95 more times will not change that.
            if not stored and failed >= 3:
                raise RuntimeError(f"first {failed} contracts refused - {e}") from None
            continue
        batch = [(c["key"], str(r[0])[:10], r[1], r[2], r[3], r[4], int(r[5] or 0), None)
                 for r in rows if r and str(r[0])[:10] < today and r[4] and r[4] > 0]
        if batch:
            con.executemany("INSERT OR REPLACE INTO commodity_bars VALUES (?,?,?,?,?,?,?,?)", batch)
            stored += 1
        time.sleep(0.4)          # SmartAPI allows three historical calls a second
    con.commit()
    if failed:
        print(f"  daily candles: {failed} contracts refused")
    return stored


def trade_day(q: dict, fallback: str) -> str:
    """The session a quote belongs to, from the exchange's own timestamp."""
    for f in ("exchTradeTime", "exchFeedTime"):
        for fmt in ("%d-%b-%Y %H:%M:%S", "%Y-%m-%d %H:%M:%S", "%d-%m-%Y %H:%M:%S"):
            try:
                return datetime.strptime(str(q.get(f)), fmt).date().isoformat()
            except ValueError:
                continue
    return fallback


def by_quotes(api: Angel, con: sqlite3.Connection, live: list[dict]) -> int:
    """Today's bar for each contract, from the day's quote. Stored only after
    NCDEX's agri session has closed, dated by the exchange's own trade time."""
    now = datetime.now(IST)
    if now.hour < 21:
        print("  quotes: before 21:00 IST the day is not over - nothing stored")
        return 0
    key_of = {c["token"]: c["key"] for c in live}
    stored = 0
    tokens = list(key_of)
    for i in range(0, len(tokens), 50):
        for q in api.quotes(tokens[i:i + 50]):
            key = key_of.get(str(q.get("symbolToken")))
            ltp = q.get("ltp")
            if not key or not ltp or ltp <= 0 or not q.get("tradeVolume"):
                continue
            day = trade_day(q, now.date().isoformat())
            con.execute("INSERT OR REPLACE INTO commodity_bars VALUES (?,?,?,?,?,?,?,?)",
                        (key, day, q.get("open") or ltp, q.get("high") or ltp, q.get("low") or ltp, ltp,
                         int(q.get("tradeVolume") or 0), int(q.get("opnInterest") or 0)))
            stored += 1
        time.sleep(1.0)          # one quote call a second
    con.commit()
    return stored


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=400, help="how far back a contract's first read reaches")
    args = ap.parse_args()
    missing = [k for k in SECRETS if not os.environ.get(k)]
    if missing:
        print(f"NCDEX skipped: the Angel One login is not set up ({len(missing)} of 4 secrets missing).")
        return
    today = datetime.now(IST).date().isoformat()
    con = sqlite3.connect(DB, timeout=180)
    schema(con)
    live = contracts(con, today)
    if not live:
        return
    api = Angel(os.environ["ANGEL_API_KEY"])
    try:
        api.login(os.environ["ANGEL_CLIENT_CODE"], os.environ["ANGEL_PIN"], os.environ["ANGEL_TOTP_SECRET"])
    except Exception as e:  # noqa: BLE001 - say why, never with what
        print(f"NCDEX: Angel One refused the login - {e}")
        return
    print("NCDEX: logged in to Angel One (read-only calls only)")
    try:
        try:
            n = by_candles(api, con, live, today, args.days)
            print(f"  daily candles: {n} of {len(live)} contracts stored")
        except Exception as e:  # noqa: BLE001
            n = 0
            print(f"  daily candles: refused - {e}")
        try:
            q = by_quotes(api, con, live)
            print(f"  today's quotes: {q} contracts stored")
        except Exception as e:  # noqa: BLE001
            print(f"  today's quotes: refused - {e}")
    finally:
        api.logout()
        con.close()


if __name__ == "__main__":
    main()
