"""Shared game constants: Georgian alphabet, categories, scoring, room limits."""

from __future__ import annotations

# Mkhedruli letters used for the round letter roll.
GEORGIAN_LETTERS = list("აბგდევზთიკლმნოპჟრსტუფქღყშჩცძწჭხჯჰ")

DEFAULT_CATEGORIES = [
    "country",
    "city",
    "animal",
    "plant",
    "name",
]

# Always included in every room — cannot be turned off.
REQUIRED_CATEGORIES = list(DEFAULT_CATEGORIES)

# Host can add these when creating / in lobby.
OPTIONAL_CATEGORIES = [
    "river",
    "film",
    "food",
]

ALL_CATEGORIES = REQUIRED_CATEGORIES + OPTIONAL_CATEGORIES

CATEGORY_LABELS = {
    "country": {"en": "Country", "ka": "ქვეყანა"},
    "city": {"en": "City", "ka": "ქალაქი"},
    "animal": {"en": "Animal", "ka": "ცხოველი"},
    "plant": {"en": "Plant", "ka": "მცენარე"},
    "name": {"en": "Name", "ka": "სახელი"},
    "river": {"en": "River", "ka": "მდინარე"},
    "film": {"en": "Film", "ka": "ფილმი"},
    "food": {"en": "Food", "ka": "საჭმელი"},
}

# Scoring after STOP + verification
SCORE_SAME_WORD = 5
SCORE_UNIQUE_WORD = 10
SCORE_ONLY_ANSWER = 15

ROOM_CODE_LENGTH = 5
MAX_PLAYERS = 8
MIN_PLAYERS_TO_START = 1  # allow solo testing; raise to 2 for production feel
MAX_ANSWER_LENGTH = 80
PLAYER_NAME_MAX = 24
DEFAULT_MAX_ROUNDS = 5
DEFAULT_ROUND_SECONDS = 60
ALLOWED_MAX_ROUNDS = (3, 5, 7)
ALLOWED_ROUND_SECONDS = (60, 90, 120)

# Room lifecycle
STATE_LOBBY = "lobby"
STATE_PLAYING = "playing"
STATE_VERIFYING = "verifying"
STATE_RESULTS = "results"
