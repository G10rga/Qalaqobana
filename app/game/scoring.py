"""Score a finished round from verified answers."""

from __future__ import annotations

from collections import defaultdict

from app.game.constants import (
    SCORE_ONLY_ANSWER,
    SCORE_SAME_WORD,
    SCORE_UNIQUE_WORD,
)
from app.game.models import AnswerVerdict, Room
from app.game.normalize import normalize_for_compare


def compute_round_scores(room: Room) -> tuple[dict[str, dict[str, int]], dict[str, int]]:
    """
    Per category among *valid* answers:
    - only one valid answer in the category → 15
    - unique word (others answered differently) → 10
    - same word as at least one other → 5
    Invalid / empty → 0
    """
    points: dict[str, dict[str, int]] = {
        pid: {cat: 0 for cat in room.categories} for pid in room.players
    }
    totals: dict[str, int] = {pid: 0 for pid in room.players}

    for category in room.categories:
        # player_id -> normalized word for valid answers only
        valid_words: dict[str, str] = {}
        for pid in room.players:
            verdict = _verdict(room, pid, category)
            if verdict and verdict.valid and verdict.normalized:
                valid_words[pid] = verdict.normalized

        if not valid_words:
            continue

        if len(valid_words) == 1:
            only_pid = next(iter(valid_words))
            points[only_pid][category] = SCORE_ONLY_ANSWER
            continue

        # Count how many players share each word
        word_counts: dict[str, int] = defaultdict(int)
        for word in valid_words.values():
            word_counts[word] += 1

        for pid, word in valid_words.items():
            if word_counts[word] >= 2:
                points[pid][category] = SCORE_SAME_WORD
            else:
                points[pid][category] = SCORE_UNIQUE_WORD

    for pid, by_cat in points.items():
        totals[pid] = sum(by_cat.values())

    return points, totals


def apply_round_scores_to_totals(room: Room) -> None:
    for pid, add in room.round_totals.items():
        player = room.players.get(pid)
        if player:
            player.total_score += add


def _verdict(room: Room, player_id: str, category: str) -> AnswerVerdict | None:
    return room.verdicts.get(player_id, {}).get(category)


def compare_key(answer: str) -> str:
    return normalize_for_compare(answer)
