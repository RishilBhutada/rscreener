"""World markets: which session counts as closed, and the change over each span."""

from datetime import datetime, timezone

import world_lib


def ts(day: str, hhmm: str) -> int:
    """A UTC moment as a Unix timestamp."""
    return int(datetime.fromisoformat(f"{day}T{hhmm}:00").replace(tzinfo=timezone.utc).timestamp())


NY = -5 * 3600
# New York: three sessions opening 09:30 local (14:30 UTC), closing 16:00 local (21:00 UTC).
STAMPS = [ts("2026-11-09", "14:30"), ts("2026-11-10", "14:30"), ts("2026-11-11", "14:30")]
CLOSES = [100.0, 101.0, 102.5]


def ny_meta(end_day: str = "2026-11-11") -> dict:
    return {"gmtoffset": NY, "currentTradingPeriod": {"regular": {"end": ts(end_day, "21:00")}}}


def test_local_day_is_the_exchanges_own():
    # 23:30 UTC on the 10th is already the 11th in Tokyo, and still the 10th in New York.
    assert world_lib.local_day(ts("2026-11-10", "23:30"), 9 * 3600) == "2026-11-11"
    assert world_lib.local_day(ts("2026-11-10", "23:30"), NY) == "2026-11-10"


def test_session_in_progress_is_dropped():
    # 22:00 IST is 16:30 UTC: New York is mid-session, its bar is only the last trade.
    rows = world_lib.finished(STAMPS, CLOSES, ny_meta(), ts("2026-11-11", "16:30"))
    assert rows == [("2026-11-09", 100.0), ("2026-11-10", 101.0)]


def test_close_counts_only_after_the_feeds_delay():
    just_after = world_lib.finished(STAMPS, CLOSES, ny_meta(), ts("2026-11-11", "21:10"))
    settled = world_lib.finished(STAMPS, CLOSES, ny_meta(), ts("2026-11-11", "21:30"))
    assert just_after[-1][0] == "2026-11-10"
    assert settled[-1] == ("2026-11-11", 102.5)


def test_a_bar_from_an_earlier_day_is_always_finished():
    # Read the next morning, before the open: nothing is in progress.
    rows = world_lib.finished(STAMPS, CLOSES, ny_meta("2026-11-12"), ts("2026-11-12", "12:00"))
    assert len(rows) == 3


def test_session_end_is_read_as_a_time_of_day():
    # The feed's trading period can describe tomorrow's session; the bell is still 16:00 local.
    rows = world_lib.finished(STAMPS, CLOSES, ny_meta("2026-11-12"), ts("2026-11-11", "21:30"))
    assert rows[-1][0] == "2026-11-11"


def test_a_session_ending_at_midnight_is_never_over_the_same_day():
    meta = {"gmtoffset": 0, "currentTradingPeriod": {"regular": {"end": ts("2026-11-12", "00:00")}}}
    rows = world_lib.finished(STAMPS, CLOSES, meta, ts("2026-11-11", "23:50"))
    assert rows[-1][0] == "2026-11-10"


def test_no_hours_in_the_feed_falls_back_to_the_last_trade():
    now = ts("2026-11-11", "20:00")
    quiet = world_lib.finished(STAMPS, CLOSES, {"gmtoffset": 0, "regularMarketTime": now - 2 * 3600}, now)
    trading = world_lib.finished(STAMPS, CLOSES, {"gmtoffset": 0, "regularMarketTime": now - 600}, now)
    assert quiet[-1][0] == "2026-11-11"
    assert trading[-1][0] == "2026-11-10"


def test_empty_bars_are_skipped_and_a_repeated_day_keeps_the_later_close():
    stamps = [ts("2026-11-09", "14:30"), ts("2026-11-10", "14:30"), ts("2026-11-10", "20:00")]
    rows = world_lib.finished(stamps, [None, 101.0, 101.4], ny_meta(), ts("2026-11-12", "12:00"))
    assert rows == [("2026-11-10", 101.4)]
    assert world_lib.finished([], [], {}, ts("2026-11-12", "12:00")) == []


def test_day_change_is_against_the_close_before():
    m = world_lib.moves([("2026-11-10", 200.0), ("2026-11-11", 203.0)])
    assert (m["date"], m["close"], m["d1"]) == ("2026-11-11", 203.0, 1.5)
    assert m["w1"] is None and m["m1"] is None and m["y1"] is None


def test_day_change_needs_a_recent_close_before():
    # A market back after a long halt: the last close is not "yesterday's".
    assert world_lib.moves([("2026-11-01", 200.0), ("2026-11-11", 203.0)])["d1"] is None
    assert world_lib.moves([("2026-11-11", 203.0)])["d1"] is None


def test_longer_spans_use_the_close_on_or_before_the_date():
    rows = [("2026-10-09", 80.0), ("2026-11-03", 90.0), ("2026-11-05", 95.0), ("2026-11-10", 99.0), ("2026-11-11", 100.0)]
    m = world_lib.moves(rows)
    # A week back from the 11th is the 4th: the close on or before it is the 3rd's.
    assert m["w1"] == round((100 / 90 - 1) * 100, 2)
    # A month back is 12 October: the 9th is three days before it.
    assert m["m1"] == 25.0
    assert m["y1"] is None


def test_a_base_too_far_from_its_date_is_no_base():
    # Eleven days before the week-ago date: not a week's change.
    assert world_lib.moves([("2026-10-24", 90.0), ("2026-11-10", 99.0), ("2026-11-11", 100.0)])["w1"] is None


def test_a_yield_changes_in_points_not_percent():
    m = world_lib.moves([("2026-11-10", 4.864), ("2026-11-11", 4.983)], absolute=True)
    assert m["d1"] == 0.119
    assert m["close"] == 4.983


def test_nothing_read_gives_nothing():
    assert world_lib.moves([]) == {}


def test_every_market_has_a_region_the_page_knows():
    assert {m[3] for m in world_lib.MARKETS} <= set(world_lib.REGIONS)
    syms = [m[0] for m in world_lib.MARKETS] + [e[0] for e in world_lib.EXTRAS]
    assert len(syms) == len(set(syms))
