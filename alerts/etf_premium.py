"""Rscreener alerts - an ETF's premium over its NAV crossing the owner's line.

Reads alerts/etf_premium.txt (SYMBOL PERCENT per line) and the ETF files the
nightly run has just exported (web/public/etf/<SYMBOL>.json). For each listed
ETF it compares the premium on the two latest days that traded: crossing UP
through the line pushes "now X% above NAV", falling back under pushes "back
within X%". Only crossings - an ETF that sits above its line for a month sends
one message, not thirty.

Each crossing is sent once: alerts/etf_premium_state.json (committed by the
nightly with the screen state) remembers the last crossing sent per ETF - its
trading day and direction. Without it the nightly, which runs every day, sent a
Friday crossing again on Saturday and Sunday, and on any day the next NAV was
late (review 5-Nov-2026). A crossing is recorded only once ntfy accepted it, so
a refused push is tried again the next night. Runs only on the scheduled
nightly (see nightly.yml), once the day's NAVs are out. A data alert, not a
signal - it says where the price is against what the ETF holds.
"""
import json
import sys
from pathlib import Path

from ntfy_lib import post

ROOT = Path(__file__).resolve().parents[1]
ETF_DIR = ROOT / "web" / "public" / "etf"
STATE = Path(__file__).with_name("etf_premium_state.json")
SITE = "https://rishilbhutada.github.io/rscreener"


def push(title: str, message: str, click: str, priority: str = "default") -> bool:
    """True only when ntfy accepted it (ntfy_lib.post) - the old push never
    looked at the answer, so a refused push counted as sent."""
    return post(title, message, tags="bar_chart", click=click, priority=priority)


def load_lines() -> dict[str, float]:
    out = {}
    for line in Path(__file__).with_name("etf_premium.txt").read_text(encoding="utf-8").splitlines():
        parts = line.split("#")[0].split()
        if len(parts) >= 2:
            try:
                out[parts[0].upper()] = float(parts[1])
            except ValueError:
                print(f"  skipped a line it could not read: {line.strip()}")
    return out


def last_two(doc: dict) -> list[tuple[int, float, float, float]]:
    """(day, premium %, price, nav) for the two latest days that TRADED."""
    out = []
    for r in reversed(doc.get("rows") or []):
        if r[2] and not (len(r) > 4 and r[4] == 0):
            out.append((r[0], (r[1] / r[2] - 1) * 100, r[1], r[2]))
            if len(out) == 2:
                break
    return out


def main() -> None:
    lines = load_lines()
    print(f"ETF premium lines: {lines}")
    try:
        state = json.loads(STATE.read_text(encoding="utf-8")) if STATE.exists() else {}
    except ValueError:
        state = {}
    sent = 0
    for sym, line in lines.items():
        f = ETF_DIR / f"{sym}.json"
        if not f.exists():
            print(f"  {sym}: no ETF file - not an NSE ETF symbol, or not exported tonight")
            continue
        two = last_two(json.loads(f.read_text(encoding="utf-8")))
        if len(two) < 2:
            continue
        (day, now, px, nav), (_, before, _, _) = two
        click = f"{SITE}/etf/?s={sym}"
        up, down = now >= line > before, before >= line > now
        key = f"{day}:{line:g}:{'up' if up else 'down'}"
        if (up or down) and state.get(sym) == key:
            print(f"  {sym}: crossing of day {day} already sent")
            continue
        ok = False
        if up:
            ok = push(f"{sym}: {now:.1f}% above NAV",
                      f"Price ₹{px:,.2f} against NAV ₹{nav:,.2f} - through your {line:g}% line (was {before:+.1f}%).", click)
        elif down:
            ok = push(f"{sym}: back within {line:g}% of NAV",
                      f"Now {now:+.1f}% (was {before:+.1f}%). Price ₹{px:,.2f}, NAV ₹{nav:,.2f}.", click, "low")
        else:
            print(f"  {sym}: {now:+.1f}% (was {before:+.1f}%), line {line:g}% - no crossing")
        if ok:
            sent += 1
            state[sym] = key
            STATE.write_text(json.dumps(state, indent=1, sort_keys=True), encoding="utf-8")
    print(f"ETF premium alerts sent: {sent}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001 - a silent failure looks exactly like "no crossings"
        push("ETF premium check FAILED", f"{type(e).__name__}: {e}"[:300], f"{SITE}/etfs/", "high")
        sys.exit(1)
