"""Answer verification via letter rules + local word lexicon (no web)."""

from __future__ import annotations

from app.game import lexicon
from app.game.models import AnswerVerdict
from app.game.normalize import looks_like_word, normalize_answer, normalize_for_compare, starts_with_letter


def verify_answer(answer: str, category: str, letter: str) -> AnswerVerdict:
    raw = normalize_answer(answer)
    normalized = normalize_for_compare(raw)

    if not raw:
        return AnswerVerdict(
            answer="",
            normalized="",
            letter_ok=False,
            valid=False,
            status="empty",
            reason="Empty answer",
        )

    if not looks_like_word(raw):
        return AnswerVerdict(
            answer=raw,
            normalized=normalized,
            letter_ok=False,
            valid=False,
            status="invalid",
            reason="Answer is not a usable word",
        )

    if len(raw) <= 1:
        return AnswerVerdict(
            answer=raw,
            normalized=normalized,
            letter_ok=starts_with_letter(raw, letter),
            valid=False,
            status="invalid",
            reason="Answer too short",
        )

    letter_ok = starts_with_letter(raw, letter)
    if not letter_ok:
        return AnswerVerdict(
            answer=raw,
            normalized=normalized,
            letter_ok=False,
            valid=False,
            status="invalid",
            reason=f"Must start with «{letter}»",
        )

    if lexicon.lookup(raw, category):
        return AnswerVerdict(
            answer=raw,
            normalized=normalized,
            letter_ok=True,
            valid=True,
            status="valid",
            reason="Found in word database",
            source="lexicon",
        )

    return AnswerVerdict(
        answer=raw,
        normalized=normalized,
        letter_ok=True,
        valid=False,
        status="invalid",
        reason="Not in word database",
        source="lexicon",
    )


def verify_player_answers(
    answers: dict[str, str],
    categories: list[str],
    letter: str,
) -> dict[str, AnswerVerdict]:
    out: dict[str, AnswerVerdict] = {}
    for cat in categories:
        out[cat] = verify_answer(answers.get(cat, ""), cat, letter)
    return out
