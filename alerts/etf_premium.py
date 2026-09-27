"""Rscreener alerts - an ETF's premium over its NAV crossing the owner's line.

Reads alerts/etf_premium.txt (SYMBOL PERCENT per line) and the ETF files the
nightly run has just exported (web/public/etf/<SYMBOL>.json). For each listed
ETF it compares the premium on the two latest days that traded: crossing UP
through the line pushes "now X% above NAV", falling back under pushes "back
within X%". Only crossings - an ETF that sits above its line for a month sends
one message, not thirty.

Stateless, like check_announcements.py: the two days come from the data, so a
re-run of the same night can repeat an alert but never lose one. Runs only on
the scheduled nightly (see nightly.yml), once the day's NAVs are out. A data
alert, not a signal - it says where the price is against what the ETF holds.
"""
import json
import os
import sys
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
ETF_DIR = ROOT / "web" / "public" / "etf"
SITE = "https://rishilbhutada.github.io/rscreener"
TOPIC = os.environ.get("NTFY_TOPIC", "")


def push(title: str, message: str, click: str, priority: str = "default") -> None:
    if not TOPIC:
        print(f"no NTFY_TOPIC set; would have pushed: {title} - {message}")
        return
    requests.post(
        f"https://ntfy.sh/{TOPIC}",
        data=message.encode("utf-8"),
        # Header values must be plain ASCII: the rupee sign goes in the body.
        headers={"Title": title, "Priority": priority, "Tags": "bar_chart", "Click": click},
        timeout=15,
    )


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
    sent = 0
    for sym, line in lines.items():
        f = ETF_DIR / f"{sym}.json"
        if not f.exists():
            print(f"  {sym}: no ETF file - not an NSE ETF symbol, or not exported tonight")
            continue
        two = last_two(json.loads(f.read_text(encoding="utf-8")))
        if len(two) < 2:
            continue
        (_, now, px, nav), (_, before, _, _) = two
        click = f"{SITE}/etf/?s={sym}"
        if now >= line > before:
            push(f"{sym}: {now:.1f}% above NAV",
                 f"Price ₹{px:,.2f} against NAV ₹{nav:,.2f} - through your {line:g}% line (was {before:+.1f}%).", click)
            sent += 1
        elif before >= line > now:
            push(f"{sym}: back within {line:g}% of NAV",
                 f"Now {now:+.1f}% (was {before:+.1f}%). Price ₹{px:,.2f}, NAV ₹{nav:,.2f}.", click, "low")
            sent += 1
        else:
            print(f"  {sym}: {now:+.1f}% (was {before:+.1f}%), line {line:g}% - no crossing")
    print(f"ETF premium alerts sent: {sent}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001 - a silent failure looks exactly like "no crossings"
        push("ETF premium check FAILED", f"{type(e).__name__}: {e}"[:300], f"{SITE}/etfs/", "high")
        sys.exit(1)
