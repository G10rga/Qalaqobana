"""Verification lexicon / geography acceptance tests."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from app.game.verification import verify_answer


class LexiconTests(unittest.TestCase):
    def test_zanzibar_country(self):
        v = verify_answer("ზანზიბარი", "country", "ზ")
        self.assertTrue(v.valid)
        self.assertEqual(v.source, "lexicon")

    def test_zurich_spellings(self):
        for spelling in ("ზურიხი", "ზურიკი"):
            with self.subTest(spelling=spelling):
                v = verify_answer(spelling, "city", "ზ")
                self.assertTrue(v.valid, spelling)
                self.assertEqual(v.source, "lexicon")

    def test_single_letter_rejected(self):
        v = verify_answer("ზ", "film", "ზ")
        self.assertFalse(v.valid)

    def test_sioni_water_not_a_river(self):
        v = verify_answer("სიონის წყალი", "river", "ს")
        self.assertFalse(v.valid)
        self.assertIn("წყალი", v.reason)


class GeoWikiFallbackTests(unittest.TestCase):
    def test_geo_title_hit_accepted_for_country(self):
        fake = {
            "found": True,
            "matched": False,
            "title_close": True,
            "reason": "hit",
            "source": "ka.wikipedia.org:Test",
        }
        with patch("app.game.verification._wikipedia_check", return_value=fake):
            v = verify_answer("ზანზიბარისკუნძული", "country", "ზ")
            self.assertTrue(v.valid)
            self.assertEqual(v.status, "uncertain")

    def test_geo_title_hit_not_enough_for_river(self):
        fake = {
            "found": True,
            "matched": False,
            "title_close": True,
            "reason": "hit",
            "source": "ka.wikipedia.org:Test",
        }
        with patch("app.game.verification._wikipedia_check", return_value=fake):
            # bypass phrase reject with a name that isn't "... წყალი"
            v = verify_answer("სიონიტესტი", "river", "ს")
            self.assertFalse(v.valid)


if __name__ == "__main__":
    unittest.main()
