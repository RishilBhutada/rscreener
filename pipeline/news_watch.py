"""Rscreener - keeps the News page current through the day (owner, 15-Oct-2026).

Every twenty minutes from 07:00 to 23:59 IST: fetch_news.py (feeds, GDELT,
NSE deals and SAST) into data/news.db, and alerts/update_alerts.py, which
pushes a starred company's quarterly business update. When anything new
arrived, the database is stored on the data-db release (news.db.gz) and "Publish news"
(publish-news.yml) is started - at most every forty minutes, because each
publish is a GitHub Pages deployment and Pages limits how many an hour.

Started each morning by the nightly run; the timed starts in news-watch.yml
are backups (GitHub drops most of them). Hands over to a fresh run before
GitHub's six-hour limit. The nightly run also writes news.db, and starts at
22:00 IST while this still works, so each upload first takes in whatever the
nightly stored meanwhile (take_in_newer).

Usage:  python pipeline/news_watch.py
"""
import filecmp
import gzip
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "news.db"
# The copy last downloaded or stored: what the release held as far as this
# watcher knows. If the release holds something else at upload time, another
# run (the nightly) stored news meanwhile and its rows are taken in first.
BASE = ROOT / "data" / "news.base.db"
IST = timezone(timedelta(hours=5, minutes=30))
REPO = os.environ.get("GITHUB_REPOSITORY", "RishilBhutada/rscreener")
EVERY = 20 * 60
PUBLISH_GAP = 40 * 60
LIFE = 5 * 3600 + 30 * 60


def sh(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(list(args), capture_output=True, text=True)


def download() -> None:
    DB.parent.mkdir(parents=True, exist_ok=True)
    r = sh("gh", "release", "download", "data-db", "--pattern", "news.db.gz", "--dir", str(DB.parent), "--clobber", "-R", REPO)
    gz = DB.parent / "news.db.gz"
    if r.returncode == 0 and gz.exists():
        with gzip.open(gz, "rb") as f, open(DB, "wb") as g:
            shutil.copyfileobj(f, g)
        gz.unlink()
        shutil.copyfile(DB, BASE)
        print(f"news.db: downloaded ({DB.stat().st_size // 1024} KB)")
    else:
        print("news.db: none stored yet - starting a new one (a year of deals is read on the first run)")


def take_in_newer() -> None:
    """The nightly run stores news.db too, and runs past 22:00 IST while this
    watcher still works. Each upload replaces the whole file, so whichever
    stored first used to lose its new rows. Before storing, read the stored
    copy again; if it is not the one this watcher last saw, apply its changes
    to ours (pipeline/merge_stored_db.py). On any failure, store ours as it is."""
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        r = None
        for attempt in range(3):
            r = sh("gh", "release", "download", "data-db", "--pattern", "news.db.gz", "--dir", str(tmp), "--clobber", "-R", REPO)
            if r.returncode == 0:
                break
            time.sleep(20)
        gz = tmp / "news.db.gz"
        if not gz.exists():
            return
        newest = tmp / "newest.db"
        with gzip.open(gz, "rb") as f, open(newest, "wb") as g:
            shutil.copyfileobj(f, g)
        base = BASE
        if not base.exists():
            # Nothing was stored when this watcher started: all of it is new.
            base = tmp / "empty.db"
            sqlite3.connect(base).close()
        elif filecmp.cmp(newest, base, shallow=False):
            return
        print("news.db: another run stored news meanwhile - taking in its rows")
        m = subprocess.run([sys.executable, str(ROOT / "pipeline" / "merge_stored_db.py"),
                            "--base", str(base), "--newest", str(newest), "--into", str(DB)],
                           capture_output=True, text=True)
        print("   " + ((m.stdout or "") + (m.stderr or "")).strip().replace("\n", "\n   "))
        if m.returncode != 0:
            print("news.db: could not merge - storing this watcher's copy as it is")


def upload() -> bool:
    take_in_newer()
    gz = DB.parent / "news.db.gz"
    with open(DB, "rb") as f, gzip.open(gz, "wb") as g:
        shutil.copyfileobj(f, g)
    for attempt in range(3):
        if sh("gh", "release", "upload", "data-db", str(gz), "--clobber", "-R", REPO).returncode == 0:
            shutil.copyfile(DB, BASE)
            return True
        time.sleep(20)
    print("news.db: could not store it")
    return False


def main() -> None:
    born = time.monotonic()
    download()
    first = not DB.exists()
    last_pub = 0.0
    pending = False
    while True:
        now = datetime.now(IST)
        if now.hour == 23 and now.minute >= 59:
            print(f"{now:%H:%M}: the day is over - the nightly run takes over")
            break
        if time.monotonic() - born > LIFE:
            print(f"{now:%H:%M}: handing over to a fresh watcher")
            sh("gh", "workflow", "run", "news-watch.yml", "-R", REPO)
            break
        if now.hour < 7:
            # Started by the nightly before seven: wait for the morning.
            wake = now.replace(hour=7, minute=0, second=0, microsecond=0)
            time.sleep(min((wake - now).total_seconds() + 5, max(60.0, LIFE - (time.monotonic() - born))))
            continue
        args = [sys.executable, str(ROOT / "pipeline" / "fetch_news.py"), "--db", str(DB)]
        if first:
            args += ["--deal-days", "365"]
            first = False
        r = subprocess.run(args, capture_output=True, text=True)
        out = (r.stdout or "") + (r.stderr or "")
        print(f"{now:%H:%M} " + " | ".join(line for line in out.splitlines() if line.startswith(("news:", "deals:", "sast:"))))
        # A starred company's quarterly business update, pushed within twenty
        # minutes (alerts/update_alerts.py; it never repeats one).
        # ...and price alerts set with the bell on a company page
        # (alerts/price_alerts.py; market hours only), and every other
        # announcement from a watched company (alerts/check_announcements.py,
        # which the hourly alerts.yml alone ran - and GitHub dropped most of).
        for script in ("update_alerts.py", "price_alerts.py", "check_announcements.py"):
            u = subprocess.run([sys.executable, str(ROOT / "alerts" / script)], capture_output=True, text=True)
            print("   " + " | ".join(line for line in ((u.stdout or "") + (u.stderr or "")).splitlines()
                                  if line.startswith(("updates:", "price alerts:", "account list:", "announcements:"))))
        m = re.search(r"NEW_ROWS=(\d+)", out)
        if m and int(m.group(1)) > 0:
            pending = True
        if pending and time.monotonic() - last_pub >= PUBLISH_GAP:
            if upload():
                rr = sh("gh", "workflow", "run", "publish-news.yml", "-R", REPO)
                print(f"   publish started: {'ok' if rr.returncode == 0 else rr.stderr.strip()[:120]}")
                last_pub = time.monotonic()
                pending = False
        time.sleep(EVERY)
    if pending and upload():
        sh("gh", "workflow", "run", "publish-news.yml", "-R", REPO)


if __name__ == "__main__":
    main()
