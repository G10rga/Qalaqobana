"""Answer verification via letter rules + Wikipedia + Georgian place lexicon."""

from __future__ import annotations

import logging
import re
from typing import Any

import requests

from app.game.models import AnswerVerdict
from app.game.normalize import looks_like_word, normalize_answer, normalize_for_compare, starts_with_letter

logger = logging.getLogger(__name__)

USER_AGENT = "Qalaqobana/0.1 (educational game; contact: local-dev)"
REQUEST_TIMEOUT = 4.0

# Keywords that suggest a Wikipedia hit belongs to a category (ka + en).
CATEGORY_HINTS: dict[str, list[str]] = {
    "country": [
        "ქვეყანა",
        "სახელმწიფო",
        "country",
        "sovereign state",
        "republic",
        "kingdom",
        "nation",
        "კუნძული",
        "არქიპელაგი",
        "island",
        "archipelago",
        "autonomous",
        "territory",
        "state of",
    ],
    "city": [
        "ქალაქი",
        "დედაქალაქი",
        "city",
        "town",
        "capital",
        "municipality",
        "settlement",
        "კანტონი",
        "canton",
        "commune",
        "urban",
        "metropolis",
    ],
    "animal": [
        "ცხოველი",
        "ძუძუმწოვარი",
        "ფრინველი",
        "თევზი",
        "animal",
        "mammal",
        "bird",
        "fish",
        "species",
        "insect",
    ],
    "plant": [
        "მცენარე",
        "ყვავილი",
        "ხე",
        "plant",
        "tree",
        "flower",
        "flora",
        "botan",
        "herb",
        "fruit",
    ],
    "name": [
        "სახელი",
        "მოცემული სახელი",
        "given name",
        "first name",
        "personal name",
        "surname",
        "გვარი",
    ],
    "river": [
        "მდინარე",
        "river",
        "tributary",
        "waterway",
    ],
    "film": [
        "ფილმი",
        "კინო",
        "film",
        "movie",
        "cinema",
        "television series",
        "სერიალი",
    ],
    "food": [
        "საჭმელი",
        "კერძი",
        "food",
        "dish",
        "cuisine",
        "recipe",
        "ingredient",
        "fruit",
    ],
}

# Soft: letter + word-shape is enough if wiki is inconclusive / down.
# Country/city/river stay stricter when Wikipedia responds.
SOFT_CATEGORIES = {"name", "food", "animal", "plant", "film"}

# Country/city: near wiki title can count even without strong keyword hints.
# River is stricter — see _river_rejected / river matching rules.
GEO_TITLE_CATEGORIES = {"country", "city"}

# Phrases that look like water but are not proper river names for this game.
_RIVER_REJECT_RE = re.compile(
    r"(წყალსაცავ|\bტბა\b|reservoir|\blake\b)",
    re.IGNORECASE,
)

# Common Qalaqobana spellings (ka) → categories they count for.
# Includes folk/Latin-influenced spellings that differ from ka.wikipedia titles.
KNOWN_ANSWERS: dict[str, set[str]] = {
    # Folk spellings that differ from ka.wikipedia titles
    "ზანზიბარი": {"country"},
    "ზანზიბარის": {"country"},
    "ზურიხი": {"city"},
    "ზურიკი": {"city"},
    "ციურიხი": {"city"},
    "ზაგრები": {"city"},
    "ზაგრებიი": {"city"},
    "ყატარი": {"country"},
    "ყატარის": {"country"},
    "გრენლანდია": {"country"},
    "გუანჯოუ": {"city"},
    "გუანჯოუი": {"city"},
    "გედი": {"animal"},
    "გოგრა": {"plant"},
    "გიორგი": {"name"},
}

# Georgian words appended to ka.wikipedia searches
_KA_SEARCH_BIAS: dict[str, list[str]] = {
    "country": ["ქვეყანა", "სახელმწიფო"],
    "city": ["ქალაქი", "დედაქალაქი"],
    "animal": ["ცხოველი"],
    "plant": ["მცენარე"],
    "name": ["სახელი"],
    "river": ["მდინარე"],
    "film": ["ფილმი"],
    "food": ["საჭმელი", "კერძი"],
}


def verify_answer(answer: str, category: str, letter: str) -> AnswerVerdict:
    raw = normalize_answer(answer)
    normalized = normalize_for_compare(raw)

    if not raw:
        return AnswerVerdict(
            answer="",
            normalized="",
            letter_ok=False,
            valid=False,
            status="empty",
            reason="Empty answer",
        )

    if not looks_like_word(raw):
        return AnswerVerdict(
            answer=raw,
            normalized=normalized,
            letter_ok=False,
            valid=False,
            status="invalid",
            reason="Answer is not a usable word",
        )

    # Letter-only placeholders like "ზ" are not real answers.
    if len(raw) <= 1:
        return AnswerVerdict(
            answer=raw,
            normalized=normalized,
            letter_ok=starts_with_letter(raw, letter),
            valid=False,
            status="invalid",
            reason="Answer too short",
        )

    letter_ok = starts_with_letter(raw, letter)
    if not letter_ok:
        return AnswerVerdict(
            answer=raw,
            normalized=normalized,
            letter_ok=False,
            valid=False,
            status="invalid",
            reason=f"Must start with «{letter}»",
        )

    known = KNOWN_ANSWERS.get(normalized)
    if known and category in known:
        return AnswerVerdict(
            answer=raw,
            normalized=normalized,
            letter_ok=True,
            valid=True,
            status="valid",
            reason="Known place / Qalaqobana lexicon",
            source="lexicon",
        )

    if category == "river":
        reject = _river_rejected(raw)
        if reject:
            return AnswerVerdict(
                answer=raw,
                normalized=normalized,
                letter_ok=True,
                valid=False,
                status="invalid",
                reason=reject,
                source="heuristic",
            )

    wiki = _wikipedia_check(raw, category)
    if wiki["matched"]:
        return AnswerVerdict(
            answer=raw,
            normalized=normalized,
            letter_ok=True,
            valid=True,
            status="valid",
            reason=wiki["reason"],
            source=wiki["source"],
        )

    # Wikipedia down / rate-limited: don't zero letter-valid answers.
    if wiki.get("unavailable"):
        return AnswerVerdict(
            answer=raw,
            normalized=normalized,
            letter_ok=True,
            valid=True,
            status="uncertain",
            reason="Accepted (verification offline)",
            source="fallback",
        )

    if wiki["found"] and category in SOFT_CATEGORIES:
        return AnswerVerdict(
            answer=raw,
            normalized=normalized,
            letter_ok=True,
            valid=True,
            status="uncertain",
            reason="Letter OK; category weakly supported",
            source=wiki["source"],
        )

    if not wiki["found"] and category in SOFT_CATEGORIES:
        return AnswerVerdict(
            answer=raw,
            normalized=normalized,
            letter_ok=True,
            valid=True,
            status="uncertain",
            reason="Accepted on letter match (soft category)",
            source="heuristic",
        )

    # Country/city only: near-title wiki hit without strong hints still OK.
    if wiki["found"] and category in GEO_TITLE_CATEGORIES and wiki.get("title_close"):
        return AnswerVerdict(
            answer=raw,
            normalized=normalized,
            letter_ok=True,
            valid=True,
            status="uncertain",
            reason="Place title found online",
            source=wiki["source"],
        )

    if wiki["found"]:
        return AnswerVerdict(
            answer=raw,
            normalized=normalized,
            letter_ok=True,
            valid=False,
            status="uncertain",
            reason="Found online but category not confirmed",
            source=wiki["source"],
        )

    return AnswerVerdict(
        answer=raw,
        normalized=normalized,
        letter_ok=True,
        valid=False,
        status="invalid",
        reason="No supporting web result found",
        source="wikipedia",
    )


def verify_player_answers(
    answers: dict[str, str],
    categories: list[str],
    letter: str,
) -> dict[str, AnswerVerdict]:
    out: dict[str, AnswerVerdict] = {}
    for cat in categories:
        out[cat] = verify_answer(answers.get(cat, ""), cat, letter)
    return out


def _river_rejected(raw: str) -> str | None:
    """Block non-river water phrases commonly tried in Qalaqobana."""
    n = normalize_for_compare(raw)
    # "სიონის წყალი", "რაღაცის წყალი" — not a named river
    if re.search(r"(^|\s)წყალი$", n) or " წყალი" in n or n.endswith("ის წყალი"):
        return "«წყალი» phrases are not rivers"
    if _RIVER_REJECT_RE.search(n):
        return "Not a river (lake/reservoir/etc.)"
    return None


def _wikipedia_check(answer: str, category: str) -> dict[str, Any]:
    """Return {found, matched, title_close, reason, source, unavailable} via ka.wikipedia."""
    hints = CATEGORY_HINTS.get(category, [])
    queries = _search_queries(answer, category)

    best_found: dict[str, Any] | None = None
    attempted = 0
    failed = 0

    for query in queries:
        attempted += 1
        try:
            hits = _wiki_search("ka", query)
        except Exception as exc:
            failed += 1
            logger.warning("Wikipedia search failed (ka/%s): %s", query, exc)
            continue

        for hit in hits:
            title = hit.get("title", "") or ""
            snippet = re.sub(r"<[^>]+>", "", hit.get("snippet", "") or "")
            local = f"{title} {snippet}".lower()
            source = f"ka.wikipedia.org:{title}"
            close = _titles_close(title, answer) or _titles_close(title, query)
            hints_in_title = any(h.lower() in title.lower() for h in hints)
            hints_in_local = any(h.lower() in local for h in hints)

            if category == "river" and _river_page_skipped(title):
                continue

            answer_close = _titles_close(title, answer) or _answer_in_title(
                answer, title
            )

            if category == "river":
                if answer_close and (hints_in_title or hints_in_local):
                    return {
                        "found": True,
                        "matched": True,
                        "title_close": True,
                        "unavailable": False,
                        "reason": "Wikipedia suggests river",
                        "source": source,
                    }
                if hints_in_title and _answer_in_title(answer, title):
                    return {
                        "found": True,
                        "matched": True,
                        "title_close": True,
                        "unavailable": False,
                        "reason": "Wikipedia title is a river",
                        "source": source,
                    }
                if answer_close and best_found is None:
                    best_found = {
                        "found": True,
                        "matched": False,
                        "title_close": True,
                        "unavailable": False,
                        "reason": "Place found but not confirmed as river",
                        "source": source,
                    }
                continue

            if answer_close and (hints_in_title or hints_in_local):
                return {
                    "found": True,
                    "matched": True,
                    "title_close": True,
                    "unavailable": False,
                    "reason": f"Wikipedia suggests {category}",
                    "source": source,
                }

            if hints_in_title and _answer_in_title(answer, title):
                return {
                    "found": True,
                    "matched": True,
                    "title_close": True,
                    "unavailable": False,
                    "reason": f"Wikipedia title is a {category}",
                    "source": source,
                }

            if answer_close or close:
                matched = (
                    category in SOFT_CATEGORIES or category in GEO_TITLE_CATEGORIES
                )
                result = {
                    "found": True,
                    "matched": matched,
                    "title_close": bool(answer_close),
                    "unavailable": False,
                    "reason": "Near Wikipedia title",
                    "source": source,
                }
                if matched and answer_close:
                    return result
                best_found = best_found or result
                continue

            if best_found is None:
                best_found = {
                    "found": True,
                    "matched": False,
                    "title_close": False,
                    "unavailable": False,
                    "reason": "Wikipedia hit without category confirmation",
                    "source": source,
                }

    if best_found:
        return best_found

    unavailable = attempted > 0 and failed == attempted
    return {
        "found": False,
        "matched": False,
        "title_close": False,
        "unavailable": unavailable,
        "reason": "",
        "source": "",
    }


def _river_page_skipped(title: str) -> bool:
    t = normalize_for_compare(title)
    return any(
        bad in t
        for bad in (
            "წყალსაცავ",
            "ტბების",
            "ზღვა",
            "reservoir",
            "list of lakes",
            "წყალსაცავები",
        )
    )


def _answer_in_title(answer: str, title: str) -> bool:
    a = normalize_for_compare(answer)
    t = normalize_for_compare(title)
    if not a or len(a) < 3:
        return False
    return a in t


def _search_queries(answer: str, category: str = "") -> list[str]:
    """Georgian-only search queries for ka.wikipedia."""
    queries: list[str] = [answer]
    for bias in _KA_SEARCH_BIAS.get(category, []):
        queries.append(f"{answer} {bias}")
        queries.append(f"{bias} {answer}")
    if category == "river":
        queries.extend([f"{answer} მდინარე", f"მდინარე {answer}"])

    seen: set[str] = set()
    out: list[str] = []
    for q in queries:
        k = normalize_for_compare(q)
        if k and k not in seen:
            seen.add(k)
            out.append(q)
    return out


def _titles_close(title: str, answer: str) -> bool:
    a = normalize_for_compare(answer)
    t = normalize_for_compare(title)
    if not a or not t:
        return False
    if a == t:
        return True
    # Drop parenthetical disambiguation
    t_main = re.sub(r"\s*\([^)]*\)\s*", "", t).strip()
    if a == t_main or a in t_main or t_main in a:
        return True
    return False


def _wiki_search(lang: str, query: str) -> list[dict[str, str]]:
    url = f"https://{lang}.wikipedia.org/w/api.php"
    params = {
        "action": "query",
        "list": "search",
        "srsearch": query,
        "srlimit": 5,
        "format": "json",
        "utf8": 1,
    }
    resp = requests.get(
        url,
        params=params,
        timeout=REQUEST_TIMEOUT,
        headers={"User-Agent": USER_AGENT},
    )
    resp.raise_for_status()
    data = resp.json()
    return data.get("query", {}).get("search", []) or []
