"""Lexicon service — words live in data/qalaqobana.db via the Word model."""

from __future__ import annotations

import csv
import logging
import sqlite3
from pathlib import Path

from flask import current_app, has_app_context

from app.extensions import db
from app.game.normalize import normalize_for_compare
from app.models import Word

logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parents[2]
CSV_PATH = ROOT / "qalaqobana_words.csv"
DEFAULT_DB_PATH = ROOT / "data" / "qalaqobana.db"

CATEGORY_MAP = {
    "city": "city",
    "country": "country",
    "name": "name",
    "animal": "animal",
    "plant": "plant",
    "river": "river",
    "food": "food",
    "film": "film",
    "ქალაქი": "city",
    "ქვეყანა": "country",
    "სახელი": "name",
    "ცხოველი": "animal",
    "მცენარე": "plant",
    "მდინარე": "river",
    "საჭმელი": "food",
    "ფილმი": "film",
}


def _map_category(en: str, geo: str) -> str | None:
    for raw in (en, geo):
        key = (raw or "").strip()
        if not key:
            continue
        hit = CATEGORY_MAP.get(key) or CATEGORY_MAP.get(key.casefold())
        if hit:
            return hit
    return None


def db_path() -> Path:
    if has_app_context():
        uri = current_app.config.get("SQLALCHEMY_DATABASE_URI", "")
        if uri.startswith("sqlite:///"):
            return Path(uri.removeprefix("sqlite:///"))
    return DEFAULT_DB_PATH


def ensure_lexicon() -> None:
    """Create tables; seed from CSV only when the words table is empty."""
    db.create_all()
    count = Word.query.count()
    if count == 0:
        if CSV_PATH.exists():
            logger.info("Word DB empty — importing from %s", CSV_PATH.name)
            import_from_csv()
        else:
            logger.warning(
                "Word DB empty and CSV missing (%s). Scoring will reject all words.",
                CSV_PATH,
            )
    else:
        logger.info("Word DB ready: %s words at %s", count, db_path())


def import_from_csv(*, force: bool = False) -> int:
    """
    Load CSV rows into the Word table (qalaqobana.db).

    force=False: refuse if words already exist.
    force=True: wipe the table and re-import.
    """
    if not CSV_PATH.exists():
        raise FileNotFoundError(f"CSV not found: {CSV_PATH}")

    db.create_all()
    existing = Word.query.count()
    if existing and not force:
        raise RuntimeError(
            f"Word DB already has {existing} words. "
            "Pass force=True to wipe and re-import from CSV."
        )

    if force and existing:
        Word.query.delete()
        db.session.commit()

    inserted = 0
    skipped = 0
    seen: set[tuple[str, str]] = set()
    batch: list[Word] = []

    with open(CSV_PATH, encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            word = (row.get("word") or "").strip()
            if not word:
                skipped += 1
                continue
            en = (row.get("category_en") or "").strip() or None
            geo = (row.get("category_geo") or "").strip() or None
            cat = _map_category(en or "", geo or "")
            if not cat:
                skipped += 1
                continue
            letter = (row.get("starting_letter") or "").strip() or None
            norm = normalize_for_compare(word)
            if not norm:
                skipped += 1
                continue
            key = (norm, cat)
            if key in seen:
                skipped += 1
                continue
            seen.add(key)
            batch.append(
                Word(
                    word=word,
                    normalized=norm,
                    category=cat,
                    starting_letter=letter,
                    category_en=en,
                    category_geo=geo,
                )
            )
            if len(batch) >= 1000:
                db.session.add_all(batch)
                db.session.commit()
                inserted += len(batch)
                batch.clear()

    if batch:
        db.session.add_all(batch)
        db.session.commit()
        inserted += len(batch)

    count = Word.query.count()
    logger.info(
        "Imported into %s: %s words stored (%s inserted, %s skipped)",
        db_path(),
        count,
        inserted,
        skipped,
    )
    return count


def lookup(word: str, category: str) -> bool:
    """True if normalized word exists for category in qalaqobana.db.

    Uses raw sqlite so it works from Socket.IO background threads
    (no Flask app context required).
    """
    norm = normalize_for_compare(word)
    if not norm or not category:
        return False
    path = db_path()
    if not path.exists():
        return False
    conn = sqlite3.connect(str(path), timeout=5)
    try:
        row = conn.execute(
            "SELECT 1 FROM words WHERE normalized = ? AND category = ? LIMIT 1",
            (norm, category),
        ).fetchone()
        return row is not None
    finally:
        conn.close()


def stats() -> dict[str, int]:
    path = db_path()
    if not path.exists():
        return {"total": 0}
    conn = sqlite3.connect(str(path), timeout=5)
    try:
        total = conn.execute("SELECT COUNT(*) FROM words").fetchone()[0]
        by_cat = {
            cat: n
            for cat, n in conn.execute(
                "SELECT category, COUNT(*) FROM words GROUP BY category"
            )
        }
        return {"total": int(total), **by_cat}
    finally:
        conn.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    from app import create_app

    application = create_app()
    with application.app_context():
        n = import_from_csv(force=True)
        print(f"OK — {n} words in {db_path()}")
