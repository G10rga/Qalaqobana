"""Flask session helpers for the current player in a room."""

from __future__ import annotations

from flask import session

from app.game import store
from app.game.models import Room


def save_player_session(*, room_code: str, player_id: str, player_name: str) -> None:
    session["room_code"] = room_code.upper()
    session["player_id"] = player_id
    session["player_name"] = player_name
    session.modified = True


def clear_player_session() -> None:
    for key in ("room_code", "player_id", "player_name"):
        session.pop(key, None)


def session_ids() -> tuple[str | None, str | None, str | None]:
    return (
        session.get("room_code"),
        session.get("player_id"),
        session.get("player_name"),
    )


def current_room() -> Room | None:
    code = session.get("room_code")
    if not code:
        return None
    return store.get_room(code)


def require_membership() -> tuple[Room, str] | None:
    """Return (room, player_id) if session is valid for that room."""
    code, player_id, _ = session_ids()
    if not code or not player_id:
        return None
    room = store.get_room(code)
    if not room or player_id not in room.players:
        clear_player_session()
        return None
    return room, player_id
