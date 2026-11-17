"""BSE results archive: which filing stands for which period."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "pipeline"))

import fetch_bse_results as b  # noqa: E402


def test_quarter_and_year_strings():
    assert b.parse_quarter("Consolidated-Mar-22;MQ2021-2022;113.00;c", "Quarter") == ("consolidated", "quarterly", "2022-01-01", "2022-03-31")
    assert b.parse_quarter("Standalone-Mar-22;MQ2021-2022;113.00;D", "Year") == ("standalone", "annual", "2021-04-01", "2022-03-31")
    assert b.parse_quarter("Standalone-Dec-00;DQ2000-2001;28.00;D", "Quarter") == ("standalone", "quarterly", "2000-10-01", "2000-12-31")
    assert b.parse_quarter("Standalone-Sep-26;SQ;131;D", "Half Year") is None
    assert b.parse_quarter("garbage", "Quarter") is None


def row(q, kind="Quarter", cons=None, stand=None, status="New", filed="2022-05-20T15:52:39", revised=None):
    return {"Quarter": q, "Fld_QuarterName": kind, "conso_xbrl_link": cons, "stand_xbrl_link": stand,
            "Status": status, "Filing_Date_Time": filed, "Revised_Date_Time": revised}


def test_pick_prefers_consolidated_then_revised_and_keeps_first_date():
    rows = [
        row("Standalone-Mar-22;x;1;D", stand="/s.xml", filed="2022-05-20T15:00:00"),
        row("Consolidated-Mar-22;x;1;c", cons="/c.xml", filed="2022-05-20T15:30:00"),
        row("Consolidated-Mar-22;x;1;c", cons="/c2.xml", status="Revised", filed=None, revised="2022-06-01T10:00:00"),
        row("Consolidated-Mar-22;x;1;c", kind="Half Year", cons="/h.xml"),
        row("Standalone-Dec-21;x;1;D", stand=None),          # no XBRL: nothing to read
    ]
    got = b.pick(rows)
    assert len(got) == 1
    f = got[0]
    assert f["basis"] == "consolidated" and f["xbrl"].endswith("/c2.xml")
    assert f["filed"] == "2022-05-20"      # the results date is the first filing, not the revision
