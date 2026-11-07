"""pipeline/filing_checks.py and the parts of fetch_results_history.py that
decide what a filing says and whether to store it."""
import pytest

import fetch_results_history as frh
import trend_lib
from conftest import make_results_history
from filing_checks import is_unit_step, unit_outliers


# ── filing_checks ───────────────────────────────────────────────────────────

def test_unit_step():
    assert is_unit_step(100) and is_unit_step(0.01) and is_unit_step(1000) and is_unit_step(1e-5)
    assert is_unit_step(83)                     # CONCOR's 5,108 -> 61.5
    assert not is_unit_step(4) and not is_unit_step(20) and not is_unit_step(0.25)


def _years(vals):
    return [(f"{2010 + i}-03-31", v) for i, v in enumerate(vals)]


def test_a_misread_unit_that_comes_back_is_caught():
    seq = _years([4800, 5000, 5108, 61.5, 6306, 6600, 7000])        # CONCOR FY15
    assert unit_outliers(seq) == {"2013-03-31"}


def test_a_run_of_two_wrong_years_is_caught():
    seq = _years([400, 420, 450, 4.6, 4.8, 500, 520, 540])
    assert unit_outliers(seq) == {"2013-03-31", "2014-03-31"}


def test_a_real_collapse_is_left_alone():
    # A business that stopped: every later year small too.
    assert unit_outliers(_years([230, 240, 250, 2.5, 2.4, 2.6, 2.2])) == set()


def test_first_and_last_periods_are_never_judged():
    assert unit_outliers(_years([2.5, 250, 260, 270])) == set()     # a start-up year
    assert unit_outliers(_years([250, 260, 270, 2.6])) == set()     # judged once the next is filed


def test_ordinary_swings_and_missing_values_pass():
    assert unit_outliers(_years([100, 140, 60, 180, None, 150, 0, 170])) == set()


# ── trend_lib: what is already stored ─────────────────────────────────────

def test_year_equal_to_its_own_march_quarter_is_dropped(con):
    make_results_history(con, [
        ("H", "annual", "2015-03-31", "revenue", 2073.0),
        ("H", "quarterly", "2015-03-31", "revenue", 2073.0),
        ("H", "annual", "2016-03-31", "revenue", 2300.0),
        ("H", "quarterly", "2016-03-31", "revenue", 600.0),
    ])
    assert trend_lib.year_equals_quarter(con) == {"H": {"2015-03-31"}}
    assert "2015-03-31" in trend_lib.annual_unit_outliers(con)["H"]
    assert "2015-03-31" in trend_lib.implausible_quarters(con)["H"]


def test_build_trends_drops_a_misread_year(con):
    rows = []
    for (pe, v) in _years([4800, 5000, 5108, 61.5, 6306, 6600, 7000]):
        rows += [("C", "annual", pe, "revenue", v * 1e7), ("C", "annual", pe, "pat", v * 1e6)]
    make_results_history(con, rows)
    con.execute("CREATE TABLE prices (symbol TEXT, freq TEXT, date TEXT, close REAL)")
    a = trend_lib.build_trends(con, {})["C"]["annual"]
    assert "2013-03-31" not in a["periods"]
    assert "2014-03-31" in a["periods"]


# ── fetch_results_history: what is stored next ─────────────────────────────

def _xbrl(contexts, facts):
    ctx = "".join(
        f'<xbrli:context id="{cid}"><xbrli:period><xbrli:startDate>{a}</xbrli:startDate>'
        f'<xbrli:endDate>{b}</xbrli:endDate></xbrli:period></xbrli:context>' for cid, a, b in contexts)
    fx = "".join(f'<in-bse-fin:RevenueFromOperations contextRef="{cid}">{v}</in-bse-fin:RevenueFromOperations>'
                 for cid, v in facts)
    return (f'<xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" '
            f'xmlns:in-bse-fin="http://www.bseindia.com/xbrl/fin">{ctx}{fx}</xbrli:xbrl>').encode()


Q = ("OneD", "2015-01-01", "2015-03-31")
Y = ("FourD", "2014-04-01", "2015-03-31")


def test_annual_reads_the_year_column():
    x = _xbrl([Q, Y], [("OneD", 600.0), ("FourD", 2300.0)])
    assert frh.parse_xbrl(x, "annual")["revenue"] == 2300.0
    assert frh.parse_xbrl(x, "quarterly")["revenue"] == 600.0


def test_annual_without_a_year_column_stores_nothing():
    x = _xbrl([Q], [("OneD", 600.0)])
    assert frh.parse_xbrl(x, "annual") == {}


def test_annual_whose_first_column_is_the_year_is_read():
    x = _xbrl([("OneD", "2014-04-01", "2015-03-31")], [("OneD", 2300.0)])
    assert frh.parse_xbrl(x, "annual")["revenue"] == 2300.0


def test_a_quarter_column_holding_a_year_is_refused():
    x = _xbrl([("OneD", "2014-04-01", "2015-03-31")], [("OneD", 2300.0)])
    assert frh.parse_xbrl(x, "quarterly") == {}


@pytest.mark.parametrize("header,scale", [("Amount (Rs. in Lakhs)", 1e5), ("Amount (Rs in Lacs)", 1e5),
                                          ("Amount (Rs. in Crores)", 1e7), ("Amount (Rs in Thousands)", 1e3)])
def test_old_sheet_units(header, scale):
    html = (f"<table><tr><td>{header}</td></tr><tr><td>Net Sales/Income from Operations</td><td>1,234.5</td></tr>"
            "<tr><td>Basic EPS after Extraordinary items</td><td>4.2</td></tr></table>")
    facts = frh.parse_old_html(html)
    assert facts["revenue"] == pytest.approx(1234.5 * scale)
    assert facts["eps"] == 4.2


def test_store_refuses_a_units_mistake_between_stored_years(con):
    make_results_history(con, [("C", "annual", pe, "revenue", v * 1e7)
                               for pe, v in _years([4800, 5000, 5108, None, 6306, 6600, 7000]) if v])
    assert frh.units_wrong(con, "results_history", "C", "annual", "2013-03-31", 61.5e7)
    assert not frh.units_wrong(con, "results_history", "C", "annual", "2013-03-31", 5900e7)
    assert not frh.units_wrong(con, "results_history", "C", "annual", "2017-03-31", 70e7)   # newest: not judged


def test_ind_as_tag_wins_over_an_older_one_whatever_the_order():
    ctx = '<xbrli:context id="OneD"><xbrli:period><xbrli:startDate>2015-01-01</xbrli:startDate><xbrli:endDate>2015-03-31</xbrli:endDate></xbrli:period></xbrli:context>'
    for body in ('<f:ProfitLossForPeriod contextRef="OneD">10</f:ProfitLossForPeriod>'
                 '<f:ProfitLossForThePeriod contextRef="OneD">99</f:ProfitLossForThePeriod>',
                 '<f:ProfitLossForThePeriod contextRef="OneD">99</f:ProfitLossForThePeriod>'
                 '<f:ProfitLossForPeriod contextRef="OneD">10</f:ProfitLossForPeriod>'):
        x = (f'<xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:f="http://x">{ctx}{body}</xbrli:xbrl>').encode()
        assert frh.parse_xbrl(x, "quarterly")["pat"] == 10.0
