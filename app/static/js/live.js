/**
 * Bridge: keeps designer HTML/JS intact.
 * Flask owns game logic — this only wires UI actions + live redirects.
 */
(function () {
  var page = document.body && document.body.getAttribute("data-page");
  if (!page) {
    var path = location.pathname || "/";
    if (path === "/" || path === "/home") page = "home";
    else if (path.indexOf("/lobby") === 0) page = "lobby";
    else if (path.indexOf("/arena") === 0) page = "arena";
    else if (path.indexOf("/results") === 0) page = "results";
    else if (path.indexOf("/podium") === 0) page = "podium";
  }
  var bootEl = document.getElementById("boot");
  var boot = null;
  try {
    boot = bootEl && bootEl.textContent && bootEl.textContent.trim() !== "null"
      ? JSON.parse(bootEl.textContent)
      : null;
  } catch (e) {
    boot = null;
  }

  var REQUIRED = ["country", "city", "animal", "plant", "name", "river"];
  var OPTIONAL = ["film", "food"];
  var LABELS = {
    country: "ქვეყანა",
    city: "ქალაქი",
    animal: "ცხოველი",
    plant: "მცენარე",
    name: "სახელი",
    river: "მდინარე",
    film: "ფილმი",
    food: "საჭმელი",
  };

  function toast(msg) {
    var el = document.getElementById("q-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "q-toast";
      el.style.cssText =
        "position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:99999;background:#1e2b3b;color:#d6e4f9;padding:10px 16px;border-radius:10px;font:600 13px Plus Jakarta Sans,sans-serif;max-width:90vw;";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    clearTimeout(el._t);
    el._t = setTimeout(function () {
      el.style.opacity = "0";
    }, 2800);
    el.style.opacity = "1";
  }

  function dest(room) {
    if (room.match_over && room.state === "results") return "/podium";
    if (room.state === "lobby") return "/lobby";
    if (room.state === "playing") return "/arena";
    if (room.state === "verifying" || room.state === "results") return "/results";
    return "/";
  }

  function postForm(url, fields) {
    var form = document.createElement("form");
    form.method = "POST";
    form.action = url;
    Object.keys(fields || {}).forEach(function (k) {
      var v = fields[k];
      if (Array.isArray(v)) {
        v.forEach(function (item) {
          var input = document.createElement("input");
          input.type = "hidden";
          input.name = k;
          input.value = item;
          form.appendChild(input);
        });
      } else {
        var input = document.createElement("input");
        input.type = "hidden";
        input.name = k;
        input.value = v;
        form.appendChild(input);
      }
    });
    document.body.appendChild(form);
    form.submit();
  }

  // ---- Socket (live sync only) ----
  var socket = null;
  if (window.io) {
    socket = io();
    socket.on("connect", function () {
      if (boot && boot.code && boot.you) {
        socket.emit("sync", { code: boot.code, player_id: boot.you });
      }
    });
    socket.on("room_state", function (room) {
      var path = dest(room);
      if (location.pathname !== path) {
        location.href = path;
        return;
      }
      if (page === "lobby") location.reload();
      if (page === "results" && boot && boot.state === "verifying" && room.state === "results") {
        location.reload();
      }
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
    socket.on("error", function (err) {
      toast((err && err.message) || "შეცდომა");
    });
  }

  // ---- HOME ----
  if (page === "home") {
    var nick = document.getElementById("nickname-input");
    var createBtn = document.getElementById("create-room-btn");
    var joinBtn = document.getElementById("join-room-btn");
    var codeInput = document.getElementById("room-code-input");
    if (nick) nick.value = "";
    if (codeInput) codeInput.value = "";

    // Optional extras UI near create card
    if (createBtn && !document.getElementById("q-extra-cats")) {
      var box = document.createElement("div");
      box.id = "q-extra-cats";
      box.style.cssText = "margin:12px 0;font-size:13px;color:#d7c3ae;";
      box.innerHTML =
        '<div style="margin-bottom:6px;font-weight:700;color:#d6e4f9;">დამატებითი კატეგორიები</div>' +
        OPTIONAL.map(function (k) {
          return (
            '<label style="display:inline-flex;align-items:center;gap:6px;margin-right:12px;cursor:pointer;">' +
            '<input type="checkbox" data-extra="' +
            k +
            '"/> ' +
            LABELS[k] +
            "</label>"
          );
        }).join("") +
        '<div style="margin-top:6px;opacity:.8;">სავალდებულო: ქვეყანა, ქალაქი, ცხოველი, მცენარე, სახელი, მდინარე</div>';
      createBtn.parentElement.insertBefore(box, createBtn);
    }

    if (createBtn) {
      createBtn.addEventListener(
        "click",
        function (e) {
          e.preventDefault();
          e.stopImmediatePropagation();
          var name = (nick && nick.value.trim()) || "";
          if (!name) return toast("შეიყვანე მეტსახელი");
          var extras = Array.prototype.map.call(
            document.querySelectorAll("[data-extra]:checked"),
            function (el) {
              return el.getAttribute("data-extra");
            }
          );
          postForm("/create", {
            player_name: name,
            max_rounds: "5",
            round_seconds: "60",
            extra: extras,
          });
        },
        true
      );
    }

    if (joinBtn) {
      joinBtn.addEventListener(
        "click",
        function (e) {
          e.preventDefault();
          e.stopImmediatePropagation();
          var name = (nick && nick.value.trim()) || "";
          var code = (codeInput && codeInput.value.trim()) || "";
          if (!name) return toast("შეიყვანე მეტსახელი");
          if (!code) return toast("შეიყვანე ოთახის კოდი");
          postForm("/join", { player_name: name, code: code });
        },
        true
      );
    }
  }

  // ---- LOBBY ----
  if (page === "lobby" && boot) {
    var codeEl = document.getElementById("roomCodeDisplay");
    if (codeEl) codeEl.textContent = boot.code;

    document.querySelectorAll("header .font-mono.tracking-widest").forEach(function (el) {
      el.textContent = "#" + boot.code;
    });

    // Override copy to use real code
    window.copyRoomCode = function () {
      navigator.clipboard.writeText(boot.code).then(function () {
        toast("კოდი დაკოპირდა");
      });
    };

    // Rebuild player list from server
    // Prefer the player slots container under "მოთამაშეთა სია"
    document.querySelectorAll("h2").forEach(function (h) {
      if ((h.textContent || "").indexOf("მოთამაშეთა") < 0) return;
      var section = h.closest(".bg-surface-container-low, .bg-surface-container, section, div");
      if (!section) return;
      var slots = section.querySelector(".flex.flex-col.gap-space-xs.sm\\:gap-space-sm, .flex.flex-col");
      if (!slots) return;
      var players = boot.players || [];
      var countBadge = section.querySelector(".rounded-full.bg-secondary-container\\/20, .px-2.py-0\\.5.rounded-full");
      if (countBadge) countBadge.textContent = players.length + " / 8";
      slots.innerHTML = players
        .map(function (p) {
          var host =
            p.id === boot.host_id
              ? '<span class="px-1.5 py-0.5 rounded bg-primary/20 text-primary font-label-sm text-label-sm uppercase tracking-wide">მასპინძელი</span>'
              : "";
          var you = p.id === boot.you ? " (შენ)" : "";
          return (
            '<div class="group relative rounded-xl bg-surface-container p-space-sm sm:p-space-md flex items-center justify-between shadow-md">' +
            '<div class="flex items-center gap-space-sm min-w-0"><div class="w-12 h-12 rounded-xl bg-surface-container-highest flex items-center justify-center text-secondary font-bold shrink-0 shadow-md"><span class="material-symbols-outlined text-[24px]">person</span></div>' +
            '<div class="flex flex-col min-w-0"><div class="flex items-center gap-1.5"><span class="font-body-lg text-body-lg text-on-surface truncate font-bold">' +
            (p.name || "") +
            you +
            "</span>" +
            host +
            '</div></div></div>' +
            '<div class="px-space-sm py-1 rounded-lg bg-surface-container-lowest flex items-center gap-1.5"><span class="relative inline-flex rounded-full h-2 w-2 bg-secondary"></span><span class="font-label-sm text-label-sm text-secondary font-bold uppercase tracking-wider">ონლაინ</span></div></div>'
          );
        })
        .join("");
    });

    var startBtn = document.getElementById("startGameBtn");
    if (startBtn) {
      if (boot.host_id !== boot.you) {
        startBtn.style.display = "none";
      }
      startBtn.addEventListener(
        "click",
        function (e) {
          e.preventDefault();
          e.stopImmediatePropagation();
          postForm("/lobby/start", {});
        },
        true
      );
    }
  }

  // ---- ARENA ----
  if (page === "arena" && boot) {
    var letter = boot.letter || "";
    document.querySelectorAll(".font-display-letter").forEach(function (el) {
      el.textContent = letter;
    });
    // Per-input letter prefixes (designer UI)
    document.querySelectorAll(".pl-3.pr-1.text-primary").forEach(function (el) {
      el.textContent = letter;
    });

    // Map known inputs if present; otherwise leave designer layout
    var catMap = {
      country: "cat-country",
      city: "cat-city",
      animal: "cat-animal",
      plant: "cat-plant",
      name: "cat-name",
      river: "cat-river",
      film: "cat-film",
      food: "cat-food",
    };

    function collect() {
      var answers = {};
      (boot.categories || []).forEach(function (cat) {
        var id = catMap[cat];
        var input = id && document.getElementById(id);
        var rest = input ? input.value.trim() : "";
        // Designer UI often shows letter separately; prepend if missing
        if (rest && letter && rest.charAt(0) !== letter) rest = letter + rest;
        if (!rest) rest = "";
        answers[cat] = rest;
      });
      return answers;
    }

    function save() {
      if (!socket) return;
      socket.emit("update_answers", {
        code: boot.code,
        player_id: boot.you,
        answers: collect(),
      });
    }

    Object.keys(catMap).forEach(function (cat) {
      var input = document.getElementById(catMap[cat]);
      if (!input) return;
      // Clear designer mock defaults, then prefill from server
      var existing = ((boot.answers && boot.answers[boot.you]) || {})[cat] || "";
      if (existing && letter && existing.charAt(0) === letter) {
        input.value = existing.slice(1);
      } else if (existing) {
        input.value = existing;
      } else {
        input.value = "";
      }
      input.addEventListener("input", function () {
        clearTimeout(input._t);
        input._t = setTimeout(save, 300);
      });
    });

    // Hide categories not in this room
    Object.keys(catMap).forEach(function (cat) {
      if ((boot.categories || []).indexOf(cat) >= 0) return;
      var input = document.getElementById(catMap[cat]);
      if (input) {
        var card = input.closest(".bg-surface-container, .bg-surface-container-high, .rounded-xl");
        if (card) card.style.display = "none";
      }
    });

    var stopBtn = document.getElementById("btn-stop-buzzer");
    if (stopBtn) {
      stopBtn.addEventListener(
        "click",
        function (e) {
          e.preventDefault();
          e.stopImmediatePropagation();
          save();
          setTimeout(function () {
            postForm("/arena/stop", collect());
          }, 80);
        },
        true
      );
    }

    var sim = document.getElementById("btn-simulate-stop");
    if (sim) sim.style.display = "none";

    // Timer from server setting
    var timerEl = document.getElementById("game-timer");
    if (timerEl) {
      var left = boot.round_seconds || 60;
      var tick = setInterval(function () {
        var m = String(Math.floor(left / 60)).padStart(2, "0");
        var s = String(left % 60).padStart(2, "0");
        timerEl.textContent = m + ":" + s;
        if (left <= 0) {
          clearInterval(tick);
          save();
          postForm("/arena/stop", collect());
          return;
        }
        left -= 1;
      }, 1000);
    }
  }

  // ---- RESULTS ----
  if (page === "results" && boot) {
    // Pending: hide matrix, show message
    var matrix = document.querySelector("table");
    var matrixWrap = matrix && matrix.closest(".xl\\:col-span-9");
    var side = document.querySelector(".xl\\:col-span-3");

    if (boot.state === "verifying") {
      if (matrixWrap) matrixWrap.style.display = "none";
      if (side) side.style.display = "none";
      if (!document.getElementById("q-pending")) {
        var panel = document.createElement("div");
        panel.id = "q-pending";
        panel.style.cssText =
          "min-height:280px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:#0f1c2c;border-radius:12px;padding:48px;text-align:center;margin:16px auto;max-width:1280px;";
        panel.innerHTML =
          '<div style="width:56px;height:56px;border:4px solid rgba(72,241,229,.3);border-top-color:#48f1e5;border-radius:50%;animation:qspin 1s linear infinite"></div>' +
          "<h2 style=\"color:#d6e4f9;font:800 24px Plus Jakarta Sans,sans-serif;margin:0\">შედეგები მზადდება…</h2>" +
          "<p style=\"color:#d7c3ae;margin:0\">Results are pending</p>" +
          "<style>@keyframes qspin{to{transform:rotate(360deg)}}</style>";
        var main = document.querySelector("main");
        if (main) main.appendChild(panel);
      }
    } else if (boot.state === "results" && matrix) {
      // Replace mock table with live scores
      var thead = matrix.querySelector("thead tr");
      var tbody = matrix.querySelector("tbody");
      if (thead && tbody) {
        thead.innerHTML =
          "<th style=\"text-align:left;padding:8px\">მოთამაშე</th>" +
          (boot.categories || [])
            .map(function (c) {
              return (
                "<th style=\"padding:8px\">" + (LABELS[c] || c) + "</th>"
              );
            })
            .join("") +
          "<th style=\"padding:8px\">ჯამი</th>";
        tbody.innerHTML = (boot.players || [])
          .map(function (p) {
            var pts = (boot.round_points && boot.round_points[p.id]) || {};
            var total = (boot.round_totals && boot.round_totals[p.id]) || 0;
            var cells = (boot.categories || [])
              .map(function (c) {
                var ans =
                  ((boot.answers && boot.answers[p.id]) || {})[c] || "—";
                var score = pts[c];
                var v =
                  ((boot.verdicts && boot.verdicts[p.id]) || {})[c] || {};
                var ok = v.valid;
                var color = ok ? "#48f1e5" : "#ff9a98";
                return (
                  "<td style=\"padding:8px;color:" +
                  color +
                  "\">" +
                  ans +
                  (score != null ? " <b>+" + score + "</b>" : "") +
                  "</td>"
                );
              })
              .join("");
            return (
              "<tr><td style=\"padding:8px;font-weight:700\">" +
              (p.name || p.id) +
              "</td>" +
              cells +
              "<td style=\"padding:8px;font-weight:800\">" +
              total +
              "</td></tr>"
            );
          })
          .join("");
      }
    }

    // Patch AI Web Search labels if still in DOM
    document.querySelectorAll("span,p").forEach(function (el) {
      if ((el.textContent || "").indexOf("AI Web Search") >= 0) {
        el.textContent = "შედეგები მზადდება…";
      }
      if ((el.textContent || "").indexOf("FastAPI") >= 0) {
        el.textContent = "Results pending";
      }
    });

    var nextBtn = document.getElementById("nextRoundBtn");
    if (nextBtn) {
      if (boot.host_id !== boot.you || boot.state !== "results") {
        nextBtn.style.visibility = "hidden";
      }
      nextBtn.addEventListener(
        "click",
        function (e) {
          e.preventDefault();
          e.stopImmediatePropagation();
          if (boot.match_over) {
            location.href = "/podium";
            return;
          }
          postForm("/results/next", {});
        },
        true
      );
    }
  }

  // ---- PODIUM ----
  if (page === "podium" && boot) {
    var ranked = (boot.players || []).slice().sort(function (a, b) {
      return (b.total_score || 0) - (a.total_score || 0);
    });

    // Top-3 name + score spots in designer podium
    // Collect podium name spans + big score numbers
    var podiumNames = Array.prototype.slice.call(
      document.querySelectorAll(
        ".font-headline-md.text-primary.font-bold, .font-headline-sm.text-on-surface"
      )
    );
    var podiumScores = Array.prototype.slice.call(
      document.querySelectorAll(".font-display-letter")
    ).filter(function (el) {
      return /^\d+$/.test((el.textContent || "").trim());
    });
    // Designer order on md: 2nd, 1st, 3rd visually — map carefully
    // Visual DOM order: 2nd block, 1st block, 3rd block
    var mapIdx = [1, 0, 2]; // DOM index -> rank index
    podiumNames.slice(0, 3).forEach(function (el, i) {
      var r = ranked[mapIdx[i]];
      if (r) {
        el.textContent =
          r.id === boot.you ? "შენ (" + r.name + ")" : r.name;
      } else {
        el.textContent = "—";
      }
    });
    podiumScores.slice(0, 3).forEach(function (el, i) {
      var r = ranked[mapIdx[i]];
      el.textContent = r ? String(r.total_score || 0) : "0";
    });

    var replay = document.getElementById("btn-replay");
    if (replay) {
      if (boot.host_id !== boot.you) replay.style.display = "none";
      replay.addEventListener(
        "click",
        function (e) {
          e.preventDefault();
          e.stopImmediatePropagation();
          postForm("/podium/lobby", {});
        },
        true
      );
    }
    document.querySelectorAll('a[data-path="lobbies"]').forEach(function (a) {
      a.addEventListener("click", function (e) {
        e.preventDefault();
        postForm("/leave", {});
      });
    });
  }
})();
