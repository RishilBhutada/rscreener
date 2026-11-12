"""Failed data checks, split by a company's first letter (scorecard.py)."""

import json

import scorecard


def test_shard_is_the_first_letter_or_zero():
    assert scorecard.check_shard("RELIANCE") == "R"
    assert scorecard.check_shard("m&m") == "M"
    assert scorecard.check_shard("20MICRONS") == "0"
    assert scorecard.check_shard("") == "0"


def test_every_shard_is_written_and_each_company_lands_in_its_own(tmp_path):
    (tmp_path / "Q.json").write_text("stale", encoding="utf-8")
    fails = {
        "RELIANCE": [["Profit", "2024-03-31", "a"], ["Sales", "2025-03-31", "b"]],
        "3MINDIA": [["Profit", "2025-03-31", "c"]],
    }
    scorecard.write_check_shards(fails, tmp_path, "2026-11-12 00:00 UTC")
    names = sorted(p.stem for p in tmp_path.glob("*.json"))
    assert names == sorted(scorecard.SHARDS) and len(names) == 27
    r = json.loads((tmp_path / "R.json").read_text(encoding="utf-8"))
    # Newest period first within a company.
    assert [f[1] for f in r["fails"]["RELIANCE"]] == ["2025-03-31", "2024-03-31"]
    assert list(json.loads((tmp_path / "0.json").read_text(encoding="utf-8"))["fails"]) == ["3MINDIA"]
    # An empty shard is a file saying "nothing failed", and the stale one is gone.
    assert json.loads((tmp_path / "Q.json").read_text(encoding="utf-8"))["fails"] == {}
