"""Socket.IO handlers — primary realtime protocol for the game UI."""

from __future__ import annotations

import logging
from typing import Any

from flask import request
from flask_socketio import emit, join_room, leave_room

from app import socketio
from app.game import rooms as game
from app.game.rooms import GameError

logger = logging.getLogger(__name__)


def _emit_error(message: str, code: str = "error") -> None:
    emit("error", {"message": message, "code": code})


def _broadcast_room(room_code: str, player_id: str | None = None) -> None:
    """Send personalized room_state to each connected member."""
    from app.game import store

    room = store.get_room(room_code)
    if not room:
        return
    for pid, player in room.players.items():
        if player.sid and player.connected:
            socketio.emit(
                "room_state",
                room.public_state(pid),
                to=player.sid,
            )


def _safe(handler):
    def wrapped(data=None):
        try:
            return handler(data or {})
        except GameError as exc:
            _emit_error(exc.message, exc.code)
        except Exception:
            logger.exception("Socket handler failed")
            _emit_error("Internal server error", "internal")

    return wrapped


@socketio.on("connect")
def on_connect():
    emit("connected", {"ok": True})


@socketio.on("disconnect")
def on_disconnect():
    room = game.handle_disconnect(request.sid)
    if room:
        _broadcast_room(room.code)


@socketio.on("meta")
@_safe
def on_meta(_data: dict[str, Any]):
    emit("meta", game.meta_payload())


@socketio.on("create_room")
@_safe
def on_create_room(data: dict[str, Any]):
    room, player = game.create_room(
        player_name=data.get("player_name", ""),
        categories=data.get("categories"),
        sid=request.sid,
        max_rounds=data.get("max_rounds"),
        round_seconds=data.get("round_seconds"),
    )
    join_room(room.code)
    emit(
        "room_created",
        {
            "player_id": player.id,
            "room": room.public_state(player.id),
        },
    )
    _broadcast_room(room.code)


@socketio.on("set_settings")
@_safe
def on_set_settings(data: dict[str, Any]):
    room = game.set_settings(
        room_code=str(data.get("code", "")),
        player_id=str(data.get("player_id", "")),
        categories=data.get("categories"),
        max_rounds=data.get("max_rounds"),
        round_seconds=data.get("round_seconds"),
    )
    _broadcast_room(room.code)


@socketio.on("join_room")
@_safe
def on_join_room(data: dict[str, Any]):
    room, player = game.join_room(
        code=str(data.get("code", "")),
        player_name=data.get("player_name", ""),
        sid=request.sid,
    )
    join_room(room.code)
    emit(
        "room_joined",
        {
            "player_id": player.id,
            "room": room.public_state(player.id),
        },
    )
    _broadcast_room(room.code)


@socketio.on("leave_room")
@_safe
def on_leave_room(data: dict[str, Any]):
    code = str(data.get("code", "")).upper()
    player_id = str(data.get("player_id", ""))
    leave_room(code)
    room = game.leave_room(code, player_id)
    emit("left_room", {"ok": True})
    if room:
        _broadcast_room(room.code)


@socketio.on("set_categories")
@_safe
def on_set_categories(data: dict[str, Any]):
    room = game.set_categories(
        room_code=str(data.get("code", "")),
        player_id=str(data.get("player_id", "")),
        categories=data.get("categories") or [],
    )
    _broadcast_room(room.code)


@socketio.on("start_round")
@_safe
def on_start_round(data: dict[str, Any]):
    room = game.start_round(
        room_code=str(data.get("code", "")),
        player_id=str(data.get("player_id", "")),
    )
    socketio.emit(
        "round_started",
        {
            "letter": room.letter,
            "categories": room.categories,
            "round_number": room.round_number,
        },
        to=room.code,
    )
    _broadcast_room(room.code)


@socketio.on("update_answers")
@_safe
def on_update_answers(data: dict[str, Any]):
    room = game.update_answers(
        room_code=str(data.get("code", "")),
        player_id=str(data.get("player_id", "")),
        answers=data.get("answers") or {},
    )
    # Do not broadcast others' answers while playing — ack only
    emit(
        "answers_saved",
        {
            "ok": True,
            "answers": room.answers.get(str(data.get("player_id", "")), {}),
        },
    )


@socketio.on("stop_round")
@_safe
def on_stop_round(data: dict[str, Any]):
    from flask import current_app

    from app.game.constants import STOP_GRACE_SECONDS

    code = str(data.get("code", ""))
    player_id = str(data.get("player_id", ""))
    room = game.stop_round(code, player_id)
    stopper = room.players.get(player_id)
    app = current_app._get_current_object()
    socketio.emit(
        "stop_called",
        {
            "stopped_by": player_id,
            "stopped_by_name": stopper.name if stopper else "",
            "grace_seconds": STOP_GRACE_SECONDS,
            "grace_ends_at": room.grace_ends_at,
            "room": room.public_state(None),
        },
        to=room.code,
    )
    _broadcast_room(room.code)

    def _after_grace():
        try:
            socketio.sleep(STOP_GRACE_SECONDS)
            with app.app_context():
                locked = game.finalize_stop(code)
                if locked.state != "verifying":
                    return
                socketio.emit(
                    "round_stopped",
                    {
                        "stopped_by": locked.stopped_by,
                        "room": locked.public_state(None),
                    },
                    to=locked.code,
                )
                _broadcast_room(locked.code)

                finished = game.run_verification(locked.code)
                socketio.emit(
                    "verification_complete",
                    {"room": finished.public_state(None)},
                    to=finished.code,
                )
                _broadcast_room(finished.code)
        except Exception:
            logger.exception("Background stop/verification failed")
            socketio.emit(
                "error",
                {"message": "Verification failed", "code": "verify_failed"},
                to=code,
            )

    socketio.start_background_task(_after_grace)


@socketio.on("next_round")
@_safe
def on_next_round(data: dict[str, Any]):
    """Host starts another round from results (same as start_round)."""
    on_start_round(data)


@socketio.on("return_lobby")
@_safe
def on_return_lobby(data: dict[str, Any]):
    room = game.return_to_lobby(
        room_code=str(data.get("code", "")),
        player_id=str(data.get("player_id", "")),
    )
    _broadcast_room(room.code)


@socketio.on("sync")
@_safe
def on_sync(data: dict[str, Any]):
    code = str(data.get("code", ""))
    player_id = str(data.get("player_id", ""))
    if code and player_id:
        game.attach_sid(code, player_id, request.sid)
        join_room(code.upper())
    emit("room_state", game.get_public_state(code, player_id))
