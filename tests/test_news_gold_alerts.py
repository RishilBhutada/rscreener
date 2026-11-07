"""fetch_news.calls_in, export_gold_json.front_series, and the alert helpers."""
import json
import sqlite3

import pytest
import requests

import export_gold_json as gold
import fetch_news
import ntfy_lib
import screen_alerts


# ── fetch_news.calls_in ─────────────────────────────────────────────────────

@pytest.fixture
def tagger():
    c = sqlite3.connect(":memory:")
    c.execute("CREATE TABLE names (alias TEXT PRIMARY KEY, symbol TEXT, exact INTEGER)")
    c.executemany("INSERT INTO names VALUES (?,?,?)", [
        ("TCS", "TCS", 1), ("Wipro", "WIPRO", 0), ("Infosys", "INFY", 0), ("HCLTech", "HCLTECH", 1)])
    return fetch_news.Tagger(c)


def _by_sym(calls):
    return {c["symbol"]: c for c in calls}


def test_calls_in_different_ratings_per_company_in_one_clause(tagger):
    got = _by_sym(fetch_news.calls_in("Jefferies maintains buy on TCS, sell on Wipro", tagger))
    assert got["TCS"]["bucket"] == "Buy"
    assert got["WIPRO"]["bucket"] == "Sell"
    assert all(c["broker"] == "Jefferies" for c in got.values())


def test_calls_in_target_moved_from_x_to_y_gives_y(tagger):
    calls = fetch_news.calls_in("Morgan Stanley raises target on Infosys from Rs 1,500 to Rs 1,800", tagger)
    assert [c["symbol"] for c in calls] == ["INFY"]
    assert calls[0]["target"] == 1800.0
    assert calls[0]["rating"] == "target raised"


def test_calls_in_one_rating_shared_by_several_companies(tagger):
    got = _by_sym(fetch_news.calls_in("Nomura maintains buy on TCS and Infosys, target Rs 4,000", tagger))
    assert set(got) == {"TCS", "INFY"}
    assert {c["bucket"] for c in got.values()} == {"Buy"}


def test_calls_in_needs_a_broker(tagger):
    assert fetch_news.calls_in("TCS shares rise on strong buy interest", tagger) == []


def test_target_of():
    assert fetch_news.target_of("target price of Rs 2,450.50") == 2450.5
    assert fetch_news.target_of("cuts target from ₹900 to ₹750") == 750.0
    assert fetch_news.target_of("no number here") is None


# ── export_gold_json.front_series ───────────────────────────────────────────

def _gold_db(con, bars):
    con.execute("CREATE TABLE commodity_contracts (key TEXT, root TEXT, expiry TEXT)")
    con.execute("CREATE TABLE commodity_bars (key TEXT, date TEXT, close REAL, volume REAL)")
    con.executemany("INSERT INTO commodity_contracts VALUES (?,?,?)",
                    [("GOLDFEB", "GOLD", "2026-02-05"), ("GOLDAPR", "GOLD", "2026-04-05")])
    con.executemany("INSERT INTO commodity_bars VALUES (?,?,?,?)", [(*b, 10.0) for b in bars])
    con.commit()


BARS = [
    ("GOLDFEB", "2026-01-28", 100.0), ("GOLDFEB", "2026-01-29", 101.0), ("GOLDFEB", "2026-01-30", 102.0),
    ("GOLDFEB", "2026-01-31", 103.0), ("GOLDFEB", "2026-02-01", 104.0),
    ("GOLDAPR", "2026-01-28", 110.0), ("GOLDAPR", "2026-01-29", 111.0), ("GOLDAPR", "2026-01-30", 112.0),
    ("GOLDAPR", "2026-01-31", 113.0), ("GOLDAPR", "2026-02-01", 113.0), ("GOLDAPR", "2026-02-02", 114.0),
]


def test_front_series_newest_close_is_the_real_price(con):
    _gold_db(con, BARS)
    s = gold.front_series(con, "GOLD")
    day, last, prev = s.last_two()
    assert (day, last) == ("2026-02-02", 114.0)
    assert prev == pytest.approx(113.0)


def test_front_series_roll_is_not_a_day_move(con):
    _gold_db(con, BARS)
    s = gold.front_series(con, "GOLD")
    # 1-Feb is the roll day (FEB is 4 days from expiry): the APR contract was
    # flat on its own, so the day reads flat - not 113/103, a fake +9.7%.
    day, move = s.move_from("2026-02-01")
    assert day == "2026-02-01"
    assert move == pytest.approx(0.0)
    # a day before the roll is the FEB contract's own move
    day, move = s.move_from("2026-01-31")
    assert move == pytest.approx((103 / 102 - 1) * 100)


def test_front_series_skips_untraded_rows(con):
    _gold_db(con, BARS)
    con.execute("INSERT INTO commodity_bars VALUES ('GOLDAPR', '2026-02-03', 999.0, 0)")
    s = gold.front_series(con, "GOLD")
    assert s.last_two()[0] == "2026-02-02"


# ── alerts/ntfy_lib.sent_tags ───────────────────────────────────────────────

class _Resp:
    def __init__(self, text, ok=True):
        self.text, self.ok, self.status_code = text, ok, 200 if ok else 502


def test_sent_tags_none_on_an_error_page(monkeypatch):
    monkeypatch.setattr(ntfy_lib, "TOPIC", "t")
    monkeypatch.setattr(ntfy_lib.requests, "get", lambda *a, **k: _Resp("<html><body>Bad gateway</body></html>"))
    assert ntfy_lib.sent_tags("res-") is None


def test_sent_tags_none_on_http_error_or_network_failure(monkeypatch):
    monkeypatch.setattr(ntfy_lib, "TOPIC", "t")
    monkeypatch.setattr(ntfy_lib.requests, "get", lambda *a, **k: _Resp("", ok=False))
    assert ntfy_lib.sent_tags("res-") is None

    def boom(*a, **k):
        raise requests.ConnectionError("down")
    monkeypatch.setattr(ntfy_lib.requests, "get", boom)
    assert ntfy_lib.sent_tags("res-") is None


def test_sent_tags_reads_matching_tags(monkeypatch):
    monkeypatch.setattr(ntfy_lib, "TOPIC", "t")
    body = "\n".join(json.dumps(m) for m in [
        {"event": "open"}, {"tags": ["res-TCS", "other"]}, {"tags": ["res-INFY"]}])
    monkeypatch.setattr(ntfy_lib.requests, "get", lambda *a, **k: _Resp(body))
    assert ntfy_lib.sent_tags("res-") == {"res-TCS", "res-INFY"}


# ── alerts/screen_alerts: an unknown member is kept at most 3 nights ────────

def test_unknown_member_kept_at_most_three_nights(tmp_path, monkeypatch):
    data, state = tmp_path / "data.json", tmp_path / "state.json"
    pushes = []
    monkeypatch.setattr(screen_alerts, "DATA", data)
    monkeypatch.setattr(screen_alerts, "STATE", state)
    monkeypatch.setattr(screen_alerts, "load_screens", lambda: [("Cheap", "pe < 10", [])])
    monkeypatch.setattr(screen_alerts, "push", lambda *a, **k: pushes.append(a) or True)

    def night(pe):
        data.write_text(json.dumps({"price_asof": "x", "rows": [{"symbol": "AAA", "pe": pe},
                                                                 {"symbol": "BBB", "pe": 5}]}))
        screen_alerts.main()
        return json.loads(state.read_text())["Cheap"]["symbols"]

    assert night(5) == ["AAA", "BBB"]               # first night: recorded
    assert night(None) == ["AAA", "BBB"]            # 1st night unknown: kept
    assert night(None) == ["AAA", "BBB"]            # 2nd
    assert night(None) == ["AAA", "BBB"]            # 3rd
    assert pushes == []
    assert night(None) == ["BBB"]                   # 4th: counts as gone
    assert len(pushes) == 1 and "-1" in pushes[0][0]


def test_unknown_non_member_is_not_added(tmp_path, monkeypatch):
    data, state = tmp_path / "data.json", tmp_path / "state.json"
    monkeypatch.setattr(screen_alerts, "DATA", data)
    monkeypatch.setattr(screen_alerts, "STATE", state)
    monkeypatch.setattr(screen_alerts, "load_screens", lambda: [("Cheap", "pe < 10", [])])
    monkeypatch.setattr(screen_alerts, "push", lambda *a, **k: True)
    data.write_text(json.dumps({"rows": [{"symbol": "AAA", "pe": 50}]}))
    screen_alerts.main()
    data.write_text(json.dumps({"rows": [{"symbol": "AAA", "pe": None}]}))
    screen_alerts.main()
    assert json.loads(state.read_text())["Cheap"]["symbols"] == []


# ── commodities_lib.back_adjust: the continuous commodity charts ────────────

def test_back_adjust_roll_is_not_a_day_move():
    from commodities_lib import back_adjust
    bar = lambda d, c: (d, c, c, c, c, 10, 5)  # noqa: E731
    days = [
        (bar("2026-01-30", 102.0), 101.0),    # FEB contract
        (bar("2026-01-31", 103.0), 102.0),    # FEB
        (bar("2026-02-01", 113.0), 113.0),    # roll to APR: APR flat on its own day
        (bar("2026-02-02", 114.0), 113.0),    # APR
    ]
    out = back_adjust(days)
    closes = [b[4] for b in out]
    assert closes[-1] == 114.0                                  # newest is the real price
    assert closes[2] / closes[1] == pytest.approx(1.0)          # roll day: APR's own 0%
    assert closes[1] / closes[0] == pytest.approx(103 / 102)    # FEB's own move kept
    assert all(b[5] == 10 for b in out)                         # volume untouched
    assert out[0][1] == out[0][4]                               # open scaled with close


def test_back_adjust_without_a_previous_close_invents_no_move():
    from commodities_lib import back_adjust
    days = [(("d1", 1, 1, 1, 100.0, 0, None), None), (("d2", 1, 1, 1, 120.0, 0, None), None)]
    out = back_adjust(days)
    assert out[0][4] == pytest.approx(120.0) and out[1][4] == 120.0


# ── commodities_lib.futures_day: one date per COMEX session ─────────────────

def test_futures_day_is_the_new_york_trading_day_in_summer_and_winter():
    from datetime import datetime, timezone
    from commodities_lib import futures_day
    ts = lambda s: int(datetime.fromisoformat(s).replace(tzinfo=timezone.utc).timestamp())  # noqa: E731
    # Tuesday 27-Oct-2026's session, stamped at its 6 pm New York open the
    # evening before (summer time) or at midnight New York:
    assert futures_day(ts("2026-10-26T22:00:00")) == "2026-10-27"
    assert futures_day(ts("2026-10-27T04:00:00")) == "2026-10-27"
    # Tuesday 3-Nov-2026, after the clocks went back:
    assert futures_day(ts("2026-11-02T23:00:00")) == "2026-11-03"
    assert futures_day(ts("2026-11-03T05:00:00")) == "2026-11-03"
    # A Monday session opened on Sunday evening is Monday's, never a Sunday row.
    assert futures_day(ts("2026-11-01T23:00:00")) == "2026-11-02"


# ── alerts/etf_premium: one push per crossing ───────────────────────────────

def test_etf_premium_crossing_is_pushed_once(tmp_path, monkeypatch):
    import etf_premium
    (tmp_path / "MON100.json").write_text(json.dumps({"rows": [[20390, 100.0, 99.0, None], [20391, 105.0, 100.0, None]]}))
    monkeypatch.setattr(etf_premium, "ETF_DIR", tmp_path)
    monkeypatch.setattr(etf_premium, "STATE", tmp_path / "state.json")
    monkeypatch.setattr(etf_premium, "load_lines", lambda: {"MON100": 3.0})
    answers, pushed = [False, True, True], []
    monkeypatch.setattr(etf_premium, "post", lambda *a, **k: pushed.append(a[0]) or answers[len(pushed) - 1])
    etf_premium.main()          # Friday night: ntfy refuses - not recorded
    etf_premium.main()          # next night, same data: tried again, accepted
    etf_premium.main()          # the night after, same data: not sent again
    assert len(pushed) == 2 and all("above NAV" in t for t in pushed)
