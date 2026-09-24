/**
 * Thin live sync for SSR pages (play_*.html).
 * Game actions use normal HTML forms — this only handles Socket.IO redirects/timer.
 */
(function () {
  var bootEl = document.getElementById("boot");
  var boot = null;
  try {
    boot =
      bootEl && bootEl.textContent.trim()
        ? JSON.parse(bootEl.textContent)
        : null;
  } catch (e) {
    boot = null;
  }

  var page = (document.body && document.body.getAttribute("data-page")) || "";

  function dest(room) {
    if (room.match_over && room.state === "results") return "/podium";
    if (room.state === "lobby") return "/lobby";
    if (room.state === "playing") return "/arena";
    if (room.state === "verifying" || room.state === "results") return "/results";
    return "/";
  }

  // Copy room code
  document.querySelectorAll("[data-copy]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var sel = btn.getAttribute("data-copy");
      var el = sel && document.querySelector(sel);
      var text = el ? el.textContent.trim() : "";
      if (!text) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text);
      }
      btn.textContent = "დაკოპირდა!";
      setTimeout(function () {
        btn.textContent = "კოპირება";
      }, 1200);
    });
  });

  // Arena timer → auto-submit STOP form
  if (page === "arena") {
    var timer = document.getElementById("timer");
    var form = document.getElementById("answer-form");
    if (timer && form) {
      var left = parseInt(timer.getAttribute("data-seconds") || "60", 10);
      var tick = setInterval(function () {
        var m = String(Math.floor(left / 60)).padStart(2, "0");
        var s = String(left % 60).padStart(2, "0");
        timer.textContent = m + ":" + s;
        if (left <= 0) {
          clearInterval(tick);
          form.submit();
          return;
        }
        left -= 1;
      }, 1000);
    }

    // Autosave answers over socket when available
    var inputs = document.querySelectorAll(".answer-input");
    function collect() {
      var out = {};
      inputs.forEach(function (inp) {
        var cat = inp.getAttribute("data-cat");
        var letter = boot && boot.letter ? boot.letter : "";
        var rest = (inp.value || "").trim();
        if (rest && letter && rest.charAt(0) !== letter) rest = letter + rest;
        out[cat] = rest;
      });
      return out;
    }
    function save() {
      if (!window.__qSocket || !boot) return;
      window.__qSocket.emit("update_answers", {
        code: boot.code,
        player_id: boot.you,
        answers: collect(),
      });
    }
    inputs.forEach(function (inp) {
      inp.addEventListener("input", function () {
        clearTimeout(inp._t);
        inp._t = setTimeout(save, 300);
      });
    });
  }

  // Results: reload when verification finishes
  if (page === "results" && boot && boot.state === "verifying") {
    // pending UI is SSR; wait for socket
  }

  function connectSocket() {
    if (!window.io || window.__qSocket) return;
    var socket = window.io({
      transports: ["polling"],
      upgrade: false,
      reconnection: true,
    });
    window.__qSocket = socket;

    socket.on("connect", function () {
      if (boot && boot.code && boot.you) {
        socket.emit("sync", { code: boot.code, player_id: boot.you });
      }
    });

    socket.on("room_state", function (room) {
      if (!room || !room.state) return;
      var path = dest(room);
      if (location.pathname !== path) location.href = path;
    });

    socket.on("round_started", function () {
      if (location.pathname !== "/arena") location.href = "/arena";
    });

    socket.on("round_stopped", function () {
      if (location.pathname !== "/results") location.href = "/results";
    });

    socket.on("verification_complete", function () {
      if (location.pathname === "/results") location.reload();
    });
  }

  if (window.io) connectSocket();
  else {
    var tries = 0;
    var wait = setInterval(function () {
      tries += 1;
      if (window.io) {
        clearInterval(wait);
        connectSocket();
      } else if (tries > 40) clearInterval(wait);
    }, 250);
  }
})();
