"""Time below the 200-day average (pipeline/dma_lib.py)."""
import dma_lib as d


def test_moving_average():
    assert d.moving_average([1, 2, 3, 4], 2) == [None, 1.5, 2.5, 3.5]


def test_spells_counted_and_the_open_one_included():
    # 40 weeks flat at 100 (warm-up), then 60 weeks: a 3-week dip, a 1-week
    # blip (too short to count), then an open 4-week dip at the end.
    closes = [100.0] * 40 + [110.0] * 20 + [80.0] * 3 + [120.0] * 20 + [90.0] + [130.0] * 12 + [50.0] * 4
    st = d.spell_stats(closes, 40)
    assert st["dips"] == 2 and st["median_dip"] == 3 and st["longest_dip"] == 4
    assert st["now_below"] is True and st["run"] == 4
    assert st["pct_below"] == round(8 / st["weeks"] * 100, 1)


def test_too_short_a_history_gives_nothing():
    assert d.spell_stats([100.0] * 80, 40) is None


def test_distance():
    assert d.distance(110.0, 100.0) == 10.0
    assert d.distance(None, 100.0) is None and d.distance(100.0, 0) is None
