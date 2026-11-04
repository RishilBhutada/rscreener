"""Shared set-up for the pipeline and alert tests.

Every test builds its own small inputs by hand: no network, no real database.
Where a function needs a database connection it gets a tiny SQLite file in a
temporary folder, holding only the rows that test is about.
"""
import sqlite3
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
for sub in ("pipeline", "alerts"):
    p = str(ROOT / sub)
    if p not in sys.path:
        sys.path.insert(0, p)


@pytest.fixture
def con(tmp_path):
    c = sqlite3.connect(tmp_path / "test.db")
    yield c
    c.close()


@pytest.fixture(autouse=True)
def _clear_trend_caches():
    """trend_lib keeps two per-process caches; a test must not see another's rows."""
    import trend_lib
    trend_lib._CROSS_CACHE.clear()
    trend_lib._QSUM_CACHE.clear()
    yield
    trend_lib._CROSS_CACHE.clear()
    trend_lib._QSUM_CACHE.clear()


def make_results_history(con, rows):
    """rows: (symbol, period_type, period_end, item, value[, basis])."""
    con.execute("CREATE TABLE IF NOT EXISTS results_history "
                "(symbol TEXT, basis TEXT, period_type TEXT, period_end TEXT, item TEXT, value REAL)")
    con.executemany("INSERT INTO results_history VALUES (?,?,?,?,?,?)",
                    [(r[0], r[5] if len(r) > 5 else "consolidated", r[1], r[2], r[3], r[4]) for r in rows])
    con.commit()


def make_splits(con, rows):
    """rows: (symbol, date, ratio)."""
    con.execute("CREATE TABLE IF NOT EXISTS splits (symbol TEXT, date TEXT, ratio REAL)")
    con.executemany("INSERT INTO splits VALUES (?,?,?)", rows)
    con.commit()


def make_statements(con, rows):
    """rows: (symbol, stmt_type, period_type, period_end, item, value)."""
    con.execute("CREATE TABLE IF NOT EXISTS statements "
                "(symbol TEXT, stmt_type TEXT, period_type TEXT, period_end TEXT, item TEXT, value REAL)")
    con.executemany("INSERT INTO statements VALUES (?,?,?,?,?,?)", rows)
    con.commit()
