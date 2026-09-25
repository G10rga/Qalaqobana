"""Verification letter rules + lexicon lookup tests."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from app.game.verification import verify_answer


class LetterRuleTests(unittest.TestCase):
    def test_empty_rejected(self):
        v = verify_answer("  ", "city", "ზ")
        self.assertFalse(v.valid)
        self.assertEqual(v.status, "empty")

    def test_single_letter_rejected(self):
        v = verify_answer("ზ", "film", "ზ")
        self.assertFalse(v.valid)

    def test_wrong_letter_rejected(self):
        v = verify_answer("თბილისი", "city", "ზ")
        self.assertFalse(v.valid)
        self.assertFalse(v.letter_ok)


class LexiconTests(unittest.TestCase):
    def test_lexicon_hit_accepted(self):
        with patch("app.game.verification.lexicon.lookup", return_value=True):
            v = verify_answer("ზანზიბარი", "country", "ზ")
        self.assertTrue(v.valid)
        self.assertEqual(v.source, "lexicon")

    def test_lexicon_miss_rejected(self):
        with patch("app.game.verification.lexicon.lookup", return_value=False):
            v = verify_answer("ზანზიბარისკუნძული", "country", "ზ")
        self.assertFalse(v.valid)
        self.assertEqual(v.status, "invalid")

    def test_lookup_not_called_when_letter_wrong(self):
        with patch("app.game.verification.lexicon.lookup") as lookup:
            v = verify_answer("თბილისი", "city", "ზ")
        lookup.assert_not_called()
        self.assertFalse(v.valid)


if __name__ == "__main__":
    unittest.main()
