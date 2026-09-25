"""Application entry point (dev + production)."""

import os

from app import create_app, socketio

app = create_app()

if __name__ == "__main__":
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "5017"))
    debug = os.getenv("FLASK_DEBUG", "0") == "1"
    socketio.run(
        app,
        host=host,
        port=port,
        debug=debug,
        use_reloader=False,
        allow_unsafe_werkzeug=True,
    )
