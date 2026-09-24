"""Room lifecycle tests with verification mocked (no network)."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from app.game.models import AnswerVerdict
from app.game.normalize import normalize_for_compare
from app.game import rooms as game
from app.game.constants import STATE_PLAYING, STATE_RESULTS, STATE_VERIFYING


def _ok(answer: str) -> AnswerVerdict:
    return AnswerVerdict(
        answer=answer,
        normalized=normalize_for_compare(answer),
        letter_ok=True,
        valid=True,
        status="valid",
        reason="mock",
        source="test",
    )


class RoomFlowTests(unittest.TestCase):
    def test_create_start_stop_score(self):
        room, host = game.create_room("Host")
        room2, guest = game.join_room(room.code, "Guest")
        self.assertEqual(room2.code, room.code)

        started = game.start_round(room.code, host.id)
        self.assertEqual(started.state, STATE_PLAYING)
        self.assertTrue(started.letter)

        letter = started.letter
        game.update_answers(
            room.code,
            host.id,
            {cat: f"{letter}aaa" for cat in started.categories},
        )
        game.update_answers(
            room.code,
            guest.id,
            {cat: f"{letter}aaa" for cat in started.categories},
        )

        stopped = game.stop_round(room.code, guest.id)
        self.assertEqual(stopped.state, STATE_VERIFYING)
        self.assertEqual(stopped.stopped_by, guest.id)

        def fake_verify(answers, categories, letter):
            return {cat: _ok(answers.get(cat, "")) for cat in categories}

        with patch("app.game.rooms.verify_player_answers", side_effect=fake_verify):
            done = game.run_verification(room.code)

        self.assertEqual(done.state, STATE_RESULTS)
        self.assertTrue(done.verification_done)
        # same answers → 5 each category
        self.assertEqual(done.round_totals[host.id], 5 * len(done.categories))
        self.assertEqual(done.round_totals[guest.id], 5 * len(done.categories))


if __name__ == "__main__":
    unittest.main()
