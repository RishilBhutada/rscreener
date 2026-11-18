"""derive_quarters: the March quarter filed only inside the full-year results
(owner, 18-Nov-2026: "fix F1" - TCS Mar-2008 to Mar-2011)."""
import pytest

import derive_quarters as dq

FY = [("2008-06-30", "2008-04-01"), ("2008-09-30", "2008-07-01"), ("2008-12-31", "2008-10-01")]


def db(con, quarters=FY, basis=("consolidated",) * 4, annual_rev=1000.0, caps=(10.0,) * 4):
    con.execute("CREATE TABLE results_history (symbol TEXT, basis TEXT, period_type TEXT, period_start TEXT, "
                "period_end TEXT, item TEXT, value REAL)")
    rows = []
    for (pe, ps), b, cap in zip(quarters, basis, caps):
        rows += [("A", b, "quarterly", ps, pe, "revenue", 200.0), ("A", b, "quarterly", ps, pe, "pat", 20.0),
                 ("A", b, "quarterly", ps, pe, "eps", 2.0), ("A", b, "quarterly", ps, pe, "share_capital", cap)]
    b = basis[3]
    rows += [("A", b, "annual", "2008-04-01", "2009-03-31", "revenue", annual_rev),
             ("A", b, "annual", "2008-04-01", "2009-03-31", "pat", 100.0),
             ("A", b, "annual", "2008-04-01", "2009-03-31", "eps", 10.0),
             ("A", b, "annual", "2008-04-01", "2009-03-31", "share_capital", caps[3]),
             ("A", b, "annual", "2008-04-01", "2009-03-31", "equity", 5000.0)]
    con.executemany("INSERT INTO results_history VALUES (?,?,?,?,?,?,?)", rows)
    con.commit()


def test_year_minus_nine_months(con):
    db(con)
    [q] = dq.plan(con)
    assert (q["period_end"], q["period_start"], q["basis"]) == ("2009-03-31", "2009-01-01", "consolidated")
    assert q["items"]["revenue"] == pytest.approx(400.0)
    assert q["items"]["pat"] == pytest.approx(40.0)
    assert q["items"]["eps"] == pytest.approx(4.0)
    assert q["items"]["share_capital"] == 10.0        # a position, not a flow
    assert "equity" not in q["items"]
    dq.apply(con, [q])
    assert con.execute("SELECT value FROM results_history WHERE period_type='quarterly' AND period_end='2009-03-31' "
                       "AND item='revenue'").fetchone()[0] == pytest.approx(400.0)
    assert dq.plan(con) == []                          # on record now: not written twice
    assert con.execute("SELECT COUNT(*) FROM derived_quarters").fetchone()[0] == 1


def test_needs_all_three_quarters(con):
    db(con, quarters=FY[:2], basis=("consolidated",) * 2 + (None, "consolidated"))
    assert dq.plan(con) == []


def test_one_basis_only(con):
    db(con, basis=("consolidated", "standalone", "consolidated", "consolidated"))
    assert dq.plan(con) == []


def test_units_slip_refused(con):
    db(con, annual_rev=600.0 + 200.0 * 1000)            # the year in thousands of the quarters' unit
    assert dq.plan(con) == []
    con2_rows = con.execute("SELECT COUNT(*) FROM results_history WHERE period_end='2009-03-31' "
                            "AND period_type='quarterly'").fetchone()[0]
    assert con2_rows == 0


def test_eps_left_out_across_a_bonus(con):
    db(con, caps=(10.0, 10.0, 20.0, 20.0))
    [q] = dq.plan(con)
    assert "eps" not in q["items"] and q["items"]["pat"] == pytest.approx(40.0)


def test_a_later_real_filing_is_kept_and_unlogged(con):
    db(con)
    dq.apply(con, dq.plan(con))
    con.execute("UPDATE results_history SET value=410.0 WHERE period_type='quarterly' AND period_end='2009-03-31' "
                "AND item='revenue'")                    # the company's own quarter arrived
    assert dq.forget_replaced(con) == 1
    assert con.execute("SELECT COUNT(*) FROM derived_quarters").fetchone()[0] == 0
