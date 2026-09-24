"""Thread-safe in-memory room registry."""

from __future__ import annotations

import threading
from typing import Callable

from app.game.models import Room

_lock = threading.RLock()
_rooms: dict[str, Room] = {}
# sid -> (room_code, player_id)
_sid_index: dict[str, tuple[str, str]] = {}


def with_lock(fn: Callable):
    def wrapper(*args, **kwargs):
        with _lock:
            return fn(*args, **kwargs)

    return wrapper


@with_lock
def save_room(room: Room) -> None:
    _rooms[room.code] = room


@with_lock
def get_room(code: str) -> Room | None:
    return _rooms.get(code.upper())


@with_lock
def delete_room(code: str) -> None:
    room = _rooms.pop(code.upper(), None)
    if not room:
        return
    for pid, player in list(room.players.items()):
        if player.sid and _sid_index.get(player.sid) == (room.code, pid):
            _sid_index.pop(player.sid, None)


@with_lock
def bind_sid(sid: str, room_code: str, player_id: str) -> None:
    _sid_index[sid] = (room_code.upper(), player_id)


@with_lock
def unbind_sid(sid: str) -> tuple[str, str] | None:
    return _sid_index.pop(sid, None)


@with_lock
def lookup_sid(sid: str) -> tuple[str, str] | None:
    return _sid_index.get(sid)


@with_lock
def all_rooms() -> list[Room]:
    return list(_rooms.values())
