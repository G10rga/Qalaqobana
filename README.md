# Qalaqobana

Online multiplayer **Qalaqobana** — random Georgian letter, fill categories, call **STOP**, verify answers, score.

Backend is implemented. Frontend is a placeholder shell until custom HTML/CSS/JS is dropped in.

## Rules

1. Host creates a room; others join with a code.
2. Each round rolls a Mkhedruli letter.
3. Players fill categories as fast as possible.
4. Anyone calls **STOP** → all inputs lock.
5. Server verifies answers in the background (Wikipedia + heuristics).
6. Scoring per category (valid answers only):
   - **15** — only you have a valid word
   - **10** — your word is different from everyone else’s
   - **5** — at least one other player has the same word

**Required categories:** country, city, animal, plant, name, river  
**Optional (host can add):** film, food

## Stack

- **Flask** + **Flask-SocketIO** (realtime rooms)
- **HTML / CSS / JS** placeholder + `QalaqobanaClient` helper
- **Verification:** Georgian letter check + Wikipedia (ka/en) search; soft categories (`name`, `food`) accept letter-correct answers when wiki is thin
- **State:** in-memory rooms (fine for LAN / small deploy; restart clears rooms)

## Frontend

Pages are **server-rendered Jinja templates** (Flask forms).  
`app/static/js/live.js` is a thin Socket.IO helper (~100 lines) only for:
- syncing the socket session
- redirecting when round state changes
- arena answer autosave + countdown

All game logic (rooms, STOP, verification, scoring) stays in Python.

## Setup

Python 3.10+

```bash
cd Qalaqobana
python -m venv .venv
.venv\Scripts\activate          # Windows
pip install -r requirements.txt
copy .env.example .env
python run.py
```

Open http://127.0.0.1:5000  
Health: `GET /api/health`

```bash
python -m unittest discover -s tests -v
```

## Project layout

```
app/
  __init__.py          # app factory + SocketIO
  events.py            # Socket.IO protocol
  routes/api.py        # REST mirror of game actions
  routes/main.py       # serves index.html
  game/
    constants.py
    models.py
    store.py
    rooms.py           # create/join/start/stop/verify
    scoring.py
    verification.py
    normalize.py
  static/js/client.js  # browser protocol helper
  templates/index.html # placeholder UI
```

---

## Socket.IO protocol (primary)

Connect to the same origin. Persist `player_id` + room `code` in the browser after create/join.

### Client → server

| Event | Payload | Notes |
| --- | --- | --- |
| `meta` | `{}` | Categories, letters, score table |
| `create_room` | `{ player_name, categories? }` | Host; optional category list |
| `join_room` | `{ code, player_name }` | Lobby only |
| `leave_room` | `{ code, player_id }` | |
| `set_categories` | `{ code, player_id, categories }` | Host, lobby only |
| `start_round` | `{ code, player_id }` | Host; from lobby or results |
| `update_answers` | `{ code, player_id, answers }` | `answers`: `{ city: "თბილისი", ... }` while `playing` |
| `stop_round` | `{ code, player_id }` | Locks everyone → verifying |
| `next_round` | `{ code, player_id }` | Host alias of start_round |
| `return_lobby` | `{ code, player_id }` | Host, from results |
| `sync` | `{ code, player_id }` | Re-bind socket after refresh |

### Server → client

| Event | Payload |
| --- | --- |
| `connected` | `{ ok: true }` |
| `meta` | category lists, labels, scores, letters |
| `room_created` / `room_joined` | `{ player_id, room }` |
| `room_state` | personalized room snapshot (see below) |
| `answers_saved` | `{ ok, answers }` |
| `round_started` | `{ letter, categories, round_number }` |
| `round_stopped` | `{ stopped_by, room? }` |
| `verification_complete` | `{ room? }` |
| `left_room` | `{ ok: true }` |
| `error` | `{ message, code }` |

### Room state shape

```json
{
  "code": "AB12C",
  "host_id": "...",
  "state": "lobby | playing | verifying | results",
  "categories": ["country", "city", "..."],
  "letter": "თ",
  "round_number": 1,
  "players": [{ "id", "name", "connected", "total_score" }],
  "answers": { "<player_id>": { "city": "..." } },
  "verdicts": {
    "<player_id>": {
      "city": {
        "answer": "...",
        "normalized": "...",
        "letter_ok": true,
        "valid": true,
        "status": "valid | invalid | uncertain | empty",
        "reason": "...",
        "source": "..."
      }
    }
  },
  "round_points": { "<player_id>": { "city": 10 } },
  "round_totals": { "<player_id>": 25 },
  "stopped_by": "<player_id>",
  "verification_done": true,
  "you": "<player_id>"
}
```

While `playing`, each client only receives **their own** answers in `room_state`. After STOP (`verifying` / `results`), everyone’s answers and verdicts are visible. `round_points` / `round_totals` appear in `results`.

### Browser helper

```js
const client = QalaqobanaClient.create();
client.createRoom("Nino", ["country", "city", "animal", "plant", "name"]);
client.on("room_state", (room) => { /* render */ });
client.updateAnswers({ city: "თბილისი" });
client.stopRound();
```

---

## REST API (same operations)

| Method | Path | Body |
| --- | --- | --- |
| GET | `/api/health` | |
| GET | `/api/meta` | |
| POST | `/api/verify` | `{ answer, category, letter }` — single-answer check |
| POST | `/api/rooms` | `{ player_name, categories? }` |
| POST | `/api/rooms/<code>/join` | `{ player_name }` |
| GET | `/api/rooms/<code>?player_id=` | |
| POST | `/api/rooms/<code>/categories` | `{ player_id, categories }` |
| POST | `/api/rooms/<code>/start` | `{ player_id }` |
| POST | `/api/rooms/<code>/answers` | `{ player_id, answers }` |
| POST | `/api/rooms/<code>/stop` | `{ player_id }` |
| POST | `/api/rooms/<code>/lobby` | `{ player_id }` |

REST stop also kicks off background verification and emits Socket.IO updates to anyone connected in the room.

---

## Verification notes

1. Empty / junk → invalid (0 points).
2. Must start with the round letter.
3. Wikipedia search (ka, then en) + category keyword hints.
4. `name` and `food` are **soft**: letter-correct answers can count as valid even if wiki is weak (`status: uncertain`).
5. Hard categories without support → invalid / uncertain (not scored).

Verification needs outbound HTTPS. Offline, letter checks still run; wiki lookups fail closed (except soft categories).

---

## Frontend handoff

Replace `app/templates/index.html` and `app/static/css|js` with your design. Keep `client.js` (or reimplement the same events). Recommended screens: home (create/join) → lobby → playing (letter + inputs + STOP) → verifying spinner → results → next round / lobby.
