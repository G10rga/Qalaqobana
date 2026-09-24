"""HTTP JSON API — same game operations as Socket.IO (useful for tests / simple clients)."""

from __future__ import annotations

from flask import Blueprint, jsonify, request

from app import socketio
from app.game import rooms as game
from app.game.rooms import GameError

api_bp = Blueprint("api", __name__, url_prefix="/api")


def _err(exc: GameError, status: int = 400):
    return jsonify({"ok": False, "error": exc.message, "code": exc.code}), status


@api_bp.get("/health")
def health():
    return jsonify({"ok": True, "service": "qalaqobana"})


@api_bp.get("/meta")
def meta():
    return jsonify({"ok": True, **game.meta_payload()})


@api_bp.post("/verify")
def verify_one():
    """Debug/helper: verify a single answer without a room."""
    from app.game.verification import verify_answer

    data = request.get_json(silent=True) or {}
    verdict = verify_answer(
        answer=str(data.get("answer", "")),
        category=str(data.get("category", "city")),
        letter=str(data.get("letter", "")),
    )
    return jsonify({"ok": True, "verdict": verdict.to_dict()})


@api_bp.post("/rooms")
def create_room():
    data = request.get_json(silent=True) or {}
    try:
        room, player = game.create_room(
            player_name=data.get("player_name", ""),
            categories=data.get("categories"),
            max_rounds=data.get("max_rounds"),
            round_seconds=data.get("round_seconds"),
        )
    except GameError as exc:
        return _err(exc)
    return jsonify(
        {
            "ok": True,
            "player_id": player.id,
            "room": room.public_state(player.id),
        }
    ), 201


@api_bp.post("/rooms/<code>/join")
def join_room(code: str):
    data = request.get_json(silent=True) or {}
    try:
        room, player = game.join_room(
            code=code,
            player_name=data.get("player_name", ""),
        )
    except GameError as exc:
        status = 404 if exc.code == "not_found" else 400
        return _err(exc, status)
    return jsonify(
        {
            "ok": True,
            "player_id": player.id,
            "room": room.public_state(player.id),
        }
    )


@api_bp.get("/rooms/<code>")
def get_room(code: str):
    player_id = request.args.get("player_id")
    try:
        state = game.get_public_state(code, player_id)
    except GameError as exc:
        return _err(exc, 404)
    return jsonify({"ok": True, "room": state})


@api_bp.post("/rooms/<code>/categories")
def set_categories(code: str):
    data = request.get_json(silent=True) or {}
    try:
        room = game.set_categories(
            room_code=code,
            player_id=str(data.get("player_id", "")),
            categories=data.get("categories") or [],
        )
    except GameError as exc:
        return _err(exc)
    _notify(room.code)
    return jsonify({"ok": True, "room": room.public_state(data.get("player_id"))})


@api_bp.post("/rooms/<code>/start")
def start_round(code: str):
    data = request.get_json(silent=True) or {}
    try:
        room = game.start_round(code, str(data.get("player_id", "")))
    except GameError as exc:
        return _err(exc)
    socketio.emit(
        "round_started",
        {
            "letter": room.letter,
            "categories": room.categories,
            "round_number": room.round_number,
        },
        to=room.code,
    )
    _notify(room.code)
    return jsonify({"ok": True, "room": room.public_state(data.get("player_id"))})


@api_bp.post("/rooms/<code>/answers")
def update_answers(code: str):
    data = request.get_json(silent=True) or {}
    try:
        room = game.update_answers(
            room_code=code,
            player_id=str(data.get("player_id", "")),
            answers=data.get("answers") or {},
        )
    except GameError as exc:
        return _err(exc)
    pid = str(data.get("player_id", ""))
    return jsonify({"ok": True, "answers": room.answers.get(pid, {})})


@api_bp.post("/rooms/<code>/stop")
def stop_round(code: str):
    data = request.get_json(silent=True) or {}
    player_id = str(data.get("player_id", ""))
    try:
        room = game.stop_round(code, player_id)
    except GameError as exc:
        return _err(exc)

    socketio.emit(
        "round_stopped",
        {"stopped_by": player_id},
        to=room.code,
    )
    _notify(room.code)

    def _verify():
        finished = game.run_verification(room.code)
        socketio.emit("verification_complete", {"ok": True}, to=finished.code)
        _notify(finished.code)

    socketio.start_background_task(_verify)
    return jsonify({"ok": True, "room": room.public_state(player_id)})


@api_bp.post("/rooms/<code>/lobby")
def return_lobby(code: str):
    data = request.get_json(silent=True) or {}
    try:
        room = game.return_to_lobby(code, str(data.get("player_id", "")))
    except GameError as exc:
        return _err(exc)
    _notify(room.code)
    return jsonify({"ok": True, "room": room.public_state(data.get("player_id"))})


def _notify(room_code: str) -> None:
    from app.game import store

    room = store.get_room(room_code)
    if not room:
        return
    for pid, player in room.players.items():
        if player.sid and player.connected:
            socketio.emit("room_state", room.public_state(pid), to=player.sid)
