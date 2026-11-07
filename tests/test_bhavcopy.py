"""pipeline/fetch_bhavcopy.py - exchange closes laid over the stored history,
and the demerger factors worked out from the exchange files."""
from datetime import datetime, timedelta

import fetch_bhavcopy as bc


def _row(prev, close):
    return {"PrvsClsgPric": str(prev), "ClsPric": str(close), "OpnPric": str(close),
            "HghPric": str(close), "LwPric": str(close), "TtlTradgVol": "100"}


def _extend(files, last):
    written = []
    bc.extend("t", last, files, {"A": "A"}, lambda *a: written.append(a))
    return written


def test_extend_adds_sessions_that_follow_on():
    files = [("2026-11-02", {"A": _row(100, 101)}), ("2026-11-03", {"A": _row(101, 102)})]
    w = _extend(files, {"A": ("2026-10-30", 100.0)})
    assert [(x[1], x[5]) for x in w] == [("2026-11-02", 101.0), ("2026-11-03", 102.0)]


def test_extend_stops_at_a_split_inside_the_window():
    # A 1:1 bonus on the 4th: that day's previous close is on the new basis.
    files = [("2026-11-02", {"A": _row(100, 101)}), ("2026-11-03", {"A": _row(101, 102)}),
             ("2026-11-04", {"A": _row(51, 52)}), ("2026-11-05", {"A": _row(52, 53)})]
    w = _extend(files, {"A": ("2026-10-30", 100.0)})
    assert [x[1] for x in w] == ["2026-11-02", "2026-11-03"]


def test_extend_holds_back_a_mismatch_on_the_first_session():
    files = [("2026-11-02", {"A": _row(50, 51)})]
    assert _extend(files, {"A": ("2026-10-30", 100.0)}) == []


def test_extend_skips_symbols_never_fetched_and_old_sessions():
    files = [("2026-10-29", {"A": _row(99, 100)}), ("2026-11-02", {"A": _row(100, 101)})]
    assert _extend(files, {}) == []
    assert [x[1] for x in _extend(files, {"A": ("2026-10-30", 100.0)})] == ["2026-11-02"]


# ── demerger factors ────────────────────────────────────────────────────────

def _demerger_db(con, ex_dates, stored=()):
    con.execute("CREATE TABLE corporate_actions (symbol TEXT, ex_date TEXT, kind TEXT, detail TEXT, subject TEXT)")
    con.execute("CREATE TABLE universe (SYMBOL TEXT, BSE_CODE TEXT)")
    con.executemany("INSERT INTO corporate_actions VALUES (?,?,?,?,?)",
                    [(s, d, "other", None, "Demerger") for s, d in ex_dates])
    con.execute("""CREATE TABLE price_adjust (symbol TEXT, ex_date TEXT, kind TEXT, factor REAL, prev_close REAL,
        ex_open REAL, source TEXT, applied INTEGER, note TEXT, PRIMARY KEY (symbol, ex_date))""")
    con.executemany("INSERT INTO price_adjust VALUES (?,?,?,?,?,?,?,?,?)", stored)
    con.commit()


def _day(n):
    return (datetime.now(bc.IST).date() + timedelta(days=n)).isoformat()


def _asked(monkeypatch, con, files=None):
    asked = []

    def fake(_s, d):
        asked.append(d.strftime("%Y-%m-%d"))
        return (files or {}).get(d.strftime("%Y-%m-%d"))
    monkeypatch.setattr(bc, "read_nse", fake)
    monkeypatch.setattr(bc, "read_bse", lambda _s, _d: None)
    monkeypatch.setattr(bc.time, "sleep", lambda _x: None)
    bc.demerger_factors(con, None, None)
    return asked


def test_demerger_with_a_future_ex_date_is_not_looked_up(con, monkeypatch):
    _demerger_db(con, [("VED", _day(5))])
    assert _asked(monkeypatch, con) == []
    assert con.execute("SELECT COUNT(*) FROM price_adjust").fetchone()[0] == 0


def test_demerger_lookup_that_failed_recently_is_tried_again(con, monkeypatch):
    ex = _day(-3)
    _demerger_db(con, [("VED", ex)], [("VED", ex, "demerger", None, None, None, None, 0, "no exchange file for the ex-date")])
    prev_day = _day(-4)
    files = {ex: {"VED": {"OpnPric": "290", "ClsPric": "280", "PrvsClsgPric": "774"}},
             prev_day: {"VED": {"ClsPric": "774"}}}
    assert ex in _asked(monkeypatch, con, files)
    f, applied = con.execute("SELECT factor, applied FROM price_adjust WHERE symbol='VED'").fetchone()
    assert applied == 1 and abs(f - 290 / 774) < 1e-6


def test_old_failed_demerger_is_left_alone(con, monkeypatch):
    ex = _day(-60)
    _demerger_db(con, [("VED", ex)], [("VED", ex, "demerger", None, None, None, None, 0, "no exchange file for the ex-date")])
    assert _asked(monkeypatch, con) == []


def test_worked_out_demerger_is_not_asked_again(con, monkeypatch):
    ex = _day(-3)
    _demerger_db(con, [("VED", ex)], [("VED", ex, "demerger", 0.37, 774, 290, "NSE", 1, None)])
    assert _asked(monkeypatch, con) == []
