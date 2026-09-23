# Qalaqobana

Online multiplayer **Qalaqobana** (ქართული ასოებით კატეგორიების თამაში) — fill categories for a random Georgian letter, race to STOP, then score.

## Game rules

1. A room is created; players join.
2. Each round rolls a random letter from the Georgian (Mkhedruli) alphabet.
3. Players fill answers for categories as fast as they can.
4. Anyone may call **STOP**. Everyone else is locked immediately, even with empty categories.
5. Answers are verified in the background (web / knowledge checks — planned).
6. Points are awarded per category:
   - **5** — same valid word as at least one other player
   - **10** — valid word that differs from every other player’s word
   - **15** — only you have a valid word in that category

### Categories

**Default:** Country, City, Animal, Plant, Name  

**Optional (host can enable):** River, Film, Food, and similar

## Stack

| Layer | Choice |
| --- | --- |
| Backend | **Flask** + **Flask-SocketIO** (live rooms, STOP, round sync) |
| Frontend | **HTML / CSS / JS** (custom UI/UX and animations — placeholder shell for now) |
| Verify (planned) | Background jobs + web/Wikipedia-style checks after STOP |
| Deploy (later) | TBD |

## Project layout

```
Qalaqobana/
├── app/
│   ├── __init__.py          # Flask app factory + SocketIO
│   ├── events.py            # Socket.IO handlers
│   ├── routes/              # HTTP routes
│   ├── game/                # Constants + upcoming room/round/score logic
│   ├── static/              # css/, js/
│   └── templates/           # HTML templates
├── run.py                   # Dev entry point
├── requirements.txt
├── .env.example
└── README.md
```

## Status

**Scaffold only.** Working pieces today:

- Flask app boots and serves a placeholder page
- Socket.IO connects from the browser

**Not built yet** (in roughly this order):

- [ ] Create / join rooms
- [ ] Lobby, player list, host controls
- [ ] Round start + Georgian letter roll
- [ ] Category answer forms + live STOP lock
- [ ] Answer verification pipeline
- [ ] Scoring (5 / 10 / 15) and round results
- [ ] Custom animated UI (replacing the placeholder)
- [ ] Persistence, auth polish, production deploy

## Setup

Requires **Python 3.10+**.

```bash
cd Qalaqobana
python -m venv .venv

# Windows
.venv\Scripts\activate

# macOS / Linux
# source .venv/bin/activate

pip install -r requirements.txt
copy .env.example .env   # or: cp .env.example .env
python run.py
```

Open [http://127.0.0.1:5000](http://127.0.0.1:5000). The status line should move to **Ready** when Socket.IO connects.

## Contributing / roadmap notes

UI/UX will be custom HTML/CSS/JS with its own animations — keep game protocol (Socket.IO events and payloads) stable so the frontend can evolve independently of scoring and verification.

This README will be updated as rooms, STOP, verification, and scoring land.
