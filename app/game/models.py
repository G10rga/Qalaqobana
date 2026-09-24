"""In-memory room / player models and serialization for the client."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.game.constants import STATE_LOBBY


@dataclass
class Player:
    id: str
    name: str
    sid: str | None = None
    connected: bool = True
    total_score: int = 0

    def public_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "connected": self.connected,
            "total_score": self.total_score,
        }


@dataclass
class AnswerVerdict:
    answer: str
    normalized: str
    letter_ok: bool
    valid: bool
    status: str  # valid | invalid | uncertain | empty
    reason: str = ""
    source: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "answer": self.answer,
            "normalized": self.normalized,
            "letter_ok": self.letter_ok,
            "valid": self.valid,
            "status": self.status,
            "reason": self.reason,
            "source": self.source,
        }


@dataclass
class Room:
    code: str
    host_id: str
    players: dict[str, Player] = field(default_factory=dict)
    categories: list[str] = field(default_factory=list)
    state: str = STATE_LOBBY
    letter: str | None = None
    round_number: int = 0
    # player_id -> category -> raw answer
    answers: dict[str, dict[str, str]] = field(default_factory=dict)
    # player_id -> category -> AnswerVerdict
    verdicts: dict[str, dict[str, AnswerVerdict]] = field(default_factory=dict)
    # player_id -> category -> points this round
    round_points: dict[str, dict[str, int]] = field(default_factory=dict)
    # player_id -> sum this round
    round_totals: dict[str, int] = field(default_factory=dict)
    stopped_by: str | None = None
    verification_done: bool = False
    created_at: float = 0.0
    max_rounds: int = 5
    round_seconds: int = 60

    def host(self) -> Player | None:
        return self.players.get(self.host_id)

    def connected_players(self) -> list[Player]:
        return [p for p in self.players.values() if p.connected]

    def public_state(self, for_player_id: str | None = None) -> dict[str, Any]:
        """Snapshot for clients. During playing, only own answers are visible."""
        show_all_answers = self.state in ("verifying", "results")

        answers_out: dict[str, dict[str, str]] = {}
        for pid, cats in self.answers.items():
            if show_all_answers or pid == for_player_id:
                answers_out[pid] = dict(cats)

        verdicts_out: dict[str, dict[str, Any]] = {}
        if show_all_answers or self.state == "results":
            for pid, cats in self.verdicts.items():
                verdicts_out[pid] = {
                    cat: v.to_dict() for cat, v in cats.items()
                }

        return {
            "code": self.code,
            "host_id": self.host_id,
            "state": self.state,
            "categories": list(self.categories),
            "letter": self.letter,
            "round_number": self.round_number,
            "players": [p.public_dict() for p in self.players.values()],
            "answers": answers_out,
            "verdicts": verdicts_out,
            "round_points": dict(self.round_points) if self.state == "results" else {},
            "round_totals": dict(self.round_totals) if self.state == "results" else {},
            "stopped_by": self.stopped_by,
            "verification_done": self.verification_done,
            "max_rounds": self.max_rounds,
            "round_seconds": self.round_seconds,
            "match_over": self.round_number >= self.max_rounds
            and self.state == "results",
            "you": for_player_id,
        }
