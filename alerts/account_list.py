"""The owner's alert list: alerts/watchlist.txt plus the stars and holdings in
his Rscreener account (owner, 14-Oct-2026: "alerts follow my stars").

The app keeps watchlists and the portfolio in Firestore (profiles/{uid}) once
he is signed in. The GitHub runs that send the pushes read that one document
with a read-only service account, so a star added on the phone reaches the
next alert run without copying anything.

  FIREBASE_SERVICE_ACCOUNT   the service account's JSON key (a GitHub secret
                             the owner adds; role: Cloud Datastore Viewer)
  ALERT_UID                  his account ID, shown under Settings > Account

Either missing, or anything failing, and the list is the file alone - an
alert run must never stop because the account could not be read. Errors are
printed without the key or the token.
"""
import json
import os
from pathlib import Path

import requests

FILE = Path(__file__).with_name("watchlist.txt")


def file_symbols() -> set[str]:
    if not FILE.exists():
        return set()
    return {s for line in FILE.read_text(encoding="utf-8").splitlines() if (s := line.split("#")[0].strip().upper())}


def _value(v: dict):
    """A Firestore REST value as plain Python."""
    if "mapValue" in v:
        return {k: _value(x) for k, x in (v["mapValue"].get("fields") or {}).items()}
    if "arrayValue" in v:
        return [_value(x) for x in (v["arrayValue"].get("values") or [])]
    for k in ("stringValue", "booleanValue", "doubleValue"):
        if k in v:
            return v[k]
    if "integerValue" in v:
        return int(v["integerValue"])
    return None


def symbols_in(profile: dict) -> set[str]:
    """Every starred symbol in every list, the old single list, and holdings."""
    out: set[str] = set()
    lists = profile.get("rscreener_watchlists")
    if isinstance(lists, dict):
        for wl in lists.get("lists") or []:
            if isinstance(wl, dict):
                out.update(s for s in wl.get("symbols") or [] if isinstance(s, str))
    legacy = profile.get("rscreener_watchlist")
    if isinstance(legacy, list):
        out.update(s for s in legacy if isinstance(s, str))
    for h in profile.get("rscreener_portfolio") or []:
        if isinstance(h, dict) and isinstance(h.get("symbol"), str) and (h.get("qty") or 0) > 0:
            out.add(h["symbol"])
    # Indices (^NIFTY) and commodities have no company announcements.
    return {s.strip().upper() for s in out if s.strip() and not s.startswith("^") and ":" not in s}


def account_symbols() -> set[str]:
    raw, uid = os.environ.get("FIREBASE_SERVICE_ACCOUNT", "").strip(), os.environ.get("ALERT_UID", "").strip()
    if not raw or not uid:
        print("account list: not set up (FIREBASE_SERVICE_ACCOUNT / ALERT_UID) - using alerts/watchlist.txt only")
        return set()
    try:
        from google.auth.transport.requests import Request
        from google.oauth2 import service_account

        info = json.loads(raw)
        creds = service_account.Credentials.from_service_account_info(
            info, scopes=["https://www.googleapis.com/auth/datastore"])
        creds.refresh(Request())
        url = (f"https://firestore.googleapis.com/v1/projects/{info['project_id']}"
               f"/databases/(default)/documents/profiles/{uid}")
        r = requests.get(url, headers={"Authorization": f"Bearer {creds.token}"}, timeout=30)
        if r.status_code != 200:
            print(f"account list: Firestore answered HTTP {r.status_code} - using alerts/watchlist.txt only")
            return set()
        profile = {k: _value(v) for k, v in (r.json().get("fields") or {}).items()}
        syms = symbols_in(profile)
        print(f"account list: {len(syms)} symbols from the account's stars and holdings")
        return syms
    except Exception as e:  # noqa: BLE001 - never stop an alert run, never print the key
        print(f"account list: {type(e).__name__} - using alerts/watchlist.txt only")
        return set()


def alert_symbols() -> list[str]:
    return sorted(file_symbols() | account_symbols())
