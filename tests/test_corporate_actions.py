"""pipeline/fetch_corporate_actions.py - what a corporate-action notice says."""
import pytest

from fetch_corporate_actions import classify, reshapes, split_detail


@pytest.mark.parametrize("subject,want", [
    ("Fv Split Rs.10/- To Re.1/", "Face value ₹10 → ₹1"),
    ("Face Value Split (Sub-Division) - From Rs 10/- Per Share To Rs 2/- Per Share", "Face value ₹10 → ₹2"),
    ("Interim Dividend - Rs 1.50/- Per Share / Face Value Split - From Rs 10/- Per Share To Rs 5/- Per Share",
     "Face value ₹10 → ₹5 · dividend ₹1.50"),
])
def test_split_ratio_is_read_from_nse_wording(subject, want):
    assert split_detail(subject) == want
    assert classify(subject) == ("split", want)


def test_bonus_ratio_unchanged():
    assert classify("Bonus 1:1") == ("bonus", "1:1")


@pytest.mark.parametrize("kind,subject,want", [
    ("bonus", "Bonus 1:1", True), ("split", "Fv Split Rs.10/- To Re.1/", True), ("rights", "Rights 1:5", True),
    ("other", "Demerger", True), ("other", "Scheme Of Arrangement", True), ("other", "Capital Reduction", True),
    ("other", "Annual General Meeting", False), ("other", "AGM", False),
    ("other", "Extra Ordinary General Meeting", False), ("dividend", "Dividend - Rs 5 Per Share", False),
])
def test_only_share_count_changes_reshape(kind, subject, want):
    assert reshapes(kind, subject) is want
