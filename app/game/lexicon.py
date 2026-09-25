"""Lexicon service — words live in PostgreSQL; CSV is the import seed."""

from __future__ import annotations

import csv
import logging
import os
from pathlib import Path

from flask import current_app, has_app_context

from app.extensions import db
from app.game.normalize import normalize_for_compare
from app.models import Word

logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parents[2]
# Prefer data/qalaqobana_words.csv; fall back to project-root CSV
CSV_CANDIDATES = (
    ROOT / "data" / "qalaqobana_words.csv",
    ROOT / "qalaqobana_words.csv",
)

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


def csv_path() -> Path | None:
    override = (os.getenv("LEXICON_CSV") or "").strip()
    if override:
        p = Path(override)
        return p if p.exists() else None
    for p in CSV_CANDIDATES:
        if p.exists():
            return p
    return None


def _dsn() -> str:
    """libpq DSN for raw psycopg (background-thread safe lookups)."""
    if has_app_context():
        uri = current_app.config.get("SQLALCHEMY_DATABASE_URI", "")
    else:
        uri = (os.getenv("DATABASE_URL") or "").strip()
    # Strip SQLAlchemy driver prefix for psycopg.connect()
    for prefix in ("postgresql+psycopg://", "postgresql://", "postgres://"):
        if uri.startswith(prefix):
            return "postgresql://" + uri[len(prefix) :]
    return uri


def ensure_lexicon() -> None:
    """Create tables; seed from CSV only when the words table is empty."""
    db.create_all()
    count = Word.query.count()
    seed = csv_path()
    if count == 0:
        if seed:
            logger.info("Word table empty — importing from %s", seed)
            import_from_csv()
        else:
            logger.warning(
                "Word table empty and CSV missing (tried %s). "
                "Scoring will reject all words until you import.",
                ", ".join(str(p) for p in CSV_CANDIDATES),
            )
    else:
        logger.info("PostgreSQL lexicon ready: %s words", count)


def import_from_csv(*, force: bool = False) -> int:
    """
    Load CSV rows into PostgreSQL `words` table.

    force=False: refuse if words already exist.
    force=True: wipe the table and re-import.
    """
    seed = csv_path()
    if not seed:
        raise FileNotFoundError(
            "CSV not found. Place it at data/qalaqobana_words.csv "
            "or set LEXICON_CSV=/path/to/file.csv"
        )

    db.create_all()
    existing = Word.query.count()
    if existing and not force:
        raise RuntimeError(
            f"PostgreSQL already has {existing} words. "
            "Pass force=True to wipe and re-import from CSV."
        )

    if force and existing:
        Word.query.delete()
        db.session.commit()

    inserted = 0
    skipped = 0
    seen: set[tuple[str, str]] = set()
    batch: list[Word] = []

    with open(seed, encoding="utf-8-sig", newline="") as fh:
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
        "Imported into PostgreSQL from %s: %s words (%s inserted, %s skipped)",
        seed.name,
        count,
        inserted,
        skipped,
    )
    return count


def lookup(word: str, category: str) -> bool:
    """True if normalized word exists for category in the database."""
    norm = normalize_for_compare(word)
    if not norm or not category:
        return False

    if has_app_context():
        return (
            Word.query.filter_by(normalized=norm, category=category).limit(1).first()
            is not None
        )

    # Background threads without Flask context
    uri = (os.getenv("DATABASE_URL") or "").strip()
    if uri.startswith("sqlite:///"):
        import sqlite3

        path = uri.removeprefix("sqlite:///")
        conn = sqlite3.connect(path, timeout=5)
        try:
            row = conn.execute(
                "SELECT 1 FROM words WHERE normalized = ? AND category = ? LIMIT 1",
                (norm, category),
            ).fetchone()
            return row is not None
        finally:
            conn.close()

    import psycopg

    dsn = _dsn()
    if not dsn:
        return False
    with psycopg.connect(dsn) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT 1 FROM words WHERE normalized = %s AND category = %s LIMIT 1",
                (norm, category),
            )
            return cur.fetchone() is not None


def stats() -> dict[str, int]:
    if has_app_context():
        total = Word.query.count()
        rows = (
            db.session.query(Word.category, db.func.count(Word.id))
            .group_by(Word.category)
            .all()
        )
        return {"total": total, **{cat: n for cat, n in rows}}

    import psycopg

    dsn = _dsn()
    if not dsn:
        return {"total": 0}
    with psycopg.connect(dsn) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM words")
            total = int(cur.fetchone()[0])
            cur.execute("SELECT category, COUNT(*) FROM words GROUP BY category")
            return {"total": total, **{cat: n for cat, n in cur.fetchall()}}


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    from app import create_app

    application = create_app()
    with application.app_context():
        n = import_from_csv(force=True)
        print(f"OK — {n} words in PostgreSQL")
