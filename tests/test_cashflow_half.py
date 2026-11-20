"""cashflow_half: half-yearly cash flow from results XBRL (owner, 20-Nov-2026:
"yes, add half-yearly cash flow")."""
import sqlite3

import cashflow_half as ch

NS = 'xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:f="http://www.bseindia.com/xbrl/fin"'


def xbrl(contexts: dict[str, tuple[str, str] | None], facts: list[tuple[str, str, str]],
         stated: dict[str, tuple[str, str]] | None = None) -> bytes:
    ctx = "".join(
        f'<xbrli:context id="{cid}"><xbrli:period><xbrli:startDate>{a}</xbrli:startDate>'
        f'<xbrli:endDate>{b}</xbrli:endDate></xbrli:period></xbrli:context>'
        for cid, d in contexts.items() if d for a, b in [d])
    st = "".join(
        f'<f:DateOfStartOfReportingPeriod contextRef="{cid}">{a}</f:DateOfStartOfReportingPeriod>'
        f'<f:DateOfEndOfReportingPeriod contextRef="{cid}">{b}</f:DateOfEndOfReportingPeriod>'
        for cid, (a, b) in (stated or {}).items())
    fs = "".join(f'<f:{tag} contextRef="{cid}" unitRef="INR">{v}</f:{tag}>' for tag, cid, v in facts)
    return f'<xbrli:xbrl {NS}>{ctx}{st}{fs}</xbrli:xbrl>'.encode()


CFO, PPE, INT = ("CashFlowsFromUsedInOperatingActivities", "PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities",
                 "PurchaseOfIntangibleAssetsClassifiedAsInvestingActivities")


def test_parse_takes_correctly_dated_half_year():
    b = xbrl({"OneD": ("2025-07-01", "2025-09-30"), "FourD": ("2025-04-01", "2025-09-30")},
             [(CFO, "FourD", "249440000000"), (PPE, "FourD", "18680000000")])
    assert ch.parse(b) == [("2025-04-01", "2025-09-30", {"cfo": 249440000000.0, "capex_ppe": 18680000000.0})]


def test_stated_dates_beat_a_context_dated_as_the_quarter():
    # TCS Sep-2023: FourD declared 1-Jul..30-Sep, the filer's own facts say 1-Apr
    b = xbrl({"FourD": ("2023-07-01", "2023-09-30")}, [(CFO, "FourD", "100")],
             stated={"FourD": ("2023-04-01", "2023-09-30")})
    assert ch.parse(b) == [("2023-04-01", "2023-09-30", {"cfo": 100.0})]


def test_quarter_dated_column_redated_only_when_the_year_is_known():
    b = xbrl({"FourD": ("2024-01-01", "2024-03-31")}, [(CFO, "FourD", "100")])
    assert ch.parse(b) == []                      # the weekly hook: year unknown, dropped
    assert ch.parse(b, 3) == [("2023-04-01", "2024-03-31", {"cfo": 100.0})]
    # a December-year company's September column is nine months: never a half
    s = xbrl({"FourD": ("2024-07-01", "2024-09-30")}, [(CFO, "FourD", "100")])
    assert ch.parse(s, 12) == []
    assert ch.parse(s, 3) == [("2024-04-01", "2024-09-30", {"cfo": 100.0})]


def test_no_cash_flow_no_columns():
    b = xbrl({"OneD": ("2025-04-01", "2025-06-30")}, [("RevenueFromOperations", "OneD", "5")])
    assert ch.parse(b) == []


def test_halves_second_half_is_year_less_first():
    cols = {("2023-04-01", "2023-09-30"): {"cfo": 220.0, "capex_ppe": 7.0, "capex_intang": 1.0},
            ("2023-04-01", "2024-03-31"): {"cfo": 443.0, "capex_ppe": 22.0, "capex_intang": 4.0}}
    assert ch.halves(cols) == [
        {"start": "2023-04-01", "end": "2023-09-30", "cfo": 220.0, "fcf": 212.0},
        {"start": "2023-10-01", "end": "2024-03-31", "cfo": 223.0, "fcf": 205.0},
    ]


def test_year_without_its_first_half_gives_nothing():
    assert ch.halves({("2020-04-01", "2021-03-31"): {"cfo": 388.0}}) == []


def test_negative_capex_sign_and_missing_capex():
    cols = {("2023-04-01", "2023-09-30"): {"cfo": 100.0, "capex_ppe": -10.0},
            ("2024-04-01", "2024-09-30"): {"cfo": 50.0}}
    hs = ch.halves(cols)
    assert hs[0]["fcf"] == 90.0 and hs[1]["fcf"] is None


def _db(rows):
    con = sqlite3.connect(":memory:")
    ch.ensure_table(con)
    con.executemany("INSERT INTO cashflow_ytd VALUES (?,?,?,?,?,?)", rows)
    return con


def test_load_picks_the_basis_with_more_halves_consolidated_on_tie():
    rows = [("A", "standalone", f"{y}-01-01", f"{y}-06-30", "cfo", 1e7) for y in (2021, 2022, 2023)]
    rows += [("A", "consolidated", "2022-01-01", "2022-06-30", "cfo", 2e7),
             ("A", "consolidated", "2023-01-01", "2023-06-30", "cfo", 2e7)]
    rows += [("B", b, "2023-04-01", "2023-09-30", "cfo", v) for b, v in (("standalone", 1e7), ("consolidated", 3e7))]
    rows += [("B", b, "2024-04-01", "2024-09-30", "cfo", v) for b, v in (("standalone", 1e7), ("consolidated", 3e7))]
    out = ch.load(_db(rows))
    assert out["A"]["basis"] == "standalone" and out["A"]["cfo"] == [1.0, 1.0, 1.0]
    assert out["B"]["basis"] == "consolidated" and out["B"]["cfo"] == [3.0, 3.0]


def test_store_replaces_a_column():
    con = _db([])
    ch.store(con, "A", "consolidated", [("2023-04-01", "2023-09-30", {"cfo": 1.0, "capex_ppe": 2.0})])
    ch.store(con, "A", "consolidated", [("2023-04-01", "2023-09-30", {"cfo": 5.0})])
    assert con.execute("SELECT item, value FROM cashflow_ytd").fetchall() == [("cfo", 5.0)]
