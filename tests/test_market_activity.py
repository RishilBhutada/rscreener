"""The exchanges' daily activity files (pipeline/market_activity_lib.py),
parsed from samples cut down from the real 12-Nov-2026 files."""
import io
import sqlite3
import zipfile

import market_activity_lib as m

DELIV = """SYMBOL, SERIES, DATE1, PREV_CLOSE, OPEN_PRICE, HIGH_PRICE, LOW_PRICE, LAST_PRICE, CLOSE_PRICE, AVG_PRICE, TTL_TRD_QNTY, TURNOVER_LACS, NO_OF_TRADES, DELIV_QTY, DELIV_PER
TITAN, EQ, 12-Nov-2026, 4900, 4910, 4990, 4890, 4950, 4950.5, 4948.59, 732932, 36270, 67478, 395514, 53.96
21STCENMGM, BE, 12-Nov-2026, 56.58, 55.45, 58.39, 54.20, 55.00, 55.04, 55.97, 12850, 7.19, 129, -, -
"""


def test_delivery_keeps_the_eq_series_only():
    assert m.delivery(DELIV) == [("TITAN", "2026-11-12", 4948.59, 732932.0, 67478.0, 395514.0, 53.96)]


def test_fo_open_interest_adds_every_expiry_and_skips_indices():
    head = "TradDt,FinInstrmTp,TckrSymb,OptnTp,OpnIntrst,ChngInOpnIntrst\n"
    rows = ["2026-11-12,STF,TITAN,,4000000,-100000", "2026-11-12,STF,TITAN,,1000000,-25300",
            "2026-11-12,STO,TITAN,CE,300,0", "2026-11-12,STO,TITAN,PE,150,0", "2026-11-12,IDF,NIFTY,,9,9"]
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("BhavCopy_NSE_FO.csv", head + "\n".join(rows))
    assert m.fo_oi(buf.getvalue()) == [("TITAN", "2026-11-12", 5000000.0, -125300.0, 300.0, 150.0)]


def test_participant_open_interest_reads_the_date_from_the_title():
    text = ('""Participant wise Open Interest (no. of contracts) in Equity Derivatives as on Nov 12, 2026"",,,\n'
            "Client Type,Future Index Long,Future Index Short,Future Stock Long,Future Stock Short\n"
            "FII,70744,120463,3576742,2551402\nTOTAL,1,1,1,1\n")
    assert m.participant(text) == [("2026-11-12", "FII", 70744.0, 120463.0, 3576742.0, 2551402.0)]


def test_short_selling_and_fii_dii():
    assert m.short_sell('"Security Name","Symbol Name","Trade Date","Quantity"\n"ITC LTD","ITC","11-Nov-2026","50"\n') \
        == [("ITC", "2026-11-11", 50.0)]
    js = [{"buyValue": "11745.95", "category": "DII", "date": "13-Nov-2026", "netValue": "-2253.58", "sellValue": "13999.53"},
          {"buyValue": "18339.57", "category": "FII/FPI", "date": "13-Nov-2026", "netValue": "5736.55", "sellValue": "12603.02"}]
    assert m.fii_dii(js) == [("2026-11-13", "DII", 11745.95, 13999.53, -2253.58), ("2026-11-13", "FII", 18339.57, 12603.02, 5736.55)]


def test_surveillance_lists_and_an_empty_ban_list():
    asm = {"longterm": {"data": [{"symbol": "A2ZINFRA", "asmSurvIndicator": "Stage I"}]}, "shortterm": {"data": []}}
    gsm = [{"symbol": "AGSTRA", "gsmStage": "LXII"}]
    assert m.surveillance(asm, gsm, "Securities in Ban For Trade Date 16-NOV-2026: NIL") == \
        [("A2ZINFRA", "ASM-LT", "Stage I"), ("AGSTRA", "GSM", "LXII")]
    assert m.surveillance({}, [], "Securities in Ban For Trade Date 16-NOV-2026:\n1,SAIL") == [("SAIL", "FO-BAN", "")]


def test_pledge_matches_by_name_and_drops_a_share_of_almost_nothing():
    js = {"data": [
        {"comName": "Titan Company Limited", "numSharesPledged": "1000", "totPromoterHolding": "50000",
         "totIssuedShares": "100000", "percPromoterHolding": "50", "shp": "30-Sep-2026"},
        # ITC: promoters hold 0.02%, so pledged / promoter holding is 8,202%.
        {"comName": "ITC Limited", "numSharesPledged": "8202", "totPromoterHolding": "100",
         "totIssuedShares": "404000", "percPromoterHolding": "0.02", "shp": "30-Sep-2026"},
        {"comName": "Unknown Co Ltd", "numSharesPledged": "1", "totPromoterHolding": "1", "totIssuedShares": "1"},
    ]}
    rows, missed = m.pledge(js, {"TITAN": "Titan Company Limited", "ITC": "ITC Ltd"})
    assert rows == [("TITAN", "2026-09-30", 2.0, 1.0, 50.0), ("ITC", "2026-09-30", None, 2.03, 0.02)]
    assert missed == ["Unknown Co Ltd"]


def test_screen_fields_from_stored_days(tmp_path):
    con = sqlite3.connect(tmp_path / "t.db")
    con.execute("CREATE TABLE deliv (symbol, date, vwap, traded_qty, trades, deliv_qty, deliv_pct)")
    days = [f"2026-10-{d:02d}" for d in range(1, 21)] + ["2026-11-12"]
    con.executemany("INSERT INTO deliv VALUES (?,?,?,?,?,?,?)",
                    [("AAA", d, 100.0, 1000.0, 10.0, 300.0 if d == "2026-11-12" else 100.0, 30.0) for d in days])
    con.execute("CREATE TABLE surveillance (symbol, list, stage, as_of)")
    con.execute("INSERT INTO surveillance VALUES ('BBB','ASM-LT','Stage I','x')")
    f = m.screen_fields(con)
    assert f["AAA"]["deliv_pct"] == 30.0 and f["AAA"]["deliv_x"] == 3.0 and f["AAA"]["deliv_pct_20d"] == 30.0
    assert f["BBB"] == {"surv": "ASM-LT Stage I", "in_surv": 1}


MTO = """Security Wise Delivery Position - Compulsory Rolling Settlement
10,MTO,15112016,622503471,0001661
Trade Date <15-NOV-2016>,Settlement Type <N>,Settlement No <2016214>,Settlement Date <17-NOV-2016>
Record Type,Sr No,Name of Security,Quantity Traded,Deliverable Quantity(gross across client level),% of Deliverable Quantity to Traded Quantity
20,1,20MICRONS,EQ,212023,115694,54.57
20,2,SOMEBOND,N1,100,100,100.00
"""


def test_mto_reads_the_eq_series_and_the_trade_date():
    assert m.mto(MTO) == [("20MICRONS", "2016-11-15", 212023.0, 115694.0)]


def test_bse_delivery_maps_scrip_codes_to_symbols():
    text = ("DATE|SCRIP CODE|DELIVERY QTY|DELIVERY VAL|DAY'S VOLUME|DAY'S TURNOVER|DELV. PER.\n"
            "12112026|532144|0000000000058694|0000000126755563|0000000000112132|0000000243242226|052.34\n"
            "12112026|999999|0000000000000001|0000000000000001|0000000000000002|0000000000000002|050.00\n")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("SCBSEALL1211.TXT", text)
    assert m.bse_delivery(buf.getvalue(), {"532144": "ABC"}) == [("ABC", "2026-11-12", 112132.0, 58694.0)]


def test_week_end_is_that_weeks_friday():
    assert m.week_end("2026-11-09") == "2026-11-13"     # Monday
    assert m.week_end("2026-11-13") == "2026-11-13"     # Friday
    assert m.week_end("2026-11-08") == "2026-11-06"     # Sunday Muhurat session: the week before


def test_daily_history_packs_by_stock_year_and_merges(tmp_path, monkeypatch):
    import json
    import fetch_volume_split as fv
    monkeypatch.setattr(fv, "DB", tmp_path / "t.db")
    con = fv.connect()
    fv.flush_daily(con, {("ABC", "2016"): {"1115": [212023, 115694]}}, [("nse", "2016-11-15")])
    fv.flush_daily(con, {("ABC", "2016"): {"1116": [100, 40]}}, [("nse", "2016-11-16")])
    data = json.loads(con.execute("SELECT data FROM vol_daily WHERE symbol='ABC' AND year='2016'").fetchone()[0])
    assert data == {"1115": [212023, 115694], "1116": [100, 40]}
    assert con.execute("SELECT COUNT(*) FROM vol_daily_days").fetchone()[0] == 2
