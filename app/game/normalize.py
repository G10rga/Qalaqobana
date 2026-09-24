"""Text helpers: trim, casefold, letter checks for Georgian answers."""

from __future__ import annotations

import re
import unicodedata


_SPACE_RE = re.compile(r"\s+")
_NON_WORD_RE = re.compile(r"[^\w\s\-']+", re.UNICODE)


def normalize_answer(raw: str | None) -> str:
    """Collapse whitespace and strip; keep original letter casing for display."""
    if not raw:
        return ""
    text = unicodedata.normalize("NFC", str(raw)).strip()
    text = _SPACE_RE.sub(" ", text)
    return text


def normalize_for_compare(raw: str | None) -> str:
    """Lowercase-ish compare key for scoring duplicates."""
    text = normalize_answer(raw)
    if not text:
        return ""
    # Georgian has no case; still casefold for Latin film titles etc.
    return text.casefold()


def first_letter(text: str) -> str:
    text = normalize_answer(text)
    return text[0] if text else ""


def starts_with_letter(answer: str, letter: str) -> bool:
    if not letter:
        return False
    return first_letter(answer) == letter


def looks_like_word(answer: str) -> bool:
    """Reject empty / punctuation-only answers."""
    text = normalize_answer(answer)
    if not text or len(text) > 80:
        return False
    cleaned = _NON_WORD_RE.sub("", text)
    return bool(cleaned.strip())
