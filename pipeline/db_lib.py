"""Shared SQLite helpers.

Several pipeline steps can run at once (nightly refresh, a long backfill, an
export). WAL lets readers and one writer coexist, but two writers still
serialise and schema changes need an exclusive moment, so every write has to be
prepared to wait rather than die.
"""
import sqlite3
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "rscreener.db"


def connect(db: Path | str = DB, timeout: int = 180) -> sqlite3.Connection:
    con = sqlite3.connect(db, timeout=timeout)
    con.execute(f"PRAGMA busy_timeout={timeout * 1000}")
    try:
        con.execute("PRAGMA journal_mode=WAL")
    except sqlite3.OperationalError:
        pass  # another connection holds it; the existing mode is fine
    return con


def retry(fn, tries: int = 8, delay: float = 2.0):
    """Run a DB statement, waiting out 'database is locked'.

    Anything that is not a lock is re-raised immediately so real errors (bad SQL,
    missing table) still surface instead of being retried into a long stall.
    """
    for attempt in range(tries):
        try:
            return fn()
        except sqlite3.OperationalError as e:
            if "locked" not in str(e).lower() or attempt == tries - 1:
                raise
            time.sleep(delay)
            delay *= 1.5


def ensure(con: sqlite3.Connection, *ddl: str) -> None:
    """CREATE TABLE ... statements, each waiting for its exclusive moment."""
    for stmt in ddl:
        retry(lambda s=stmt: con.execute(s))
    retry(con.commit)
