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

# threading: works on Windows + small Linux deploys behind nginx
_cors = os.getenv("CORS_ORIGINS", "*")
_cors_origins = [o.strip() for o in _cors.split(",") if o.strip()] if _cors != "*" else "*"
socketio = SocketIO(
    cors_allowed_origins=_cors_origins,
    async_mode=os.getenv("SOCKETIO_ASYNC_MODE", "threading"),
)

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = ROOT / "data" / "qalaqobana.db"


def create_app() -> Flask:
    app = Flask(__name__, static_folder="static", template_folder="templates")
    app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "dev-secret-change-me")

    # Trust Cloudflare / nginx proxy headers
    if os.getenv("BEHIND_PROXY", "0") == "1":
        from werkzeug.middleware.proxy_fix import ProxyFix

        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

    db_path = Path(os.getenv("DATABASE_PATH", str(DEFAULT_DB))).resolve()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    app.config["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{db_path.as_posix()}"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    from app.extensions import db

    db.init_app(app)

    # Register models so create_all() sees them (avoid `import app.models` — shadows Flask `app`)
    from app import models as _models  # noqa: F401

    from app.routes.api import api_bp
    from app.routes.main import main_bp

    app.register_blueprint(main_bp)
    app.register_blueprint(api_bp)

    from app import events  # noqa: F401 — registers Socket.IO handlers

    with app.app_context():
        try:
            from app.game import lexicon

            lexicon.ensure_lexicon()
        except Exception:
            logging.getLogger(__name__).exception("Lexicon bootstrap failed")

    socketio.init_app(app)
    return app
