import json
from pathlib import Path

# Restore app.js + client.js from transcript
transcript = Path(
    r"C:\Users\user\.cursor\projects\c-Users-user-Qalaqobana\agent-transcripts"
    r"\e9adba38-7eeb-498b-abc6-2db3210ec745\e9adba38-7eeb-498b-abc6-2db3210ec745.jsonl"
)
out = Path("app/static/js")
out.mkdir(parents=True, exist_ok=True)

found_app = found_client = None
with transcript.open(encoding="utf-8") as f:
    for line in f:
        try:
            obj = json.loads(line)
        except Exception:
            continue
        content = (obj.get("message") or {}).get("content")
        if not isinstance(content, list):
            continue
        for block in content:
            if not isinstance(block, dict) or block.get("type") != "tool_use":
                continue
            inp = block.get("input") or {}
            path = str(inp.get("path") or "").replace("\\", "/")
            contents = inp.get("contents")
            if not contents:
                continue
            if path.endswith("client.js") and "QalaqobanaClient" in contents:
                found_client = contents
            if path.endswith("app.js") and "Qalaqobana UI wiring" in contents:
                found_app = contents

if not found_app or not found_client:
    raise SystemExit("missing js in transcript")

found_app = found_app.replace("\u2014", "-")
if 'transports: ["polling"]' not in found_client:
    found_client = found_client.replace(
        "const socket = global.io(opts.url || undefined);",
        'const socket = global.io(opts.url || undefined, '
        '{ transports: ["polling"], upgrade: false, reconnection: true });',
    )

(out / "app.js").write_text(found_app, encoding="utf-8", newline="\n")
(out / "client.js").write_text(found_client, encoding="utf-8", newline="\n")
print("app.js", found_app.count("\n") + 1, "lines", (out / "app.js").stat().st_size, "bytes")
print("client.js", found_client.count("\n") + 1, "lines", (out / "client.js").stat().st_size, "bytes")

# Append script tags to clean templates
scripts = (
    '<script src="https://cdn.socket.io/4.7.5/socket.io.min.js" crossorigin="anonymous"></script>\n'
    "<script src=\"{{ url_for('static', filename='js/client.js') }}\"></script>\n"
    "<script src=\"{{ url_for('static', filename='js/app.js') }}\"></script>\n"
)

for name in ["home.html", "lobby.html", "arena.html", "results.html", "podium.html"]:
    path = Path("app/templates") / name
    text = path.read_text(encoding="utf-8")
    # remove any previous injects
    for needle in [
        "js/live.js",
        "js/client.js",
        "js/app.js",
        "cdn.socket.io",
        'id="boot"',
        'id="flashes"',
    ]:
        lines = []
        for ln in text.splitlines(True):
            if needle in ln and ("<script" in ln or "boot" in ln or "flashes" in ln):
                continue
            lines.append(ln)
        text = "".join(lines)
    if "</body>" not in text:
        raise SystemExit("no body " + name)
    if "js/app.js" not in text:
        text = text.replace("</body>", scripts + "</body>")
    path.write_text(text, encoding="utf-8")
    print("template", name, path.stat().st_size)

# Also copy to Desktop with original names so user can see them
desktop = Path(r"C:\Users\user\Desktop")
mapping = {
    "home.html": "Loading&GameModes.html",
    "lobby.html": "MultiPlayer_Lobby.html",
    "arena.html": "ActiveGame_Arena.html",
    "results.html": "Answer Review & Scoring.html",
    "podium.html": "End Game & Winner Podium.html",
}
for src, dst in mapping.items():
    target = desktop / dst
    # copy WITHOUT flask script inject for desktop viewing - use raw git content
    # actually copy current templates (with scripts) is fine for backup
    raw = (Path("app/templates") / src).read_text(encoding="utf-8")
    target.write_text(raw, encoding="utf-8")
    print("desktop", dst, target.stat().st_size)
