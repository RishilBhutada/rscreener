"""Mutual funds' monthly holdings (pipeline/mf_holdings_lib.py, fetch_mf_holdings.py)."""
import io
import sqlite3
import zipfile

import openpyxl

import fetch_mf_holdings as f
import mf_holdings_lib as m

A, B, DEBT = "INE040A01034", "INE090A01021", "INE001A07TA1"


def workbook(sheets: dict) -> bytes:
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    for name, rows in sheets.items():
        ws = wb.create_sheet(name)
        for r in rows:
            ws.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


SCHEME = [["SCHEME NAME :", "Some Fund"], [],
          ["Name of the Instrument", "ISIN", "Industry", "Quantity", "Market value (Rs. in Lakhs)", "% to AUM"],
          ["HDFC Bank Ltd.", A, "Banks", 1000, 1500.5, 5.0],
          ["ICICI Bank Ltd.", B, "Banks", 200, 280.0, 1.0],
          ["Some bond", DEBT, "AAA", 50, 500.0, 2.0]]


def test_holdings_sum_across_schemes_and_skip_other_isins():
    data = workbook({"Index": [["Index"]], "S1": SCHEME, "S2": SCHEME[:4]})
    h = m.holdings(data, {A, B})
    assert h[A] == [2000.0, 3001.0, 2] and h[B] == [200.0, 280.0, 1]
    assert DEBT not in h


def test_holdings_inside_a_zip():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("Portfolio.xlsx", workbook({"S1": SCHEME}))
    assert m.holdings(buf.getvalue(), {A})[A][0] == 1000.0


def test_month_from_every_naming_style():
    cases = {
        "all-schemes-monthly-portfolio---as-on-31st-october-2026.xlsx": "2026-10",
        "NIMF-MONTHLY-PORTFOLIO-31-Oct-26.xls": "2026-10",
        "31102026_abslmf_monthlydisclosure.zip": "2026-10",
        "absl_monthly_portfolio_report_july--2026.zip": "2026-07",
        "monthend-portfolios_31_july_2026.zip": "2026-07",
        "PPFAS_Monthly_Portfolio_Report_October_31_2026.xls": "2026-10",   # not 2031
        "Scheme%20Portfolio%20Details%20October%202026.xlsx": "2026-10",
    }
    for name, want in cases.items():
        assert f.month_of(name) == want, name


def test_monthly_change_same_houses_and_after_a_bonus(tmp_path):
    con = sqlite3.connect(tmp_path / "t.db")
    con.execute("CREATE TABLE mf_holdings (month, amc, symbol, shares, value, schemes)")
    con.execute("CREATE TABLE mf_months (amc, month, files, stocks, fetched_at)")
    con.execute("CREATE TABLE splits (symbol, date, ratio)")
    rows = [("2026-09", "X", "AAA", 100, 0, 1), ("2026-10", "X", "AAA", 330, 0, 2),   # 1:2 bonus in Oct: 300 is flat
            ("2026-10", "Y", "AAA", 50, 0, 1)]                                          # Y filed no September
    con.executemany("INSERT INTO mf_holdings VALUES (?,?,?,?,?,?)", rows)
    con.executemany("INSERT INTO mf_months VALUES (?,?,1,1,'')", [("X", "2026-09"), ("X", "2026-10"), ("Y", "2026-10")])
    con.execute("INSERT INTO splits VALUES ('AAA','2026-10-15',3.0)")
    fs = m.screen_fields(con)["AAA"]
    assert fs["mf_month"] == "2026-10" and fs["mf_houses"] == 2 and fs["mf_schemes"] == 3
    assert fs["mf_shares"] == 380
    assert fs["mf_chg_1m_pct"] == 10.0     # X only (Y has no September): 330 vs 100 x 3
