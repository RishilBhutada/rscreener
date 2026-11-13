"""The filed-EPS checks behind the P/E (13-Nov-2026 accuracy scan):
year-to-date quarters, splits a filing already applied, discontinued operations."""
import oneoffs_lib as ol
from filing_checks import quarters_into_year, ytd_quarters
from trend_lib import restated_quarters

CR = 1e7


def series(rev, dep=None, emp=None, ends=None):
    ends = ends or ["2025-06-30", "2025-09-30", "2025-12-31", "2026-03-31", "2026-06-30", "2026-09-30"]
    out = {"revenue": list(zip(ends, [v * CR for v in rev]))}
    if dep:
        out["depreciation"] = list(zip(ends, [v * CR for v in dep]))
    if emp:
        out["employee_cost"] = list(zip(ends, [v * CR for v in emp]))
    return out


def test_quarters_into_year():
    assert [quarters_into_year(p, 3) for p in ("2026-06-30", "2026-09-30", "2026-12-31", "2027-03-31")] == [1, 2, 3, 4]
    assert quarters_into_year("2026-03-31", 12) == 1     # a December year (ABB)


def test_coal_india_sep_2026_half_year_is_caught():
    # Revenue 90,434 against a run-rate of ~40,000, and depreciation doubled with it.
    s = series([35842, 30187, 34924, 46490, 46255, 90434], dep=[1400, 1420, 1450, 1500, 1480, 2960])
    assert ytd_quarters(s, 3) == {"2026-09-30"}


def test_a_lumpy_quarter_without_a_witness_is_left_alone():
    # A defence maker's big delivery quarter: revenue doubles, depreciation does not.
    s = series([545, 832, 1777, 248, 600, 1150], dep=[30, 31, 31, 32, 32, 33])
    assert ytd_quarters(s, 3) == set()


def test_a_seasonal_business_is_left_alone():
    # Judged from the second season on: the first peak has no year before it.
    ends = ["2023-06-30", "2023-09-30", "2023-12-31", "2024-03-31",
            "2024-06-30", "2024-09-30", "2024-12-31", "2025-03-31",
            "2025-06-30", "2025-09-30", "2025-12-31", "2026-03-31", "2026-06-30", "2026-09-30"]
    rev = [100, 200, 100, 100, 100, 200, 100, 100, 100, 210, 100, 100, 100, 205]
    dep = [10, 20, 10, 10, 10, 20, 10, 10, 10, 21, 10, 10, 10, 20]     # even a cost that moves with the season
    s = {"revenue": list(zip(ends, [v * CR for v in rev])), "depreciation": list(zip(ends, [v * CR for v in dep]))}
    bad = ytd_quarters(s, 3)
    assert "2025-09-30" not in bad and "2026-09-30" not in bad


def test_a_step_that_stays_is_left_alone():
    # An acquisition: revenue and costs double and STAY doubled.
    s = series([100, 100, 100, 100, 100, 200, 205][:6], dep=[10, 10, 10, 10, 10, 20])
    s["revenue"].append(("2026-12-31", 205 * CR))
    assert ytd_quarters(s, 3) == set()


def test_kotak_dec_2025_split_already_in_the_filing():
    # Split 5:1 on 14-Jan-2026; Dec-2025 results out 25-Jan already on the new base.
    ev = [("2026-01-14", 5.0)]
    q = [("2025-06-30", 4429 * CR, 22.49), ("2025-09-30", 4446 * CR, 22.47),
         ("2025-12-31", 4904 * CR, 4.95), ("2026-03-31", 5402 * CR, 5.45)]
    ann = {"2025-12-31": "2026-01-25", "2025-09-30": "2025-10-25"}
    assert restated_quarters(ev, q, ann) == {"2025-12-31": 5.0}


def test_a_filing_on_the_old_base_is_still_adjusted():
    ev = [("2025-02-04", 4.0)]
    q = [("2024-09-30", 100 * CR, 10.0), ("2024-12-31", 110 * CR, 11.0)]   # same share count: not restated
    assert restated_quarters(ev, q, {"2024-12-31": "2025-02-12"}) == {}


def test_no_split_nothing_restated():
    assert restated_quarters(None, [("2025-12-31", 1.0, 1.0)], {}) == {}


def test_discontinued_operations_count_as_one_offs():
    # A Rs 1,500 Cr gain from a business sold, after tax, in a Rs 3,000 Cr year.
    qs = [{"pat": 1800 * CR, "exceptional": 0.0, "pbt": 400 * CR, "tax": 100 * CR, "discontinued": 1500 * CR}] + \
         [{"pat": 400 * CR, "exceptional": 0.0, "pbt": 530 * CR, "tax": 130 * CR}] * 3
    f = ol.core_figures(100.0, 30.0, qs)
    assert f["oneoff_pct"] == 50.0
    assert f["eps_core"] == 15.0 and f["pe_core"] == 6.7


def test_yahoo_share_count_far_off_gives_way_to_the_filings():
    from trend_lib import filed_share_base
    # IndiaMART: Yahoo 60 crore shares, the filings about 6 crore.
    recent = [(153.5 * CR, 25.59), (82.7 * CR, 13.77), (188.3 * CR, 31.37), (50.2 * CR, 8.36), (172.2 * CR, 28.66)]
    assert round(filed_share_base(60.14 * CR, recent) / CR, 1) == 6.0
    # Within 2.5x Yahoo's stands (a group with outside shareholders implies more).
    assert filed_share_base(4.0 * CR, recent) == 4.0 * CR
    assert filed_share_base(None, []) is None
