"""Derivatives for the Lab (pipeline/optlab_lib.py): research only."""
import optlab_lib as ol

OLD = """INSTRUMENT,SYMBOL,EXPIRY_DT,STRIKE_PR,OPTION_TYP,OPEN,HIGH,LOW,CLOSE,SETTLE_PR,CONTRACTS,VAL_INLAKH,OPEN_INT,CHG_IN_OI,TIMESTAMP,
OPTIDX,NIFTY,24-Nov-2016,8100,PE,49.7,117.3,49.7,104.75,104.75,342117,2099189.89,2381250,54900,15-NOV-2016,
OPTIDX,NIFTYIT,24-Nov-2016,19000,PE,1,2,1,2,2,10,1,1,1,15-NOV-2016,
FUTIDX,NIFTY,24-Nov-2016,0,XX,8100,8200,8000,8110,8110,10,1,1,1,15-NOV-2016,
OPTSTK,TITAN,24-Nov-2016,300,CE,5,6,4,5.5,5.5,20,1,700,1,15-NOV-2016,
"""
NEW = """TradDt,FinInstrmTp,TckrSymb,XpryDt,StrkPric,OptnTp,OpnPric,HghPric,LwPric,ClsPric,TtlTradgVol,OpnIntrst,UndrlygPric,NewBrdLotQty
2026-11-12,IDO,NIFTY,2026-11-17,25300.00,CE,120.5,140,90,101.25,5000,900,25299.35,65
2026-11-12,IDF,NIFTY,2026-11-26,,,25310,25400,25200,25350,800,100,25299.35,65
2026-11-12,IDO,NIFTYNXT50,2026-11-26,70000.00,CE,1,1,1,1,1,1,69000,25
2026-11-12,STO,TITAN,2026-11-23,4700.00,PE,10,12,9,11,30,400,4844.9,175
"""


def test_both_layouts_give_the_same_shapes():
    day, syms, lots = ol.parse(OLD)
    assert day == "2016-11-15" and set(syms) == {"NIFTY", "TITAN"} and lots == {}
    assert syms["NIFTY"]["opt"] == [("2016-11-24", 8100.0, "PE", 49.7, 104.75, 342117.0, 2381250.0)]
    assert syms["NIFTY"]["fut"] == [("2016-11-24", 8100.0, 8110.0, 10.0)]
    day, syms, lots = ol.parse(NEW)
    assert day == "2026-11-12" and set(syms) == {"NIFTY", "TITAN"}       # an index outside the list is left out
    assert syms["NIFTY"]["und"] == 25299.35 and lots == {"NIFTY": 65, "TITAN": 175}
    assert syms["NIFTY"]["fut"] == [("2026-11-26", 25310.0, 25350.0, 800.0)]


def _chain(exp, atm, strikes, traded=True):
    out = []
    for k in strikes:
        v = 100.0 if traded else 0.0
        out.append((exp, float(k), "CE", 1.0, max(atm - k, 0) + 50.0, v, 10.0))
        out.append((exp, float(k), "PE", 2.0, max(k - atm, 0) + 50.0, v, 20.0))
    return out


def test_at_the_money_is_where_call_and_put_cost_the_same():
    assert ol.forward_atm(_chain("2026-11-17", 25300, range(24000, 26600, 50))) == 25300.0
    assert ol.forward_atm(_chain("2026-11-17", 25300, [25300], traded=False)) is None


def test_pack_keeps_live_expiries_a_grid_round_the_money_and_the_ratio():
    opt = []
    for e in ("2026-11-10", "2026-11-17", "2026-11-23", "2026-12-01", "2026-12-08"):   # the first has expired
        opt += _chain(e, 25300, range(23000, 27600, 50))
    rec = {"opt": opt, "fut": [("2026-11-26", 25310.0, 25350.0, 800.0), ("2026-10-29", 1.0, 1.0, 1.0)], "und": 25299.35}
    p = ol.pack("NIFTY", "2026-11-12", rec)
    assert [e[0] for e in p["e"]] == ["2026-11-17", "2026-11-23", "2026-12-01"]
    e = p["e"][0]
    assert e[1] == 25300 - 12 * 50 and e[2] == 50 and len(e[3]) == 25
    assert e[4][12] == 50.0 and e[6][12] == 50.0 and e[3][12] == 1.0 and e[5][12] == 2.0
    assert p["f"] == [["2026-11-26", 25310.0, 25350.0]] and p["pcr"] == 2.0 and p["u"] == 25299.35
    assert len(ol.pack("TITAN", "2026-11-12", rec)["e"]) == 2 and len(ol.pack("TITAN", "2026-11-12", rec)["e"][0][3]) == 7


def test_untraded_contracts_have_no_price():
    p = ol.pack("NIFTY", "2026-11-12", {"opt": _chain("2026-11-17", 25300, range(25250, 25400, 50)) + [("2026-11-17", 25400.0, "CE", 9.0, 9.0, 0.0, 5.0)], "fut": [], "und": None})
    e = p["e"][0]
    assert e[4][14] is None                     # 25,400 call: listed, did not trade


def test_fii_long_share_from_three_title_styles():
    body = "\nClient Type,Future Index Long,Future Index Short\nFII,84555,126713\n"
    assert ol.fii_long_pct('"x as on Nov 15 2019"' + body) == ("2019-11-15", 40.0)
    assert ol.fii_long_pct("x as on June 01, 2017,," + body)[0] == "2017-06-01"
    assert ol.fii_long_pct("x as on Jan 03,2022" + body)[0] == "2022-01-03"
    assert ol.fii_long_pct("no date here" + body) is None
