"""Socket.IO event handlers for live multiplayer rooms.

Handlers will grow as rooms, rounds, STOP, and scoring are implemented.
"""

from flask_socketio import emit

from app import socketio


@socketio.on("connect")
def on_connect():
    emit("connected", {"ok": True})


@socketio.on("disconnect")
def on_disconnect():
    pass
