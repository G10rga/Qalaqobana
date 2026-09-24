"""Unit tests for scoring and normalization (no network)."""

from __future__ import annotations

import unittest

from app.game.constants import SCORE_ONLY_ANSWER, SCORE_SAME_WORD, SCORE_UNIQUE_WORD
from app.game.models import AnswerVerdict, Player, Room
from app.game.normalize import normalize_for_compare, starts_with_letter
from app.game.scoring import compute_round_scores


def _v(answer: str, valid: bool) -> AnswerVerdict:
    return AnswerVerdict(
        answer=answer,
        normalized=normalize_for_compare(answer),
        letter_ok=valid,
        valid=valid,
        status="valid" if valid else "invalid",
    )


class NormalizeTests(unittest.TestCase):
    def test_georgian_letter(self):
        self.assertTrue(starts_with_letter("თბილისი", "თ"))
        self.assertFalse(starts_with_letter("ბათუმი", "თ"))


class ScoringTests(unittest.TestCase):
    def test_only_answer_gets_15(self):
        room = Room(
            code="TEST1",
            host_id="a",
            players={
                "a": Player(id="a", name="A"),
                "b": Player(id="b", name="B"),
            },
            categories=["city"],
            verdicts={
                "a": {"city": _v("თბილისი", True)},
                "b": {"city": _v("", False)},
            },
        )
        points, totals = compute_round_scores(room)
        self.assertEqual(points["a"]["city"], SCORE_ONLY_ANSWER)
        self.assertEqual(points["b"]["city"], 0)
        self.assertEqual(totals["a"], 15)

    def test_same_word_gets_5(self):
        room = Room(
            code="TEST2",
            host_id="a",
            players={
                "a": Player(id="a", name="A"),
                "b": Player(id="b", name="B"),
            },
            categories=["city"],
            verdicts={
                "a": {"city": _v("თბილისი", True)},
                "b": {"city": _v("თბილისი", True)},
            },
        )
        points, _ = compute_round_scores(room)
        self.assertEqual(points["a"]["city"], SCORE_SAME_WORD)
        self.assertEqual(points["b"]["city"], SCORE_SAME_WORD)

    def test_unique_words_get_10(self):
        room = Room(
            code="TEST3",
            host_id="a",
            players={
                "a": Player(id="a", name="A"),
                "b": Player(id="b", name="B"),
            },
            categories=["city"],
            verdicts={
                "a": {"city": _v("თბილისი", True)},
                "b": {"city": _v("თელავი", True)},
            },
        )
        points, _ = compute_round_scores(room)
        self.assertEqual(points["a"]["city"], SCORE_UNIQUE_WORD)
        self.assertEqual(points["b"]["city"], SCORE_UNIQUE_WORD)


if __name__ == "__main__":
    unittest.main()
