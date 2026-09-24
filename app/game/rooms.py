"""Room lifecycle: create, join, play, stop, verify, score."""

from __future__ import annotations

import logging
import random
import secrets
import string
import time
import uuid
from typing import Any, Callable

from app.game import store
from app.game.constants import (
    ALL_CATEGORIES,
    ALLOWED_MAX_ROUNDS,
    ALLOWED_ROUND_SECONDS,
    DEFAULT_CATEGORIES,
    DEFAULT_MAX_ROUNDS,
    DEFAULT_ROUND_SECONDS,
    GEORGIAN_LETTERS,
    MAX_ANSWER_LENGTH,
    MAX_PLAYERS,
    MIN_PLAYERS_TO_START,
    OPTIONAL_CATEGORIES,
    PLAYER_NAME_MAX,
    REQUIRED_CATEGORIES,
    ROOM_CODE_LENGTH,
    STATE_LOBBY,
    STATE_PLAYING,
    STATE_RESULTS,
    STATE_VERIFYING,
)
from app.game.models import Player, Room
from app.game.normalize import normalize_answer
from app.game.scoring import apply_round_scores_to_totals, compute_round_scores
from app.game.verification import verify_player_answers

logger = logging.getLogger(__name__)

BroadcastFn = Callable[[str, dict[str, Any]], None]


class GameError(Exception):
    def __init__(self, message: str, code: str = "error"):
        super().__init__(message)
        self.message = message
        self.code = code


def _new_code() -> str:
    alphabet = string.ascii_uppercase + string.digits
    for _ in range(50):
        code = "".join(secrets.choice(alphabet) for _ in range(ROOM_CODE_LENGTH))
        if not store.get_room(code):
            return code
    raise GameError("Could not allocate room code", "room_code")


def _validate_name(name: str) -> str:
    name = normalize_answer(name)
    if not name or len(name) > PLAYER_NAME_MAX:
        raise GameError(
            f"Name required (max {PLAYER_NAME_MAX} characters)",
            "bad_name",
        )
    return name


def _validate_categories(categories: list[str] | None) -> list[str]:
    """Always keep required categories; merge any valid optional extras."""
    selected: list[str] = []
    if categories:
        for cat in categories:
            key = str(cat).strip().lower()
            if key not in ALL_CATEGORIES:
                raise GameError(f"Unknown category: {cat}", "bad_category")
            if key not in selected:
                selected.append(key)

    # Required categories are always present, in canonical order
    cleaned: list[str] = []
    for key in REQUIRED_CATEGORIES:
        if key not in cleaned:
            cleaned.append(key)
    for key in selected:
        if key in OPTIONAL_CATEGORIES and key not in cleaned:
            cleaned.append(key)
    return cleaned


def create_room(
    player_name: str,
    categories: list[str] | None = None,
    sid: str | None = None,
    max_rounds: int | None = None,
    round_seconds: int | None = None,
) -> tuple[Room, Player]:
    name = _validate_name(player_name)
    cats = _validate_categories(categories)
    player = Player(id=str(uuid.uuid4()), name=name, sid=sid, connected=True)
    room = Room(
        code=_new_code(),
        host_id=player.id,
        players={player.id: player},
        categories=cats,
        state=STATE_LOBBY,
        created_at=time.time(),
        max_rounds=_validate_max_rounds(max_rounds),
        round_seconds=_validate_round_seconds(round_seconds),
    )
    store.save_room(room)
    if sid:
        store.bind_sid(sid, room.code, player.id)
    return room, player


def _validate_max_rounds(value: int | None) -> int:
    if value is None:
        return DEFAULT_MAX_ROUNDS
    try:
        n = int(value)
    except (TypeError, ValueError) as exc:
        raise GameError("Invalid max_rounds", "bad_settings") from exc
    if n not in ALLOWED_MAX_ROUNDS:
        raise GameError("max_rounds must be 3, 5, or 7", "bad_settings")
    return n


def _validate_round_seconds(value: int | None) -> int:
    if value is None:
        return DEFAULT_ROUND_SECONDS
    try:
        n = int(value)
    except (TypeError, ValueError) as exc:
        raise GameError("Invalid round_seconds", "bad_settings") from exc
    if n not in ALLOWED_ROUND_SECONDS:
        raise GameError("round_seconds must be 60, 90, or 120", "bad_settings")
    return n


def join_room(
    code: str,
    player_name: str,
    sid: str | None = None,
) -> tuple[Room, Player]:
    room = store.get_room(code)
    if not room:
        raise GameError("Room not found", "not_found")
    if room.state != STATE_LOBBY:
        raise GameError("Round already in progress — wait for the lobby", "busy")
    if len(room.connected_players()) >= MAX_PLAYERS:
        raise GameError("Room is full", "full")

    name = _validate_name(player_name)
    # Rejoin by same name if disconnected seat exists
    for existing in room.players.values():
        if existing.name.casefold() == name.casefold() and not existing.connected:
            existing.connected = True
            existing.sid = sid
            if sid:
                store.bind_sid(sid, room.code, existing.id)
            store.save_room(room)
            return room, existing

    if any(p.name.casefold() == name.casefold() for p in room.players.values() if p.connected):
        raise GameError("That name is already taken in this room", "name_taken")

    player = Player(id=str(uuid.uuid4()), name=name, sid=sid, connected=True)
    room.players[player.id] = player
    store.save_room(room)
    if sid:
        store.bind_sid(sid, room.code, player.id)
    return room, player


def leave_room(room_code: str, player_id: str) -> Room | None:
    room = store.get_room(room_code)
    if not room:
        return None
    player = room.players.get(player_id)
    if not player:
        return room

    if player.sid:
        store.unbind_sid(player.sid)
    player.sid = None
    player.connected = False

    # Remove entirely if still in lobby
    if room.state == STATE_LOBBY:
        room.players.pop(player_id, None)

    if room.host_id == player_id:
        connected = room.connected_players()
        room.host_id = connected[0].id if connected else ""

    if not room.connected_players():
        store.delete_room(room.code)
        return None

    store.save_room(room)
    return room


def set_categories(room_code: str, player_id: str, categories: list[str]) -> Room:
    room = _require_room(room_code)
    _require_host(room, player_id)
    if room.state != STATE_LOBBY:
        raise GameError("Categories can only change in the lobby", "bad_state")
    room.categories = _validate_categories(categories)
    store.save_room(room)
    return room


def set_settings(
    room_code: str,
    player_id: str,
    *,
    categories: list[str] | None = None,
    max_rounds: int | None = None,
    round_seconds: int | None = None,
) -> Room:
    room = _require_room(room_code)
    _require_host(room, player_id)
    if room.state != STATE_LOBBY:
        raise GameError("Settings can only change in the lobby", "bad_state")
    if categories is not None:
        room.categories = _validate_categories(categories)
    if max_rounds is not None:
        room.max_rounds = _validate_max_rounds(max_rounds)
    if round_seconds is not None:
        room.round_seconds = _validate_round_seconds(round_seconds)
    store.save_room(room)
    return room


def start_round(room_code: str, player_id: str) -> Room:
    room = _require_room(room_code)
    _require_host(room, player_id)
    if room.state not in (STATE_LOBBY, STATE_RESULTS):
        raise GameError("Cannot start a round right now", "bad_state")
    if room.state == STATE_RESULTS and room.round_number >= room.max_rounds:
        raise GameError("Match is over — return to lobby or podium", "match_over")
    if len(room.connected_players()) < MIN_PLAYERS_TO_START:
        raise GameError("Not enough players", "need_players")

    room.round_number += 1
    room.letter = random.choice(GEORGIAN_LETTERS)
    room.state = STATE_PLAYING
    room.answers = {pid: {} for pid in room.players if room.players[pid].connected}
    room.verdicts = {}
    room.round_points = {}
    room.round_totals = {}
    room.stopped_by = None
    room.verification_done = False
    store.save_room(room)
    return room


def update_answers(
    room_code: str,
    player_id: str,
    answers: dict[str, str],
) -> Room:
    room = _require_room(room_code)
    if room.state != STATE_PLAYING:
        raise GameError("Answers are locked", "locked")
    if player_id not in room.players:
        raise GameError("Not in this room", "not_member")

    cleaned: dict[str, str] = {}
    for cat in room.categories:
        raw = normalize_answer(answers.get(cat, ""))
        if len(raw) > MAX_ANSWER_LENGTH:
            raw = raw[:MAX_ANSWER_LENGTH]
        cleaned[cat] = raw

    room.answers[player_id] = cleaned
    store.save_room(room)
    return room


def stop_round(room_code: str, player_id: str) -> Room:
    room = _require_room(room_code)
    if room.state != STATE_PLAYING:
        raise GameError("Nothing to stop", "bad_state")
    if player_id not in room.players:
        raise GameError("Not in this room", "not_member")

    room.state = STATE_VERIFYING
    room.stopped_by = player_id
    room.verification_done = False
    # Ensure every connected player has an answers dict
    for pid, player in room.players.items():
        if player.connected and pid not in room.answers:
            room.answers[pid] = {}
    store.save_room(room)
    return room


def run_verification(room_code: str) -> Room:
    """Blocking verification + scoring. Call from a background task."""
    room = _require_room(room_code)
    if room.state != STATE_VERIFYING:
        return room

    letter = room.letter or ""
    verdicts: dict[str, dict] = {}
    for pid, player in room.players.items():
        if not player.connected and pid not in room.answers:
            continue
        answers = room.answers.get(pid, {})
        try:
            verdicts[pid] = verify_player_answers(answers, room.categories, letter)
        except Exception:
            logger.exception("Verification failed for player %s", pid)
            verdicts[pid] = verify_player_answers(answers, room.categories, letter)

    room.verdicts = verdicts
    points, totals = compute_round_scores(room)
    room.round_points = points
    room.round_totals = totals
    apply_round_scores_to_totals(room)
    room.verification_done = True
    room.state = STATE_RESULTS
    store.save_room(room)
    return room


def return_to_lobby(room_code: str, player_id: str) -> Room:
    room = _require_room(room_code)
    _require_host(room, player_id)
    if room.state != STATE_RESULTS:
        raise GameError("Finish the round first", "bad_state")
    room.state = STATE_LOBBY
    room.letter = None
    room.stopped_by = None
    room.answers = {}
    room.verdicts = {}
    room.round_points = {}
    room.round_totals = {}
    room.verification_done = False
    store.save_room(room)
    return room


def attach_sid(room_code: str, player_id: str, sid: str) -> Room:
    room = _require_room(room_code)
    player = room.players.get(player_id)
    if not player:
        raise GameError("Not in this room", "not_member")
    if player.sid and player.sid != sid:
        store.unbind_sid(player.sid)
    player.sid = sid
    player.connected = True
    store.bind_sid(sid, room.code, player.id)
    store.save_room(room)
    return room


def handle_disconnect(sid: str) -> Room | None:
    mapping = store.unbind_sid(sid)
    if not mapping:
        return None
    room_code, player_id = mapping
    room = store.get_room(room_code)
    if not room:
        return None
    player = room.players.get(player_id)
    if not player:
        return room
    player.connected = False
    player.sid = None
    if room.state == STATE_LOBBY and not room.connected_players():
        store.delete_room(room.code)
        return None
    # Transfer host if needed
    if room.host_id == player_id:
        connected = room.connected_players()
        if connected:
            room.host_id = connected[0].id
    store.save_room(room)
    return room


def get_public_state(room_code: str, player_id: str | None = None) -> dict[str, Any]:
    room = _require_room(room_code)
    return room.public_state(player_id)


def meta_payload() -> dict[str, Any]:
    from app.game.constants import (
        CATEGORY_LABELS,
        OPTIONAL_CATEGORIES,
        REQUIRED_CATEGORIES,
        SCORE_ONLY_ANSWER,
        SCORE_SAME_WORD,
        SCORE_UNIQUE_WORD,
    )

    return {
        "default_categories": list(DEFAULT_CATEGORIES),
        "required_categories": list(REQUIRED_CATEGORIES),
        "optional_categories": list(OPTIONAL_CATEGORIES),
        "all_categories": list(ALL_CATEGORIES),
        "category_labels": CATEGORY_LABELS,
        "georgian_letters": list(GEORGIAN_LETTERS),
        "scores": {
            "same": SCORE_SAME_WORD,
            "unique": SCORE_UNIQUE_WORD,
            "only": SCORE_ONLY_ANSWER,
        },
        "max_players": MAX_PLAYERS,
        "min_players_to_start": MIN_PLAYERS_TO_START,
        "default_max_rounds": DEFAULT_MAX_ROUNDS,
        "default_round_seconds": DEFAULT_ROUND_SECONDS,
        "allowed_max_rounds": list(ALLOWED_MAX_ROUNDS),
        "allowed_round_seconds": list(ALLOWED_ROUND_SECONDS),
    }


def _require_room(code: str) -> Room:
    room = store.get_room(code)
    if not room:
        raise GameError("Room not found", "not_found")
    return room


def _require_host(room: Room, player_id: str) -> None:
    if room.host_id != player_id:
        raise GameError("Only the host can do that", "not_host")
