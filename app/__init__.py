"""Qalaqobana Flask application factory."""

import logging
import os

from dotenv import load_dotenv
from flask import Flask
from flask_socketio import SocketIO

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

# threading works reliably on Windows; eventlet optional later for scale
socketio = SocketIO(cors_allowed_origins="*", async_mode="threading")


def create_app() -> Flask:
    app = Flask(__name__, static_folder="static", template_folder="templates")
    app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "dev-secret-change-me")

    from app.routes.api import api_bp
    from app.routes.main import main_bp

    app.register_blueprint(main_bp)
    app.register_blueprint(api_bp)

    from app import events  # noqa: F401 — registers Socket.IO handlers

    socketio.init_app(app)
    return app
