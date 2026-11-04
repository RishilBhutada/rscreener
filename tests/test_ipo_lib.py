"""pipeline/ipo_lib.py - listing gains against the issue price."""
import ipo_lib
from conftest import make_splits


def _db(con, close, splits=()):
    con.execute("CREATE TABLE ipos (symbol TEXT, company TEXT, listing_date TEXT, price_band TEXT, "
                "issue_price TEXT, security_type TEXT)")
    con.execute("INSERT INTO ipos VALUES ('NEWCO','New Co','2025-03-10','95 to 100','100','EQ')")
    con.execute("CREATE TABLE prices (symbol TEXT, freq TEXT, date TEXT, close REAL)")
    con.execute("INSERT INTO prices VALUES ('NEWCO','daily','2025-03-10',?)", (close,))
    make_splits(con, list(splits))
    con.commit()


def test_listing_gain_plain(con):
    _db(con, 120.0)
    g = ipo_lib.listing_gains(con)["NEWCO"]
    assert g["listing_gain_pct"] == 20.0 and g["listing_close"] == 120.0


def test_a_later_bonus_is_not_a_listing_loss(con):
    # Listed at 120; a 1:1 bonus a year later halves Yahoo's stored close to 60.
    _db(con, 60.0, [("NEWCO", "2026-04-01", 2.0)])
    g = ipo_lib.listing_gains(con)["NEWCO"]
    assert g["listing_gain_pct"] == 20.0 and g["listing_close"] == 120.0


def test_a_split_before_listing_does_not_count(con):
    _db(con, 120.0, [("NEWCO", "2020-01-01", 2.0)])
    assert ipo_lib.listing_gains(con)["NEWCO"]["listing_gain_pct"] == 20.0


def test_junk_issue_price_falls_back_to_the_band(con):
    _db(con, 120.0)
    con.execute("UPDATE ipos SET issue_price='610'")
    assert ipo_lib.listing_gains(con)["NEWCO"]["issue_price"] == 100.0
