"""Page routes — server-rendered UI; forms for actions; tiny Socket.IO for live sync."""

from __future__ import annotations

from flask import (
    Blueprint,
    flash,
    redirect,
    render_template,
    request,
    url_for,
)

from app import socketio
from app.game import rooms as game
from app.game.constants import (
    CATEGORY_LABELS,
    OPTIONAL_CATEGORIES,
    REQUIRED_CATEGORIES,
)
from app.game.rooms import GameError
from app.game.session_util import (
    clear_player_session,
    current_room,
    require_membership,
    save_player_session,
    session_ids,
)

main_bp = Blueprint("main", __name__)


def _path_for_room(room) -> str:
    if room.state == "results" and room.round_number >= room.max_rounds:
        return url_for("main.podium")
    return {
        "lobby": url_for("main.lobby"),
        "playing": url_for("main.arena"),
        "verifying": url_for("main.results"),
        "results": url_for("main.results"),
    }.get(room.state, url_for("main.home"))


def _form_answers(room) -> dict[str, str]:
    letter = room.letter or ""
    out: dict[str, str] = {}
    for cat in room.categories:
        rest = (request.form.get(cat) or "").strip()
        if not rest:
            out[cat] = ""
        elif letter and rest.startswith(letter):
            out[cat] = rest
        else:
            out[cat] = letter + rest
    return out


def _boot(room, player_id: str) -> dict:
    return room.public_state(player_id)


def _broadcast(room_code: str) -> None:
    from app.game import store

    room = store.get_room(room_code)
    if not room:
        return
    for pid, player in room.players.items():
        if player.sid and player.connected:
            socketio.emit("room_state", room.public_state(pid), to=player.sid)
    socketio.emit("room_changed", {"code": room.code, "state": room.state}, to=room.code)


@main_bp.get("/")
@main_bp.get("/home")
def home():
    membership = require_membership()
    if membership:
        room, _ = membership
        return redirect(_path_for_room(room))
    return render_template(
        "home.html",
        required_categories=REQUIRED_CATEGORIES,
        optional_categories=OPTIONAL_CATEGORIES,
        labels=CATEGORY_LABELS,
        error=request.args.get("error"),
    )


@main_bp.post("/create")
def create():
    name = (request.form.get("player_name") or "").strip()
    extras = request.form.getlist("extra")
    categories = list(REQUIRED_CATEGORIES) + [
        e for e in extras if e in OPTIONAL_CATEGORIES
    ]
    try:
        max_rounds = int(request.form.get("max_rounds") or 5)
        round_seconds = int(request.form.get("round_seconds") or 60)
        room, player = game.create_room(
            player_name=name,
            categories=categories,
            max_rounds=max_rounds,
            round_seconds=round_seconds,
        )
    except GameError as exc:
        return redirect(url_for("main.home", error=exc.message))
    save_player_session(
        room_code=room.code, player_id=player.id, player_name=player.name
    )
    return redirect(url_for("main.lobby"))


@main_bp.post("/join")
def join():
    name = (request.form.get("player_name") or "").strip()
    code = (request.form.get("code") or "").strip()
    try:
        room, player = game.join_room(code=code, player_name=name)
    except GameError as exc:
        return redirect(url_for("main.home", error=exc.message))
    save_player_session(
        room_code=room.code, player_id=player.id, player_name=player.name
    )
    _broadcast(room.code)
    return redirect(url_for("main.lobby"))


@main_bp.get("/lobby")
def lobby():
    membership = require_membership()
    if not membership:
        return redirect(url_for("main.home"))
    room, player_id = membership
    if room.state != "lobby":
        return redirect(_path_for_room(room))
    return render_template(
        "lobby.html",
        room=_boot(room, player_id),
        labels=CATEGORY_LABELS,
        required_categories=REQUIRED_CATEGORIES,
        optional_categories=OPTIONAL_CATEGORIES,
        is_host=room.host_id == player_id,
    )


@main_bp.post("/lobby/categories")
def lobby_categories():
    membership = require_membership()
    if not membership:
        return redirect(url_for("main.home"))
    room, player_id = membership
    extras = request.form.getlist("extra")
    categories = list(REQUIRED_CATEGORIES) + [
        e for e in extras if e in OPTIONAL_CATEGORIES
    ]
    try:
        room = game.set_categories(room.code, player_id, categories)
    except GameError as exc:
        flash(exc.message)
        return redirect(url_for("main.lobby"))
    _broadcast(room.code)
    return redirect(url_for("main.lobby"))


@main_bp.post("/lobby/start")
def lobby_start():
    membership = require_membership()
    if not membership:
        return redirect(url_for("main.home"))
    room, player_id = membership
    try:
        room = game.start_round(room.code, player_id)
    except GameError as exc:
        flash(exc.message)
        return redirect(url_for("main.lobby"))
    socketio.emit(
        "round_started",
        {
            "letter": room.letter,
            "categories": room.categories,
            "round_number": room.round_number,
        },
        to=room.code,
    )
    _broadcast(room.code)
    return redirect(url_for("main.arena"))


@main_bp.get("/arena")
def arena():
    membership = require_membership()
    if not membership:
        return redirect(url_for("main.home"))
    room, player_id = membership
    if room.state != "playing":
        return redirect(_path_for_room(room))
    answers = room.answers.get(player_id, {})
    return render_template(
        "arena.html",
        room=_boot(room, player_id),
        labels=CATEGORY_LABELS,
        answers=answers,
        letter=room.letter or "",
    )


@main_bp.post("/arena/answers")
def arena_answers():
    """Fallback form save (JS also saves via socket)."""
    membership = require_membership()
    if not membership:
        return redirect(url_for("main.home"))
    room, player_id = membership
    payload = _form_answers(room)
    try:
        game.update_answers(room.code, player_id, payload)
    except GameError:
        pass
    return ("", 204)


@main_bp.post("/arena/stop")
def arena_stop():
    membership = require_membership()
    if not membership:
        return redirect(url_for("main.home"))
    room, player_id = membership
    if request.form:
        try:
            game.update_answers(room.code, player_id, _form_answers(room))
        except GameError:
            pass
    try:
        room = game.stop_round(room.code, player_id)
    except GameError as exc:
        flash(exc.message)
        return redirect(url_for("main.arena"))

    socketio.emit("round_stopped", {"stopped_by": player_id}, to=room.code)
    _broadcast(room.code)

    def _verify():
        finished = game.run_verification(room.code)
        socketio.emit("verification_complete", {"ok": True}, to=finished.code)
        _broadcast(finished.code)

    socketio.start_background_task(_verify)
    return redirect(url_for("main.results"))


@main_bp.get("/results")
def results():
    membership = require_membership()
    if not membership:
        return redirect(url_for("main.home"))
    room, player_id = membership
    if room.state not in ("verifying", "results"):
        return redirect(_path_for_room(room))
    return render_template(
        "results.html",
        room=_boot(room, player_id),
        labels=CATEGORY_LABELS,
        pending=room.state == "verifying",
        is_host=room.host_id == player_id,
    )


@main_bp.post("/results/next")
def results_next():
    membership = require_membership()
    if not membership:
        return redirect(url_for("main.home"))
    room, player_id = membership
    if room.round_number >= room.max_rounds and room.state == "results":
        return redirect(url_for("main.podium"))
    try:
        room = game.start_round(room.code, player_id)
    except GameError as exc:
        flash(exc.message)
        return redirect(url_for("main.results"))
    socketio.emit(
        "round_started",
        {
            "letter": room.letter,
            "categories": room.categories,
            "round_number": room.round_number,
        },
        to=room.code,
    )
    _broadcast(room.code)
    return redirect(url_for("main.arena"))


@main_bp.get("/podium")
def podium():
    membership = require_membership()
    if not membership:
        return redirect(url_for("main.home"))
    room, player_id = membership
    ranked = sorted(
        room.players.values(), key=lambda p: p.total_score, reverse=True
    )
    return render_template(
        "podium.html",
        room=_boot(room, player_id),
        ranked=ranked,
        is_host=room.host_id == player_id,
    )


@main_bp.post("/podium/lobby")
def podium_lobby():
    membership = require_membership()
    if not membership:
        return redirect(url_for("main.home"))
    room, player_id = membership
    try:
        room = game.return_to_lobby(room.code, player_id)
    except GameError as exc:
        flash(exc.message)
        return redirect(url_for("main.podium"))
    _broadcast(room.code)
    return redirect(url_for("main.lobby"))


@main_bp.post("/leave")
def leave():
    membership = require_membership()
    if membership:
        room, player_id = membership
        left = game.leave_room(room.code, player_id)
        if left:
            _broadcast(left.code)
    clear_player_session()
    return redirect(url_for("main.home"))
