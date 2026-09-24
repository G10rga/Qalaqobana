"""Page routes — designed HTML screens; game actions via Socket.IO (app.js)."""

from __future__ import annotations

from flask import Blueprint, render_template, request

from app.game.constants import (
    CATEGORY_LABELS,
    OPTIONAL_CATEGORIES,
    REQUIRED_CATEGORIES,
)

main_bp = Blueprint("main", __name__)


@main_bp.get("/")
@main_bp.get("/home")
def home():
    return render_template(
        "home.html",
        required_categories=REQUIRED_CATEGORIES,
        optional_categories=OPTIONAL_CATEGORIES,
        labels=CATEGORY_LABELS,
        error=request.args.get("error"),
    )


@main_bp.get("/lobby")
def lobby():
    return render_template("lobby.html")


@main_bp.get("/arena")
def arena():
    return render_template("arena.html")


@main_bp.get("/results")
def results():
    return render_template("results.html")


@main_bp.get("/podium")
def podium():
    return render_template("podium.html")
