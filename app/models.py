"""SQLAlchemy models — lexicon words stored in PostgreSQL."""

from __future__ import annotations

from app.extensions import db


class Word(db.Model):
    """One accepted game answer for a category (seeded from CSV)."""

    __tablename__ = "words"
    __table_args__ = (
        db.UniqueConstraint("normalized", "category", name="uq_words_normalized_category"),
        db.Index("idx_words_lookup", "normalized", "category"),
        db.Index("idx_words_category", "category"),
    )

    id = db.Column(db.Integer, primary_key=True)
    word = db.Column(db.String(255), nullable=False)
    normalized = db.Column(db.String(255), nullable=False, index=True)
    category = db.Column(db.String(64), nullable=False)
    starting_letter = db.Column(db.String(8), nullable=True)
    category_en = db.Column(db.String(64), nullable=True)
    category_geo = db.Column(db.String(64), nullable=True)

    def __repr__(self) -> str:
        return f"<Word {self.word!r} ({self.category})>"
