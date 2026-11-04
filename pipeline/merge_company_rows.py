"""Copy one company's rows from this run's database into the newest stored one.

The refetch workflow (refetch.yml) re-reads everything for one company. Its
database was downloaded when it started; by the time it saves, "Publish new
results" or a nightly run may have stored a newer copy. Uploading its whole
file would put that work back. So it downloads the newest copy and moves in
only this company's rows: in every table with a `symbol` column, the newest
copy's rows for the company are replaced by this run's.

Usage:  python pipeline/merge_company_rows.py --from data/rscreener.db --into data/latest.db --symbol TCS
"""
import argparse
import sqlite3


def cols(con, table: str) -> list[str]:
    return [r[1] for r in con.execute(f'PRAGMA table_info("{table}")')]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="src", required=True)
    ap.add_argument("--into", dest="dst", required=True)
    ap.add_argument("--symbol", required=True)
    a = ap.parse_args()
    con = sqlite3.connect(a.dst, timeout=180)
    con.execute("ATTACH DATABASE ? AS src", (a.src,))
    tables = [r[0] for r in con.execute("SELECT name FROM src.sqlite_master WHERE type='table'")]
    moved = 0
    for t in tables:
        sc = [r[1] for r in con.execute(f'PRAGMA src.table_info("{t}")')]
        if "symbol" not in sc:
            continue
        exists = con.execute("SELECT 1 FROM main.sqlite_master WHERE type='table' AND name=?", (t,)).fetchone()
        if not exists:
            ddl = con.execute("SELECT sql FROM src.sqlite_master WHERE type='table' AND name=?", (t,)).fetchone()[0]
            con.execute(ddl)
        dc = cols(con, t)
        shared = [c for c in sc if c in dc]
        names = ", ".join(f'"{c}"' for c in shared)
        con.execute(f'DELETE FROM main."{t}" WHERE symbol=?', (a.symbol,))
        n = con.execute(f'INSERT INTO main."{t}" ({names}) SELECT {names} FROM src."{t}" WHERE symbol=?', (a.symbol,)).rowcount
        moved += n
    con.commit()
    con.execute("DETACH DATABASE src")
    con.close()
    print(f"{a.symbol}: {moved} rows moved into the newest database across {len(tables)} tables checked")


if __name__ == "__main__":
    main()
