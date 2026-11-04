"""Rscreener - the News page and each stock's Institutions card, from data/news.db.

  web/public/news.json          a week of headlines; 90 days of broker calls;
                                30 days of bulk/block deals; 60 days of SAST
  web/public/inst/<SYMBOL>.json  per company, a year back: its broker calls,
                                deals and SAST filings, and a month of its
                                headlines - only for companies that have any

The company pages do not carry these: the watcher republishes news every
half hour or so, and these small files are all it has to swap in.

Usage:  python pipeline/export_news_json.py [--db data/news.db]
"""
import argparse
import json
import shutil
import sqlite3
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PUB = ROOT / "web" / "public"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(ROOT / "data" / "news.db"))
    a = ap.parse_args()
    out_dir = PUB / "inst"
    if not Path(a.db).exists():
        # No news database yet: an empty page, never a missing file.
        PUB.mkdir(parents=True, exist_ok=True)
        (PUB / "news.json").write_text(json.dumps({"generated_at": None, "items": [], "calls": [], "deals": [], "sast": []}), encoding="utf-8")
        print("news: no database yet - wrote an empty news.json")
        return
    con = sqlite3.connect(f"file:{a.db}?mode=ro", uri=True)
    now = datetime.now(timezone.utc)
    ago = lambda days: (now - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    fetched = (con.execute("SELECT v FROM meta WHERE k='fetched'").fetchone() or [None])[0]

    items = [{"t": t, "title": title, "url": url, "src": src, "syms": json.loads(syms or "[]")}
             for url, t, title, src, syms in con.execute(
                 "SELECT url, t, title, src, syms FROM news WHERE t >= ? ORDER BY t DESC", (ago(7),))]
    calls = [{"t": t, "broker": b, "sym": s, "rating": r, "bucket": bk, "target": tg, "url": u, "title": ti}
             for u, t, b, s, r, bk, tg, ti in con.execute(
                 "SELECT url, t, broker, symbol, rating, bucket, target, title FROM calls WHERE t >= ? ORDER BY t DESC",
                 (ago(90),))]
    deals = [{"d": d, "sym": s, "name": n, "client": c, "side": sd, "qty": q, "price": p, "kind": k,
              "cr": round(q * p / 1e7, 2)}
             for d, s, n, c, sd, q, p, k in con.execute(
                 "SELECT d, symbol, name, client, side, qty, price, kind FROM deals WHERE d >= ? ORDER BY d DESC, qty*price DESC",
                 (ago(30)[:10],))]
    sast = [{"t": t, "sym": s, "company": co, "acquirer": aq, "side": sd, "shares": sh, "after": af,
             "promoter": pr == "Y", "period": pe, "doc": doc}
            for t, s, co, aq, sd, sh, af, pr, pe, doc in con.execute(
                "SELECT t, symbol, company, acquirer, side, shares, after, promoter, period, doc FROM sast "
                "WHERE t >= ? ORDER BY t DESC", (ago(60),))]
    PUB.mkdir(parents=True, exist_ok=True)
    (PUB / "news.json").write_text(json.dumps({
        "generated_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "fetched": fetched,
        "items": items, "calls": calls, "deals": deals, "sast": sast,
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    # Per company, a year back.
    per = defaultdict(lambda: {"calls": [], "deals": [], "sast": [], "news": []})
    for u, t, b, s, r, bk, tg, ti in con.execute(
            "SELECT url, t, broker, symbol, rating, bucket, target, title FROM calls WHERE t >= ? ORDER BY t DESC", (ago(365),)):
        per[s]["calls"].append({"t": t, "broker": b, "rating": r, "bucket": bk, "target": tg, "url": u, "title": ti})
    for d, s, c, sd, q, p, k in con.execute(
            "SELECT d, symbol, client, side, qty, price, kind FROM deals WHERE d >= ? ORDER BY d DESC", (ago(365)[:10],)):
        per[s]["deals"].append({"d": d, "client": c, "side": sd, "qty": q, "price": p, "kind": k, "cr": round(q * p / 1e7, 2)})
    for t, s, aq, sd, sh, af, pr, pe, doc in con.execute(
            "SELECT t, symbol, acquirer, side, shares, after, promoter, period, doc FROM sast WHERE t >= ? ORDER BY t DESC", (ago(365),)):
        per[s]["sast"].append({"t": t, "acquirer": aq, "side": sd, "shares": sh, "after": af, "promoter": pr == "Y",
                               "period": pe, "doc": doc})
    for url, t, title, src, syms in con.execute("SELECT url, t, title, src, syms FROM news WHERE t >= ? ORDER BY t DESC", (ago(30),)):
        for s in json.loads(syms or "[]"):
            if len(per[s]["news"]) < 30:
                per[s]["news"].append({"t": t, "title": title, "url": url, "src": src})
    con.close()
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)
    for s, doc in per.items():
        if s and all(ch.isalnum() or ch in "&-_" for ch in s):
            (out_dir / f"{s}.json").write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"news: {len(items)} headlines, {len(calls)} calls, {len(deals)} deals, {len(sast)} SAST in news.json; "
          f"{len(per)} companies' inst files")


if __name__ == "__main__":
    main()
