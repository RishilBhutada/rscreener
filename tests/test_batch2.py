"""Small rules fixed in batch 2 (review 4-Nov-2026)."""

import fetch_prices
import screen_fields
from test_screen_ratios_backtest import _f_score_db


def _bars(closes):
    return [(f"2026-01-{i + 1:02d}", c, c, c, c, 1) for i, c in enumerate(closes)]


def test_bad_print_both_ways():
    up, n1 = fetch_prices.drop_spikes(_bars([100, 400, 101]))
    down, n2 = fetch_prices.drop_spikes(_bars([100, 20, 101]))
    assert (n1, n2) == (1, 1)
    assert [b[4] for b in up] == [100, 101] and [b[4] for b in down] == [100, 101]


def test_a_real_move_is_kept():
    kept, n = fetch_prices.drop_spikes(_bars([100, 20, 21, 22]))     # a crash that stays
    assert n == 0 and len(kept) == 4


def test_piotroski_debt_missing_in_one_year_gives_no_score(con):
    _f_score_db(con, with_split=True)
    con.execute("DELETE FROM statements WHERE item='Long Term Debt' AND period_end=(SELECT MAX(period_end) FROM statements)")
    con.commit()
    assert "S" not in screen_fields.piotroski(con)


def test_piotroski_debt_free_both_years_still_scores(con):
    _f_score_db(con, with_split=True)
    con.execute("DELETE FROM statements WHERE item='Long Term Debt'")
    con.commit()
    assert "S" in screen_fields.piotroski(con)


def test_cfo_over_the_ebitda_shown_and_consolidated_years_only():
    from export_company_json import cfo_ebitda
    cf = {"periods": ["2025-03-31", "2026-03-31"], "items": [{"label": "Cash from Operations", "values": [90.0, 120.0]}]}
    an = {"periods": ["2025-03-31", "2026-03-31"], "ebitda": [100.0, 100.0], "ebitda_oi": [120.0, 150.0],
          "basis": ["consolidated", "standalone"]}
    cfo_ebitda(cf, an)
    assert cf["items"][-1] == {"label": "CFO / EBITDA %", "values": [75, None]}
