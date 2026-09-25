"""Qalaqobana Flask application factory."""

import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask
from flask_socketio import SocketIO

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

_cors = os.getenv("CORS_ORIGINS", "*")
_cors_origins = [o.strip() for o in _cors.split(",") if o.strip()] if _cors != "*" else "*"
socketio = SocketIO(
    cors_allowed_origins=_cors_origins,
    async_mode=os.getenv("SOCKETIO_ASYNC_MODE", "threading"),
)

ROOT = Path(__file__).resolve().parents[1]


def _database_uri() -> str:
    """PostgreSQL via DATABASE_URL. Optional sqlite only if ALLOW_SQLITE=1 (local/tests)."""
    url = (os.getenv("DATABASE_URL") or "").strip()
    if not url:
        if os.getenv("ALLOW_SQLITE", "0") == "1":
            path = ROOT / "data" / "qalaqobana.db"
            path.parent.mkdir(parents=True, exist_ok=True)
            return f"sqlite:///{path.as_posix()}"
        raise RuntimeError(
            "DATABASE_URL is not set. Example: "
            "postgresql+psycopg://qalaqobana:PASSWORD@127.0.0.1:5432/qalaqobana"
        )
    if url.startswith("postgres://"):
        url = "postgresql+psycopg://" + url[len("postgres://") :]
    elif url.startswith("postgresql://") and "+psycopg" not in url:
        url = "postgresql+psycopg://" + url[len("postgresql://") :]
    return url


def create_app() -> Flask:
    app = Flask(__name__, static_folder="static", template_folder="templates")
    app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "dev-secret-change-me")

    if os.getenv("BEHIND_PROXY", "0") == "1":
        from werkzeug.middleware.proxy_fix import ProxyFix

        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

    app.config["SQLALCHEMY_DATABASE_URI"] = _database_uri()
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {
        "pool_pre_ping": True,
        "pool_size": int(os.getenv("DB_POOL_SIZE", "5")),
    }

    from app.extensions import db

    db.init_app(app)

    from app import models as _models  # noqa: F401

    from app.routes.api import api_bp
    from app.routes.main import main_bp

    app.register_blueprint(main_bp)
    app.register_blueprint(api_bp)

    from app import events  # noqa: F401

    with app.app_context():
        try:
            from app.game import lexicon

            lexicon.ensure_lexicon()
        except Exception:
            logging.getLogger(__name__).exception("Lexicon bootstrap failed")

    socketio.init_app(app)
    return app
