"""Nifty options for the Options lab (pipeline/optlab_lib.py): research only."""
import io
import zipfile

import optlab_lib as ol


def _zip(name: str, text: str) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr(name, text)
    return buf.getvalue()


OLD = """INSTRUMENT,SYMBOL,EXPIRY_DT,STRIKE_PR,OPTION_TYP,OPEN,HIGH,LOW,CLOSE,SETTLE_PR,CONTRACTS,VAL_INLAKH,OPEN_INT,CHG_IN_OI,TIMESTAMP,
OPTIDX,NIFTY,24-Nov-2016,8100,PE,49.7,117.3,49.7,104.75,104.75,342117,2099189.89,2381250,54900,15-NOV-2016,
OPTIDX,BANKNIFTY,24-Nov-2016,19000,PE,1,2,1,2,2,10,1,1,1,15-NOV-2016,
FUTIDX,NIFTY,24-Nov-2016,0,XX,8100,8200,8000,8110,8110,10,1,1,1,15-NOV-2016,
"""
NEW = """TradDt,FinInstrmTp,TckrSymb,XpryDt,StrkPric,OptnTp,OpnPric,HghPric,LwPric,ClsPric,TtlTradgVol,NewBrdLotQty
2026-11-12,IDO,NIFTY,2026-11-17,25300.00,CE,120.5,140,90,101.25,5000,65
2026-11-12,STO,TITAN,2026-11-23,4700.00,CE,1,1,1,1,1,175
"""


def test_both_layouts_give_the_same_row_shape():
    rows, lot = ol.parse(_zip("fo15NOV2016bhav.csv", OLD))
    assert rows == [("2016-11-15", "2016-11-24", 8100.0, "PE", 49.7, 117.3, 49.7, 104.75, 342117.0)] and lot is None
    rows, lot = ol.parse(_zip("BhavCopy_NSE_FO.csv", NEW))
    assert rows == [("2026-11-12", "2026-11-17", 25300.0, "CE", 120.5, 140.0, 90.0, 101.25, 5000.0)] and lot == 65


def _chain(day, exp, atm, strikes, traded=True):
    out = []
    for k in strikes:
        v = 100.0 if traded else 0.0
        out.append((day, exp, float(k), "CE", 1.0, 1.0, 1.0, max(atm - k, 0) + 50.0, v))
        out.append((day, exp, float(k), "PE", 1.0, 1.0, 1.0, max(k - atm, 0) + 50.0, v))
    return out


def test_at_the_money_is_where_call_and_put_cost_the_same():
    rows = _chain("2026-11-12", "2026-11-17", 25300, range(24000, 26600, 50))
    assert ol.forward_atm(rows) == 25300.0
    assert ol.forward_atm(_chain("2026-11-12", "2026-11-17", 25300, [25300], traded=False)) is None


def test_select_keeps_three_live_expiries_and_strikes_near_the_money():
    rows = []
    for e in ("2026-11-10", "2026-11-17", "2026-11-23", "2026-12-01", "2026-12-08"):   # the first has expired
        rows += _chain("2026-11-12", e, 25300, range(23000, 27600, 50))
    keep = ol.select(rows)
    assert sorted({r[1] for r in keep}) == ["2026-11-17", "2026-11-23", "2026-12-01"]
    assert min(r[2] for r in keep) == 24500.0 and max(r[2] for r in keep) == 26100.0
