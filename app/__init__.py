"""Qalaqobana Flask application factory."""

import os

from dotenv import load_dotenv
from flask import Flask
from flask_socketio import SocketIO

load_dotenv()

socketio = SocketIO(cors_allowed_origins="*")


def create_app() -> Flask:
    app = Flask(__name__, static_folder="static", template_folder="templates")
    app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "dev-secret-change-me")

    from app.routes.main import main_bp

    app.register_blueprint(main_bp)

    from app import events  # noqa: F401 — registers Socket.IO handlers

    socketio.init_app(app)
    return app
