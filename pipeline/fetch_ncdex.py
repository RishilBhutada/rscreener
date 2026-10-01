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
or cancels anything, whatever account it can see. (Angel's static-IP rule,
from 1-Apr-2026, covers orders and GTT only; data calls need none.)

Two ways to the prices, and the log says which worked:
  1. Daily candles (historical API): each contract's life so far. Angel's
     release notes list free history for NSE, NFO, BSE, BFO, CDS and MCX -
     not NCDEX - so this is expected to be refused, and stops after three
     refusals rather than asking 96 times.
  2. The day's quote (market-data API, FULL mode, "all exchanges"): one bar
     per contract per session, with open interest. Stored every run, so the
     history builds a session a night from the first run on.

Stored beside MCX in the commodity tables, keyed "NCDEX|<token>", under
"<NAME>_NCDEX" contract types - Kapas and Cotton trade on both exchanges.

Usage:
  python fetch_ncdex.py [--days 400]     the nightly read
  python fetch_ncdex.py --check          log in, ask for one contract both
                                         ways, print what came back, store
                                         nothing - a one-minute test
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

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "rscreener.db"
IST = timezone(timedelta(hours=5, minutes=30))
MASTER = "https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json"
# Routes as Angel's own Python library (angel-one/smartapi-python) has them.
API = "https://apiconnect.angelone.in"
LOGIN = API + "/rest/auth/angelbroking/user/v1/loginByPassword"
LOGOUT = API + "/rest/secure/angelbroking/user/v1/logout"
CANDLES = API + "/rest/secure/angelbroking/historical/v1/getCandleData"
QUOTE = API + "/rest/secure/angelbroking/market/v1/quote"
SECRETS = ("ANGEL_API_KEY", "ANGEL_CLIENT_CODE", "ANGEL_PIN", "ANGEL_TOTP_SECRET")
NCDEX_SUFFIX = "_NCDEX"      # as commodities_lib; repeated so --check needs no pipeline imports
# NCDEX's agri session closes at 17:00 IST and the rest by 21:00; a quote
# for today taken before then is a session still in progress.
SESSION_OVER = 21


def clean_secret(secret: str) -> str:
    """The setup key as typed or pasted, without the spaces, line breaks,
    dashes and padding that copying adds - a pasted key arrived with one."""
    return "".join(ch for ch in secret if not ch.isspace() and ch not in "-=").upper()


def secret_problem(secret: str) -> str | None:
    """Why a setup key cannot be one, in words that never show the key."""
    s = clean_secret(secret)
    if not s:
        return "ANGEL_TOTP_SECRET is empty"
    if s.isdigit() and len(s) <= 8:
        return (f"ANGEL_TOTP_SECRET is a {len(s)}-digit number - that is the code the authenticator app shows, "
                "which changes every 30 seconds. It needs the setup text under the QR code instead "
                "(letters A-Z and digits 2-7, usually 16-32 characters)")
    bad = [ch for ch in s if ch not in "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"]
    if bad:
        kinds = sorted({"the digits 0, 1, 8 or 9" if ch in "0189" else "symbols or punctuation" for ch in bad})
        return (f"ANGEL_TOTP_SECRET ({len(s)} characters) has {len(bad)} that a setup key never contains - "
                f"{' and '.join(kinds)}. Re-copy the text under the QR code")
    return None


def totp(secret: str, at: float | None = None) -> str:
    """The six-digit code an authenticator app shows (RFC 6238, 30 seconds)."""
    s = clean_secret(secret)
    key = base64.b32decode(s + "=" * (-len(s) % 8))
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


def live_futures(today: str) -> list[dict]:
    """Every live NCDEX future in Angel's public instrument file."""
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
        if expiry >= today:
            out.append({"key": f"NCDEX|{x['token']}", "token": str(x["token"]), "name": x.get("name") or "",
                        "root": f"{x.get('name')}{NCDEX_SUFFIX}", "expiry": expiry, "symbol": x.get("symbol"),
                        "lot": int(float(x.get("lotsize") or 0)), "tick": float(x.get("tick_size") or 0) / 100})
    return out


def record(con: sqlite3.Connection, live: list[dict], today: str) -> None:
    """Add-only, like MCX's: an expired contract keeps its row, which is how
    its history stays findable."""
    from commodities_lib import ncdex_mult   # here, so --check imports nothing of the pipeline
    for c in live:
        mult = ncdex_mult(c["root"][: -len(NCDEX_SUFFIX)], c["lot"])
        con.execute("""
            INSERT INTO commodity_contracts VALUES (?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(key) DO UPDATE SET last_seen=excluded.last_seen, lot=excluded.lot, tick=excluded.tick,
                                           mult=excluded.mult""",
            (c["key"], "NCDEX", c["root"], c["expiry"], mult, c["lot"], c["tick"], None, c["symbol"], today, today))
    con.commit()


def trade_day(q: dict) -> str | None:
    """The session a quote belongs to, from the exchange's own timestamp."""
    for f in ("exchTradeTime", "exchFeedTime"):
        for fmt in ("%d-%b-%Y %H:%M:%S", "%Y-%m-%d %H:%M:%S", "%d-%m-%Y %H:%M:%S", "%d-%b-%Y %H:%M"):
            try:
                return datetime.strptime(str(q.get(f)), fmt).date().isoformat()
            except ValueError:
                continue
    return None


def all_quotes(api: Angel, tokens: list[str]) -> list[dict]:
    """Fifty to a call; one at a time if Angel will not take a batch (its
    announcement once said a single token per exchange)."""
    out: list[dict] = []
    try:
        for i in range(0, len(tokens), 50):
            out += api.quotes(tokens[i:i + 50])
            time.sleep(1.0)
        return out
    except Exception as e:  # noqa: BLE001
        print(f"  quotes: a batch was refused ({e}) - asking one contract at a time")
    out = []
    for t in tokens:
        try:
            out += api.quotes([t])
        except Exception:  # noqa: BLE001 - one contract's refusal is that contract's
            pass
        time.sleep(1.0)
    return out


def by_quotes(api: Angel, con: sqlite3.Connection, live: list[dict]) -> int:
    """Each contract's bar for the latest session, from its quote. A run can
    start hours late (GitHub has begun the 22:00 run at 03:41), so the date is
    the exchange's trade time; only a quote dated TODAY before 21:00 IST is a
    session still in progress, and is left for the next run."""
    now = datetime.now(IST)
    today = now.date().isoformat()
    key_of = {c["token"]: c["key"] for c in live}
    root_of = {c["key"]: c["root"][: -len(NCDEX_SUFFIX)] for c in live}
    stored = unfinished = 0
    quotes = all_quotes(api, list(key_of))
    traded: set[str] = set()
    for q in quotes:
        key = key_of.get(str(q.get("symbolToken")))
        ltp = q.get("ltp")
        if not key or not ltp or ltp <= 0 or not q.get("tradeVolume"):
            continue
        traded.add(root_of[key])
        day = trade_day(q) or (today if now.hour >= SESSION_OVER else None)
        if day is None or (day == today and now.hour < SESSION_OVER):
            unfinished += 1
            continue
        oi = q.get("opnInterest")
        con.execute("INSERT OR REPLACE INTO commodity_bars VALUES (?,?,?,?,?,?,?,?)",
                    (key, day, q.get("open") or ltp, q.get("high") or ltp, q.get("low") or ltp, ltp,
                     int(q.get("tradeVolume") or 0), int(oi) if oi is not None else None))
        stored += 1
    con.commit()
    if unfinished:
        print(f"  quotes: {unfinished} contracts' session not over yet - left for the next run")
    # A quote with no trade is a contract nobody dealt in that session; it gets
    # no bar, because its last price is not that day's price.
    quiet = sorted(set(root_of.values()) - traded)
    print(f"  quotes: {len(quotes)} of {len(key_of)} contracts answered; "
          f"{len(set(root_of.values())) - len(quiet)} contract types traded"
          + (f", no trades in {len(quiet)}: {' '.join(quiet)}" if quiet else ""))
    return stored


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
            # NCDEX history, and asking 93 more times will not change that.
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


def login_from_env() -> Angel | None:
    missing = [k for k in SECRETS if not os.environ.get(k)]
    if missing:
        print(f"NCDEX skipped: the Angel One login is not set up ({len(missing)} of 4 secrets missing: {', '.join(missing)}).")
        return None
    problem = secret_problem(os.environ["ANGEL_TOTP_SECRET"])
    if problem:
        print(f"NCDEX: not logging in - {problem}.")
        return None
    api = Angel(os.environ["ANGEL_API_KEY"].strip())
    try:
        api.login(os.environ["ANGEL_CLIENT_CODE"].strip(), os.environ["ANGEL_PIN"].strip(), os.environ["ANGEL_TOTP_SECRET"])
    except Exception as e:  # noqa: BLE001 - say why, never with what
        print(f"NCDEX: Angel One refused the login - {e}")
        return None
    print("NCDEX: logged in to Angel One (read-only calls only)")
    return api


def check() -> None:
    """One contract, both ways, printed - nothing stored."""
    today = datetime.now(IST).date().isoformat()
    live = live_futures(today)
    print(f"instrument file: {len(live)} live NCDEX futures")
    if not live:
        return
    pick = min((c for c in live if c["name"] == "GUARSEED10"), key=lambda c: c["expiry"], default=live[0])
    print(f"test contract: {pick['symbol']} (token {pick['token']}), expiry {pick['expiry']}")
    api = login_from_env()
    if not api:
        return
    try:
        try:
            q = api.quotes([pick["token"]])
            if q:
                x = q[0]
                print("  quote: OK - " + ", ".join(f"{k} {x.get(k)}" for k in (
                    "ltp", "open", "high", "low", "close", "tradeVolume", "opnInterest", "exchTradeTime")))
            else:
                print("  quote: answered, but with no data for this contract")
        except Exception as e:  # noqa: BLE001
            print(f"  quote: refused - {e}")
        try:
            now = datetime.now(IST)
            rows = api.candles(pick["token"], now - timedelta(days=30), now)
            print(f"  daily candles: OK - {len(rows)} days" + (f", latest {rows[-1]}" if rows else ""))
        except Exception as e:  # noqa: BLE001
            print(f"  daily candles: refused - {e}")
    finally:
        api.logout()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=400, help="how far back a contract's first candle read reaches")
    ap.add_argument("--check", action="store_true", help="test the login and both routes on one contract; store nothing")
    args = ap.parse_args()
    if args.check:
        check()
        return
    if not all(os.environ.get(k) for k in SECRETS):
        login_from_env()      # prints which are missing
        return
    from fetch_commodities import schema   # the pipeline's tables - not needed by --check
    today = datetime.now(IST).date().isoformat()
    con = sqlite3.connect(DB, timeout=180)
    schema(con)
    live = live_futures(today)
    record(con, live, today)
    print(f"NCDEX: {len(live)} live futures in Angel's instrument file")
    api = login_from_env() if live else None
    if not api:
        con.close()
        return
    try:
        try:
            n = by_candles(api, con, live, today, args.days)
            print(f"  daily candles: {n} of {len(live)} contracts stored")
        except Exception as e:  # noqa: BLE001
            print(f"  daily candles: refused - {e}")
        try:
            print(f"  quotes: {by_quotes(api, con, live)} contracts stored")
        except Exception as e:  # noqa: BLE001
            print(f"  quotes: refused - {e}")
    finally:
        api.logout()
        con.close()


if __name__ == "__main__":
    main()
