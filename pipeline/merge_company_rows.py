"""Copy one company's rows from this run's database into the newest stored one.

The refetch workflow (refetch.yml) re-reads everything for one company. Its
database was downloaded when it started; by the time it saves, "Publish new
results" or a nightly run may have stored a newer copy. Uploading its whole
file would put that work back. So it downloads the newest copy and moves in
only this company's rows - and only in the tables the refetch rewrote.

Which tables those are is read from the data, not from a list: a table is
moved when this company's rows in this run's copy differ from the copy the
refetch started from (--base). It used to be every table with a `symbol`
column, which also put back tables the refetch never touches - alert_log,
result_times, meeting_times - so a results alert sent meanwhile could be sent
again and a result's "out at" time could disappear.

Usage:  python pipeline/merge_company_rows.py --from data/rscreener.db --base base.db --into data/latest.db --symbol TCS
"""
import argparse
import sqlite3


def cols(con, schema: str, table: str) -> list[str]:
    return [r[1] for r in con.execute(f'PRAGMA {schema}.table_info("{table}")')]


def rewritten(con, t: str, shared: list[str], in_base: bool, sym: str) -> bool:
    """True when the refetch changed this company's rows in table t."""
    if not in_base:
        return con.execute(f'SELECT 1 FROM src."{t}" WHERE symbol=? LIMIT 1', (sym,)).fetchone() is not None
    names = ", ".join(f'"{c}"' for c in shared)
    one_way = (f'SELECT 1 FROM (SELECT {names} FROM src."{t}" WHERE symbol=? '
               f'EXCEPT SELECT {names} FROM base."{t}" WHERE symbol=?)')
    other = (f'SELECT 1 FROM (SELECT {names} FROM base."{t}" WHERE symbol=? '
             f'EXCEPT SELECT {names} FROM src."{t}" WHERE symbol=?)')
    return con.execute(f"{one_way} UNION ALL {other} LIMIT 1", (sym, sym, sym, sym)).fetchone() is not None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="src", required=True, help="this refetch's database")
    ap.add_argument("--base", required=True, help="the stored copy this refetch started from")
    ap.add_argument("--into", dest="dst", required=True, help="the newest stored copy; changed in place")
    ap.add_argument("--symbol", required=True)
    a = ap.parse_args()
    con = sqlite3.connect(a.dst, timeout=180)
    con.execute("ATTACH DATABASE ? AS src", (a.src,))
    con.execute("ATTACH DATABASE ? AS base", (a.base,))
    tables = [r[0] for r in con.execute("SELECT name FROM src.sqlite_master WHERE type='table'")]
    base_tables = {r[0] for r in con.execute("SELECT name FROM base.sqlite_master WHERE type='table'")}
    moved, touched, kept = 0, [], []
    for t in tables:
        sc = cols(con, "src", t)
        if "symbol" not in sc:
            continue
        in_base = t in base_tables and "symbol" in cols(con, "base", t)
        bc = cols(con, "base", t) if in_base else sc
        if not rewritten(con, t, [c for c in sc if c in bc], in_base, a.symbol):
            kept.append(t)
            continue
        exists = con.execute("SELECT 1 FROM main.sqlite_master WHERE type='table' AND name=?", (t,)).fetchone()
        if not exists:
            ddl = con.execute("SELECT sql FROM src.sqlite_master WHERE type='table' AND name=?", (t,)).fetchone()[0]
            con.execute(ddl)
        dc = cols(con, "main", t)
        shared = [c for c in sc if c in dc]
        names = ", ".join(f'"{c}"' for c in shared)
        con.execute(f'DELETE FROM main."{t}" WHERE symbol=?', (a.symbol,))
        n = con.execute(f'INSERT INTO main."{t}" ({names}) SELECT {names} FROM src."{t}" WHERE symbol=?', (a.symbol,)).rowcount
        moved += n
        touched.append(t)
    con.commit()
    con.execute("DETACH DATABASE src")
    con.execute("DETACH DATABASE base")
    con.close()
    print(f"{a.symbol}: {moved} rows moved into the newest database, in the {len(touched)} table(s) the refetch "
          f"rewrote: {', '.join(touched) or 'none'}")
    print(f"  left as the newest copy has them ({len(kept)}): {', '.join(kept) or 'none'}")


if __name__ == "__main__":
    main()
