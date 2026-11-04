"""Carry another run's changes into this run's database before it is stored.

The stored databases (rscreener.db.gz and news.db.gz on the data-db release)
are each written by more than one workflow: download, add to it, upload the
whole file with --clobber. When two runs overlap, whichever uploads last
throws away what the other added - a results run's new quarters and its
alert record, or a morning's headlines.

So before uploading, a run downloads the stored copy again. If it is not the
copy the run started from, another run has stored work meanwhile, and this
applies that work to this run's copy. Three copies are compared:

  base    the stored copy this run started from
  newest  the stored copy now
  ours    this run's copy, about to be uploaded (changed in place)

Whatever changed from base to newest is applied to ours; ours keeps its own
changes. Row by row, in every table:
  - rows the other run removed (or changed) are deleted from ours, but only
    where ours still holds them exactly as they were;
  - rows the other run added (or changed) are written in. In a table with a
    primary key or unique index, its version wins a clash on the key. In a
    table without one, a row is added only if ours does not hold it already.
A table the other run created is copied in whole.

Known limit: in a table with no key, if BOTH runs re-read the same row and
got different values, ours ends up holding both versions. That needs both
runs to rewrite the same company's figures and the source to have changed in
between, which is rare; the next full fetch of that company rewrites it.

Usage:  python pipeline/merge_stored_db.py --base base.db --newest newest.db --into data/rscreener.db
"""
import argparse
import sqlite3
import time


def q(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def tables(con: sqlite3.Connection, schema: str) -> set[str]:
    return {r[0] for r in con.execute(
        f"SELECT name FROM {schema}.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}


def columns(con: sqlite3.Connection, schema: str, t: str) -> list[str]:
    return [r[1] for r in con.execute(f"PRAGMA {schema}.table_info({q(t)})")]


def keyed(con: sqlite3.Connection, schema: str, t: str) -> bool:
    """True when the table has a primary key or a unique index, so
    INSERT OR REPLACE replaces a clashing row instead of adding a second."""
    if any(r[5] for r in con.execute(f"PRAGMA {schema}.table_info({q(t)})")):
        return True
    return any(r[2] for r in con.execute(f"PRAGMA {schema}.index_list({q(t)})"))


def copy_table(con: sqlite3.Connection, t: str) -> int:
    ddl = con.execute("SELECT sql FROM newest.sqlite_master WHERE type='table' AND name=?", (t,)).fetchone()[0]
    con.execute(ddl)
    for (idx,) in con.execute("SELECT sql FROM newest.sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL",
                              (t,)).fetchall():
        con.execute(idx)
    return con.execute(f"INSERT INTO main.{q(t)} SELECT * FROM newest.{q(t)}").rowcount


def merge_table(con: sqlite3.Connection, t: str, in_base: bool) -> tuple[int, int]:
    oc, nc = columns(con, "main", t), columns(con, "newest", t)
    bc = columns(con, "base", t) if in_base else nc
    cols = [c for c in nc if c in oc and c in bc]
    if not cols:
        return 0, 0
    if set(cols) != set(nc) or set(cols) != set(oc):
        print(f"  {t}: columns differ between the copies - merging the {len(cols)} they share")
    names = ", ".join(q(c) for c in cols)
    con.execute("DROP TABLE IF EXISTS temp._added")
    con.execute("DROP TABLE IF EXISTS temp._gone")
    if in_base:
        con.execute(f"CREATE TEMP TABLE _added AS SELECT {names} FROM newest.{q(t)} EXCEPT SELECT {names} FROM base.{q(t)}")
        con.execute(f"CREATE TEMP TABLE _gone AS SELECT {names} FROM base.{q(t)} EXCEPT SELECT {names} FROM newest.{q(t)}")
    else:
        # Both runs created it: nothing to remove, everything of theirs is new.
        con.execute(f"CREATE TEMP TABLE _added AS SELECT {names} FROM newest.{q(t)}")
        con.execute(f"CREATE TEMP TABLE _gone AS SELECT {names} FROM newest.{q(t)} WHERE 0")
    gone = con.execute("SELECT COUNT(*) FROM temp._gone").fetchone()[0]
    added = con.execute("SELECT COUNT(*) FROM temp._added").fetchone()[0]
    removed = written = 0
    if gone:
        match = " AND ".join(f"main.{q(t)}.{q(c)} IS g.{q(c)}" for c in cols)
        removed = con.execute(
            f"DELETE FROM main.{q(t)} WHERE EXISTS (SELECT 1 FROM temp._gone g WHERE {match})").rowcount
    if added:
        if keyed(con, "main", t):
            written = con.execute(f"INSERT OR REPLACE INTO main.{q(t)} ({names}) SELECT {names} FROM temp._added").rowcount
        else:
            written = con.execute(f"INSERT INTO main.{q(t)} ({names}) "
                                  f"SELECT {names} FROM temp._added EXCEPT SELECT {names} FROM main.{q(t)}").rowcount
    con.execute("DROP TABLE temp._added")
    con.execute("DROP TABLE temp._gone")
    return removed, written


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True, help="the stored copy this run started from")
    ap.add_argument("--newest", required=True, help="the stored copy as it is now")
    ap.add_argument("--into", required=True, help="this run's copy; changed in place")
    a = ap.parse_args()
    t0 = time.monotonic()
    # One transaction for the whole merge: a failure part-way leaves ours
    # exactly as it was, never half-merged.
    con = sqlite3.connect(a.into, timeout=180, isolation_level=None)
    con.execute("PRAGMA temp_store=FILE")
    con.execute("ATTACH DATABASE ? AS base", (a.base,))
    con.execute("ATTACH DATABASE ? AS newest", (a.newest,))
    con.execute("BEGIN")
    base, newest, ours = tables(con, "base"), tables(con, "newest"), tables(con, "main")
    changed = 0
    for t in sorted(newest):
        if t not in ours:
            if t in base:
                # This run dropped it on purpose; leave it dropped.
                print(f"  {t}: dropped by this run - not brought back")
                continue
            n = copy_table(con, t)
            print(f"  {t}: new in the stored copy - {n} rows copied in")
            changed += 1
            continue
        removed, written = merge_table(con, t, t in base)
        if removed or written:
            print(f"  {t}: {written} rows written in, {removed} removed (the other run's changes)")
            changed += 1
    con.execute("COMMIT")
    con.execute("DETACH DATABASE base")
    con.execute("DETACH DATABASE newest")
    con.close()
    print(f"merged another run's changes into {a.into}: {changed} table(s) touched, "
          f"{time.monotonic() - t0:.0f}s")


if __name__ == "__main__":
    main()
