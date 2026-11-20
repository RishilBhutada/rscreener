"""gold_check: cross-checks of the gold page's prices (owner, 20-Nov-2026)."""
from datetime import date, timedelta

import gold_check as gc

DAYS = [(date(2026, 9, 1) + timedelta(days=i)).isoformat() for i in range(40)]


def test_usdinr_close_sources_pass_and_a_bad_day_is_named():
    fred = [(d, 90.0) for d in DAYS]
    yahoo = [(d, 90.09) for d in DAYS]            # 0.1% apart every day
    r = gc.usdinr(yahoo, fred)
    assert r["ok"] and r["median"] == 0.1 and r["n"] == 40
    yahoo[20] = (DAYS[20], 92.7)                  # one day 3% off
    r = gc.usdinr(yahoo, fred)
    assert not r["ok"] and r["worst_day"] == DAYS[20] and r["worst"] == 3.0


def test_usdinr_needs_ten_common_days():
    assert gc.usdinr([(d, 90.0) for d in DAYS[:5]], [(d, 90.0) for d in DAYS[:5]]) is None


def test_parity_flags_a_jump_not_a_steady_premium():
    duty = lambda d: (15.0, "2026-05-13", "")  # noqa: E731
    comex = [(d, 3700.0) for d in DAYS]
    fx = [(d, 92.0) for d in DAYS]
    world = 3700 * 92 * gc.OZ_PER_10G * 1.15
    mcx = [(d, world * 1.01) for d in DAYS]       # a steady 1% premium
    r = gc.parity(mcx, comex, fx, duty)
    assert r["ok"] and r["n_jumps"] == 0 and abs(r["gap_now"] - 1.0) < 0.01
    mcx[25] = (DAYS[25], world * 1.05)            # one stale or wrong close
    r = gc.parity(mcx, comex, fx, duty)
    assert not r["ok"] and r["n_jumps"] == 2 and r["jumps"][0][0] == DAYS[25]


def test_parity_skips_days_missing_a_leg():
    duty = lambda d: (15.0, "", "")  # noqa: E731
    mcx = [(d, 120000.0) for d in DAYS]
    assert gc.parity(mcx, [], [(d, 92.0) for d in DAYS], duty) is None


def test_fresh_counts_from_the_last_weekday():
    # Monday 23 Nov 2026: the newest close a nightly run can have is Friday 20th
    assert gc.expected_day(date(2026, 11, 23)) == date(2026, 11, 20)
    assert gc.fresh("COMEX", [("2026-11-20", 1.0)], date(2026, 11, 23))["ok"]
    r = gc.fresh("COMEX", [("2026-11-10", 1.0)], date(2026, 11, 23))
    assert not r["ok"] and r["behind"] == 10
    assert not gc.fresh("COMEX", [], date(2026, 11, 23))["ok"]


def test_clean_fx_drops_the_26_aug_blip_and_days_off_the_fed():
    # the real case: 95.72, 93.55, 95.43 - no Fed figure yet
    y = [("2026-08-25", 95.72), ("2026-08-26", 93.55), ("2026-08-27", 95.43), ("2026-08-28", 95.47)]
    kept, dropped = gc.clean_fx(y, [])
    assert dropped == ["2026-08-26"] and len(kept) == 3
    # a real step that stays is not a blip
    step = [("2026-08-25", 95.0), ("2026-08-26", 97.0), ("2026-08-27", 97.1)]
    assert gc.clean_fx(step, [])[1] == []
    # with the Fed's figure: more than 1% off it is dropped, close to it kept
    fed = [("2026-08-25", 95.7), ("2026-08-26", 95.6), ("2026-08-27", 95.5)]
    assert gc.clean_fx(y, fed)[1] == ["2026-08-26"]
    assert gc.clean_fx([("2026-08-25", 95.9)], fed)[1] == []


def test_parity_a_contract_roll_is_not_a_wrong_price():
    # live 20-Nov-2026: the Oct-to-Dec switch on 1 Oct stepped the gap +2.19%
    duty = lambda d: (15.0, "2026-05-13", "")  # noqa: E731
    comex = [(d, 3700.0) for d in DAYS]
    fx = [(d, 92.0) for d in DAYS]
    world = 3700 * 92 * gc.OZ_PER_10G * 1.15
    mcx = [(d, world * (1.0 if i < 20 else 1.022), "OCT" if i < 20 else "DEC") for i, d in enumerate(DAYS)]
    r = gc.parity(mcx, comex, fx, duty)
    assert r["ok"] and r["n_jumps"] == 0 and r["rolls"] == 1
    # the same step with no change of contract is still flagged
    same = [(d, v, "DEC") for d, v, _k in mcx]
    assert not gc.parity(same, comex, fx, duty)["ok"]
