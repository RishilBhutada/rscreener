"""gold_lib: elections and the hand-kept world events (owner, 20-Nov-2026:
"include more imp events too like elections of us etc")."""
import re
from datetime import date

from gold_lib import FAMILIES, MEASURE_ON_MCX, WORLD_EVENTS, us_elections


def test_us_elections_follow_the_law():
    got = dict(us_elections(2000, 2028))
    # known election days
    assert got["2000-11-07"] == "US presidential election"
    assert got["2016-11-08"] == "US presidential election"
    assert got["2022-11-08"] == "US midterm election"
    assert got["2024-11-05"] == "US presidential election"
    assert got["2026-11-03"] == "US midterm election"
    assert got["2028-11-07"] == "US presidential election"
    # 1 Nov on a Tuesday: the election is the 8th, not the 1st
    assert "2022-11-01" not in got
    assert all(date.fromisoformat(d).weekday() == 1 for d in got)
    assert len(got) == 15


def test_world_events_are_well_formed():
    zones = {"NY", "IST", "UTC"}
    keys = set()
    for d, hm, zone, fam, ctry, title, src in WORLD_EVENTS:
        date.fromisoformat(d)
        assert re.fullmatch(r"\d\d:\d\d", hm) and zone in zones
        assert fam in FAMILIES and ctry and title and src
        assert (fam, d) not in keys      # the stored key is world|family|date
        keys.add((fam, d))
        # a date only trackers have reported says so, in the title or the source
        if "reported" in src.lower().split(":")[0]:
            assert "reported" in title.lower()
    assert "india_election" in MEASURE_ON_MCX
