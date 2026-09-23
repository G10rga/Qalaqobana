"""Shared game constants: Georgian alphabet and default categories."""

# Mkhedruli letters used for the round letter roll.
# Excludes rarely used / archaic letters that are awkward for category answers.
GEORGIAN_LETTERS = list("აბგდევზთიკლმნოპჟრსტუფქღყშჩცძწჭხჯჰ")

DEFAULT_CATEGORIES = [
    "country",  # ქვეყანა
    "city",  # ქალაქი
    "animal",  # ცხოველი
    "plant",  # მცენარე
    "name",  # სახელი
]

OPTIONAL_CATEGORIES = [
    "river",  # მდინარე
    "film",  # ფილმი
    "food",  # საჭმელი
]

# Scoring after STOP + verification
SCORE_SAME_WORD = 5  # at least one other player has the same valid word
SCORE_UNIQUE_WORD = 10  # valid word, different from everyone else who answered
SCORE_ONLY_ANSWER = 15  # only this player has a valid word in the category
