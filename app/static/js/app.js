/**
 * Qalaqobana — Socket.IO UI for clean deploy templates.
 */
(function () {
  const CAT = {
    country: { ka: "ქვეყანა", emoji: "🌍" },
    city: { ka: "ქალაქი", emoji: "🏙️" },
    animal: { ka: "ცხოველი", emoji: "🐾" },
    plant: { ka: "მცენარე", emoji: "🌿" },
    name: { ka: "სახელი", emoji: "👤" },
    river: { ka: "მდინარე", emoji: "🌊" },
    film: { ka: "ფილმი", emoji: "🎬" },
    food: { ka: "საჭმელი", emoji: "🍽️" },
  };
  const REQUIRED_CATS = ["country", "city", "animal", "plant", "name"];
  
  const PATHS = { home: "/", lobby: "/lobby", arena: "/arena", results: "/results", podium: "/podium" };

  const page = detectPage();
  const client = window.QalaqobanaClient.create();
  let latestRoom = null;
  let answerTimer = null;
  let countdownTimer = null;
  let stoppedLocally = false;

  function detectPage() {
    const p = location.pathname.replace(/\/$/, "") || "/";
    if (p === "/" || p === "/home") return "home";
    if (p.includes("lobby")) return "lobby";
    if (p.includes("arena")) return "arena";
    if (p.includes("results")) return "results";
    if (p.includes("podium")) return "podium";
    return "home";
  }

  function go(path) {
    if (location.pathname !== path) location.href = path;
  }

  function routeForState(room) {
    if (!room) return PATHS.home;
    if (room.match_over) return PATHS.podium;
    switch (room.state) {
      case "lobby":
        return PATHS.lobby;
      case "playing":
        return PATHS.arena;
      case "verifying":
      case "results":
        return PATHS.results;
      default:
        return PATHS.lobby;
    }
  }

  function ensureOnCorrectPage(room) {
    const want = routeForState(room);
    if (want !== location.pathname && want !== location.pathname.replace(/\/$/, "")) {
      go(want);
    }
  }

  function toast(msg) {
    let el = document.getElementById("q-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "q-toast";
      el.style.cssText =
        "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:9999;" +
        "background:#1e2b3b;color:#d6e4f9;padding:10px 18px;border-radius:10px;font:600 14px Plus Jakarta Sans,sans-serif;" +
        "box-shadow:0 8px 24px rgba(0,0,0,.45);max-width:90vw;text-align:center";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = "1";
    clearTimeout(el._t);
    el._t = setTimeout(() => {
      el.style.opacity = "0";
    }, 2800);
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, "&#39;");
  }
  function initial(name) {
    return String(name || "?").trim().charAt(0).toUpperCase() || "?";
  }
  function isHostOf(room) {
    return !!(room && room.you && String(room.host_id) === String(room.you));
  }

  function updateChrome(room) {
    if (!room) return;
    const codeEl = document.getElementById("header-room-code");
    const scoreEl = document.getElementById("header-score");
    const leaveBtn = document.getElementById("leave-btn");
    if (codeEl) {
      codeEl.textContent = "#" + room.code;
      codeEl.classList.remove("hidden");
    }
    const me = (room.players || []).find((p) => p.id === room.you);
    if (scoreEl) {
      scoreEl.textContent = (me ? me.total_score : 0) + " ქ";
      scoreEl.classList.remove("hidden");
    }
    if (leaveBtn) leaveBtn.classList.remove("hidden");
  }

  const leaveBtn = document.getElementById("leave-btn");
  if (leaveBtn) {
    leaveBtn.addEventListener("click", () => {
      client.leaveRoom();
      client.clearSession();
      go(PATHS.home);
    });
  }

  // ---------- HOME ----------
  function initHome() {
    const nick = document.getElementById("nickname-input");
    const createBtn = document.getElementById("create-room-btn");
    const joinBtn = document.getElementById("join-room-btn");
    const codeInput = document.getElementById("room-code-input");
    const pasteBtn = document.getElementById("paste-btn");
    const randomBtn = document.getElementById("random-nick-btn");
    const soloBtn = document.getElementById("solo-start-btn");

    const nicks = [
      "ქართველი_არწივი",
      "მთის_შევარდენი",
      "სიტყვების_ოსტატი",
      "მტკვრის_ტალღა",
      "თბილისელი_გურუ",
      "სხარტი_გონება",
    ];

    let maxRounds = 5;
    let roundSeconds = 60;
    let soloPending = false;

    const IDLE = "px-2.5 py-1 rounded text-xs font-bold text-on-surface-variant";
    const ACTIVE_S = "px-2.5 py-1 rounded text-xs font-bold bg-primary text-on-primary";
    const ACTIVE_R = "px-2.5 py-1 rounded text-xs font-bold bg-secondary text-on-secondary";

    function paint(root, attr, value, active) {
      if (!root) return;
      root.querySelectorAll("button[" + attr + "]").forEach((btn) => {
        btn.className = String(btn.getAttribute(attr)) === String(value) ? active : IDLE;
      });
    }

    const secondsPicker = document.getElementById("home-seconds-picker");
    const roundsPicker = document.getElementById("home-rounds-picker");
    if (secondsPicker) {
      secondsPicker.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-seconds]");
        if (!btn) return;
        roundSeconds = parseInt(btn.getAttribute("data-seconds"), 10);
        paint(secondsPicker, "data-seconds", roundSeconds, ACTIVE_S);
      });
    }
    if (roundsPicker) {
      roundsPicker.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-rounds]");
        if (!btn) return;
        maxRounds = parseInt(btn.getAttribute("data-rounds"), 10);
        paint(roundsPicker, "data-rounds", maxRounds, ACTIVE_R);
      });
    }

    if (randomBtn && nick) {
      randomBtn.onclick = () => {
        nick.value = nicks[Math.floor(Math.random() * nicks.length)];
      };
    }
    if (pasteBtn && codeInput) {
      pasteBtn.onclick = async () => {
        try {
          codeInput.value = (await navigator.clipboard.readText()).trim().toUpperCase();
        } catch (e) {
          toast("კოპირება ვერ მოხერხდა");
        }
      };
    }
    if (codeInput) {
      codeInput.addEventListener("input", () => {
        codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
      });
    }

    // Prefill join code from ?join=
    const joinParam = new URLSearchParams(location.search).get("join");
    if (joinParam && codeInput) codeInput.value = joinParam.toUpperCase();

    function requireName() {
      const name = (nick && nick.value.trim()) || "";
      if (!name) {
        toast("შეიყვანე მეტსახელი");
        if (nick) nick.focus();
        return null;
      }
      return name;
    }

    function createWithSettings(name) {
      client.createRoom(name, {
        categories: REQUIRED_CATS.slice(),
        maxRounds: maxRounds,
        roundSeconds: roundSeconds,
      });
    }

    if (createBtn) {
      createBtn.addEventListener("click", () => {
        const name = requireName();
        if (!name) return;
        soloPending = false;
        createBtn.disabled = true;
        createWithSettings(name);
      });
    }
    if (joinBtn) {
      joinBtn.addEventListener("click", () => {
        const name = requireName();
        if (!name) return;
        const code = (codeInput && codeInput.value.trim()) || "";
        if (!code) {
          toast("შეიყვანე ოთახის კოდი");
          return;
        }
        soloPending = false;
        joinBtn.disabled = true;
        client.joinRoom(code, name);
      });
    }
    if (soloBtn) {
      soloBtn.addEventListener("click", () => {
        const name = requireName();
        if (!name) return;
        soloPending = true;
        soloBtn.disabled = true;
        createWithSettings(name);
      });
    }

    client.on("room_created", () => {
      if (soloPending) sessionStorage.setItem("qalaqobana_solo_start", "1");
      soloPending = false;
      go(PATHS.lobby);
    });
    client.on("room_joined", () => {
      soloPending = false;
      go(PATHS.lobby);
    });
    client.on("error", (err) => {
      soloPending = false;
      if (createBtn) createBtn.disabled = false;
      if (joinBtn) joinBtn.disabled = false;
      if (soloBtn) soloBtn.disabled = false;
      toast((err && err.message) || "შეცდომა");
    });

    // Resume in-progress session
    const session = client.loadSession();
    if (session.roomCode && session.playerId) {
      client.on("room_state", (room) => {
        latestRoom = room;
        ensureOnCorrectPage(room);
      });
      client.socket.on("connect", () => client.sync());
      if (client.socket.connected) client.sync();
    }
  }

  // ---------- LOBBY ----------
  function initLobby() {
    const session = client.loadSession();
    if (!session.roomCode || !session.playerId) {
      go(PATHS.home);
      return;
    }

    const codeEl = document.getElementById("roomCodeDisplay");
    const listEl = document.getElementById("playerList");
    const countBadge = document.getElementById("playerCountBadge");
    const settingsEl = document.getElementById("lobby-settings");
    const gridRoot = document.getElementById("categoryGrid");
    const startBtn = document.getElementById("startGameBtn");
    const copyBtn = document.getElementById("copyBtn");
    const shareBtn = document.getElementById("shareBtn");

    function roomCode() {
      return (latestRoom && latestRoom.code) || session.roomCode;
    }

    if (copyBtn) {
      copyBtn.onclick = () => {
        navigator.clipboard.writeText(roomCode()).then(() => toast("კოდი დაკოპირდა")).catch(() => toast(roomCode()));
      };
    }
    if (shareBtn) {
      shareBtn.onclick = () => {
        const url = location.origin + "/?join=" + roomCode();
        if (navigator.share) navigator.share({ title: "ქალაქობანა", text: "შემომიერთდი: " + roomCode(), url: url });
        else navigator.clipboard.writeText(url).then(() => toast("ბმული დაკოპირდა"));
      };
    }
    if (startBtn) {
      startBtn.addEventListener("click", () => {
        if (!isHostOf(latestRoom)) {
          toast("მხოლოდ მასპინძელი იწყებს");
          return;
        }
        startBtn.disabled = true;
        client.startRound();
      });
    }

    function collectCheckedCats() {
      const cats = Array.from(gridRoot.querySelectorAll("input[data-cat]:checked")).map((i) =>
        i.getAttribute("data-cat")
      );
      REQUIRED_CATS.forEach((r) => {
        if (cats.indexOf(r) < 0) cats.push(r);
      });
      return cats;
    }

    if (gridRoot && !gridRoot._qBound) {
      gridRoot._qBound = true;
      gridRoot.addEventListener("change", (e) => {
        const input = e.target;
        if (!input.matches || !input.matches("input[data-cat]")) return;
        if (!isHostOf(latestRoom)) {
          toast("მხოლოდ მასპინძელი ირჩევს კატეგორიებს");
          input.checked = (latestRoom.categories || []).indexOf(input.getAttribute("data-cat")) >= 0;
          return;
        }
        const key = input.getAttribute("data-cat");
        if (!input.checked && REQUIRED_CATS.indexOf(key) >= 0) {
          toast("ეს კატეგორია სავალდებულოა");
          input.checked = true;
          return;
        }
        const cats = collectCheckedCats();
        const badge = document.getElementById("categoryCountBadge");
        if (badge) badge.textContent = cats.length + " არჩეულია";
        client.setSettings({ categories: cats });
      });
    }

    function renderLobby(room) {
      updateChrome(room);
      if (codeEl) codeEl.textContent = room.code;
      if (settingsEl) {
        settingsEl.textContent = room.max_rounds + " რაუნდი · " + room.round_seconds + " წმ / რაუნდი";
      }
      const players = room.players || [];
      if (countBadge) countBadge.textContent = players.length + " / 8";
      if (listEl) {
        listEl.innerHTML = players
          .map((p) => {
            const host = p.id === room.host_id;
            const you = p.id === room.you;
            return `<div class="flex items-center justify-between p-3.5 rounded-xl ${you ? "bg-surface-container-high border border-secondary/20" : "bg-surface-container border border-surface-variant/20"} shadow-md">
              <div class="flex items-center gap-3 min-w-0">
                <div class="w-11 h-11 rounded-xl ${host ? "bg-gradient-to-tr from-amber-600 to-primary text-on-primary shadow-[0_0_16px_rgba(245,166,35,0.35)]" : "bg-surface-container-highest text-secondary"} flex items-center justify-center font-bold shrink-0">${initial(p.name)}</div>
                <div class="min-w-0">
                  <div class="flex items-center gap-1.5 flex-wrap">
                    <span class="font-bold truncate">${escapeHtml(p.name)}</span>
                    ${host ? '<span class="text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary font-bold">მასპინძელი</span>' : ""}
                    ${you ? '<span class="text-[10px] px-1.5 py-0.5 rounded bg-secondary/20 text-secondary font-bold">შენ</span>' : ""}
                  </div>
                  <span class="text-xs text-on-surface-variant">${p.total_score} ქ</span>
                </div>
              </div>
            </div>`;
          })
          .join("");
      }

      if (gridRoot) {
        const host = isHostOf(room);
        gridRoot.innerHTML = Object.keys(CAT)
          .map((key) => {
            const checked = (room.categories || []).indexOf(key) >= 0 ? "checked" : "";
            const req = REQUIRED_CATS.indexOf(key) >= 0;
            return `<label class="flex items-center justify-between gap-2 p-3 rounded-xl bg-surface-container border border-surface-variant/25 cursor-pointer hover:bg-surface-container-high transition ${host ? "" : "opacity-70"}">
              <span class="flex items-center gap-2 text-sm font-semibold">
                <span class="text-lg">${CAT[key].emoji}</span><span>${CAT[key].ka}</span>${req ? '<span class="text-on-surface-variant text-xs">*</span>' : ""}
              </span>
              <input data-cat="${key}" type="checkbox" ${checked} class="w-4 h-4 accent-secondary"/>
            </label>`;
          })
          .join("");
        const badge = document.getElementById("categoryCountBadge");
        if (badge) badge.textContent = (room.categories || []).length + " არჩეულია";
      }

      if (startBtn) {
        startBtn.style.display = isHostOf(room) ? "" : "none";
        startBtn.disabled = false;
        startBtn.textContent = "თამაშის დაწყება (" + players.length + "/8)";
      }
    }

    let soloKickoffDone = false;
    client.on("room_state", (room) => {
      latestRoom = room;
      renderLobby(room);
      ensureOnCorrectPage(room);
      if (
        !soloKickoffDone &&
        sessionStorage.getItem("qalaqobana_solo_start") === "1" &&
        room.state === "lobby" &&
        isHostOf(room)
      ) {
        soloKickoffDone = true;
        sessionStorage.removeItem("qalaqobana_solo_start");
        setTimeout(() => client.startRound(), 200);
      }
    });
    client.on("round_started", () => go(PATHS.arena));
    client.on("error", (err) => {
      if (startBtn) startBtn.disabled = false;
      toast((err && err.message) || "შეცდომა");
    });
    client.socket.on("connect", () => client.sync());
    if (client.socket.connected) client.sync();
  }

  // ---------- ARENA ----------
  function initArena() {
    const session = client.loadSession();
    if (!session.roomCode || !session.playerId) {
      go(PATHS.home);
      return;
    }

    const forms = document.getElementById("answerForms");
    const stopBtn = document.getElementById("btn-stop-buzzer");
    const timerEl = document.getElementById("game-timer");
    const banner = document.getElementById("stop-announcement-banner");
    const letterEl = document.getElementById("arena-letter");
    const roundEl = document.getElementById("arena-round");
    const scoresEl = document.getElementById("arena-scores");
    let formsBuiltFor = null;

    function gatherAnswers() {
      const out = {};
      document.querySelectorAll("[data-answer-cat]").forEach((input) => {
        const letter = (latestRoom && latestRoom.letter) || "";
        out[input.getAttribute("data-answer-cat")] = (letter + (input.value || "")).trim();
      });
      return out;
    }

    function scheduleSave() {
      clearTimeout(answerTimer);
      answerTimer = setTimeout(() => {
        if (!latestRoom || latestRoom.state !== "playing") return;
        client.updateAnswers(gatherAnswers());
      }, 250);
    }

    function startCountdown(seconds) {
      clearInterval(countdownTimer);
      let left = seconds;
      const tick = () => {
        if (timerEl) {
          timerEl.textContent =
            String(Math.floor(left / 60)).padStart(2, "0") + ":" + String(left % 60).padStart(2, "0");
        }
        if (left <= 0) {
          clearInterval(countdownTimer);
          if (!stoppedLocally && latestRoom && latestRoom.state === "playing") {
            stoppedLocally = true;
            client.stopRound();
          }
          return;
        }
        left -= 1;
      };
      tick();
      countdownTimer = setInterval(tick, 1000);
    }

    function doStop() {
      if (stoppedLocally) return;
      stoppedLocally = true;
      client.updateAnswers(gatherAnswers());
      setTimeout(() => client.stopRound(), 50);
    }

    function renderArena(room) {
      updateChrome(room);
      if (letterEl) letterEl.textContent = room.letter || "—";
      if (roundEl) roundEl.textContent = "რაუნდი " + room.round_number + " / " + room.max_rounds;

      const key = room.code + ":" + room.round_number + ":" + (room.categories || []).join(",");
      if (forms && room.state === "playing" && formsBuiltFor !== key) {
        formsBuiltFor = key;
        forms.innerHTML = room.categories
          .map((cat) => {
            const meta = CAT[cat] || { ka: cat, emoji: "✨" };
            let existing = ((room.answers[room.you] || {})[cat] || "");
            if (room.letter && existing.startsWith(room.letter)) existing = existing.slice(room.letter.length);
            return `<label class="block bg-surface-container rounded-xl p-4 border border-surface-variant/25 hover:border-secondary/30 transition">
              <span class="text-sm font-bold flex items-center gap-2 mb-2">${meta.emoji} ${meta.ka}</span>
              <div class="flex items-center bg-surface-container-lowest rounded-lg px-3 focus-within:ring-2 focus-within:ring-secondary/40 border border-surface-variant/20">
                <span class="text-primary font-extrabold text-xl pr-2 select-none">${escapeHtml(room.letter || "")}</span>
                <input data-answer-cat="${cat}" value="${escapeAttr(existing)}" autocomplete="off"
                  class="w-full bg-transparent py-3 outline-none font-semibold" placeholder="ჩაწერე…"/>
              </div>
            </label>`;
          })
          .join("");
        forms.querySelectorAll("[data-answer-cat]").forEach((input) => {
          input.addEventListener("input", scheduleSave);
        });
      }

      if (scoresEl) {
        const ranked = [...(room.players || [])].sort((a, b) => b.total_score - a.total_score);
        scoresEl.innerHTML = ranked
          .map((p) => {
            const you = p.id === room.you;
            return `<div class="flex justify-between text-sm ${you ? "text-secondary font-bold" : "text-on-surface-variant"}">
              <span>${you ? "შენ" : escapeHtml(p.name)}</span>
              <span class="font-mono">${p.total_score}</span>
            </div>`;
          })
          .join("");
      }
    }

    if (stopBtn) stopBtn.addEventListener("click", doStop);
    window.addEventListener("keydown", (e) => {
      if (e.code === "Space" && e.target.tagName !== "INPUT") {
        e.preventDefault();
        doStop();
      }
    });

    client.on("room_state", (room) => {
      const first = !latestRoom;
      latestRoom = room;
      if (room.state === "playing") {
        renderArena(room);
        if (first || !countdownTimer) startCountdown(room.round_seconds || 60);
      }
      ensureOnCorrectPage(room);
    });
    client.on("round_stopped", (payload) => {
      clearInterval(countdownTimer);
      const who = payload && payload.stopped_by;
      const player = (latestRoom && latestRoom.players || []).find((p) => p.id === who);
      const name = player ? player.name : "მოთამაშე";
      if (banner) {
        banner.classList.remove("hidden");
        const h4 = banner.querySelector("h4");
        if (h4) h4.textContent = (who === (latestRoom && latestRoom.you) ? "შენ" : name) + " დააჭირა STOP-ს!";
      }
      document.querySelectorAll("[data-answer-cat]").forEach((i) => {
        i.disabled = true;
      });
      setTimeout(() => go(PATHS.results), 800);
    });
    client.on("error", (err) => {
      stoppedLocally = false;
      toast((err && err.message) || "შეცდომა");
    });
    client.socket.on("connect", () => client.sync());
    if (client.socket.connected) client.sync();
  }

  // ---------- RESULTS ----------
  function initResults() {
    const session = client.loadSession();
    if (!session.roomCode || !session.playerId) {
      go(PATHS.home);
      return;
    }

    const nextBtn = document.getElementById("nextRoundBtn");
    const pending = document.getElementById("q-pending");
    const body = document.getElementById("results-body");
    const table = document.getElementById("results-table");
    const sidebar = document.getElementById("results-sidebar");
    const letterEl = document.getElementById("results-letter");
    const titleEl = document.getElementById("results-title");

    if (nextBtn) {
      nextBtn.addEventListener("click", () => {
        if (!isHostOf(latestRoom)) {
          toast("მასპინძელი იწყებს შემდეგ რაუნდს");
          return;
        }
        if (latestRoom.match_over) {
          go(PATHS.podium);
          return;
        }
        client.nextRound();
      });
    }

    function pointsBadge(pts) {
      if (pts >= 15) return '<span class="text-[10px] font-bold text-secondary">+15</span>';
      if (pts >= 10) return '<span class="text-[10px] font-bold text-primary">+10</span>';
      if (pts >= 5) return '<span class="text-[10px] font-bold text-on-surface-variant">+5</span>';
      return '<span class="text-[10px] text-error">0</span>';
    }

    function renderResults(room) {
      updateChrome(room);
      if (letterEl) letterEl.textContent = room.letter || "—";

      const verifying = room.state === "verifying";
      if (pending) pending.classList.toggle("hidden", !verifying);
      if (body) body.classList.toggle("hidden", verifying || room.state !== "results");

      if (titleEl) {
        titleEl.textContent = verifying
          ? "რაუნდი " + room.round_number + " — შემოწმება…"
          : "რაუნდი " + room.round_number + "-ის შედეგები";
      }

      if (room.state !== "results" || verifying) return;

      const players = room.players || [];
      if (table) {
        const thead = table.querySelector("thead");
        const tbody = table.querySelector("tbody");
        if (thead) {
          thead.innerHTML =
            "<tr class=\"text-left text-on-surface-variant text-xs uppercase\">" +
            "<th class=\"py-2 pr-3\">კატეგორია</th>" +
            players
              .map((p) => {
                const you = p.id === room.you;
                return `<th class="py-2 px-2 ${you ? "text-secondary" : ""}">${you ? "შენ" : escapeHtml(p.name)}</th>`;
              })
              .join("") +
            "</tr>";
        }
        if (tbody) {
          tbody.innerHTML = (room.categories || [])
            .map((cat) => {
              const meta = CAT[cat] || { ka: cat, emoji: "✨" };
              const cells = players
                .map((p) => {
                  const v = ((room.verdicts[p.id] || {})[cat]) || {};
                  const pts = ((room.round_points[p.id] || {})[cat]) || 0;
                  const ans = v.answer || ((room.answers[p.id] || {})[cat]) || "—";
                  const invalid = v.valid === false;
                  return `<td class="py-2.5 px-2 align-top">
                    <div class="flex flex-col gap-0.5">
                      <span class="${invalid ? "line-through text-error" : ""} font-semibold">${escapeHtml(ans)}</span>
                      ${pointsBadge(pts)}
                    </div></td>`;
                })
                .join("");
              return `<tr class="border-t border-surface-variant/30">
                <td class="py-2.5 pr-3 font-bold whitespace-nowrap">${meta.emoji} ${meta.ka}</td>${cells}</tr>`;
            })
            .join("");
        }
      }

      if (sidebar) {
        const ranked = [...players].sort(
          (a, b) => (room.round_totals[b.id] || 0) - (room.round_totals[a.id] || 0)
        );
        sidebar.innerHTML = ranked
          .map((p, i) => {
            const you = p.id === room.you;
            return `<div class="flex items-center justify-between p-2.5 rounded-lg ${you ? "bg-surface-container-highest" : "bg-surface-container"}">
              <span class="font-bold text-sm truncate">${i + 1}. ${you ? "შენ" : escapeHtml(p.name)}</span>
              <span class="text-primary font-extrabold">+${room.round_totals[p.id] || 0}</span>
            </div>`;
          })
          .join("");
      }

      if (nextBtn) {
        nextBtn.style.display = isHostOf(room) ? "" : "none";
        nextBtn.textContent = room.match_over
          ? "ფინალური შედეგები"
          : "შემდეგი რაუნდი (" + (room.round_number + 1) + "/" + room.max_rounds + ")";
      }
    }

    client.on("room_state", (room) => {
      latestRoom = room;
      renderResults(room);
      if (!(room.match_over && room.state === "results")) ensureOnCorrectPage(room);
    });
    client.on("round_started", () => go(PATHS.arena));
    client.on("verification_complete", () => client.sync());
    client.on("error", (err) => toast((err && err.message) || "შეცდომა"));
    client.socket.on("connect", () => client.sync());
    if (client.socket.connected) client.sync();
  }

  // ---------- PODIUM ----------
  function initPodium() {
    const session = client.loadSession();
    if (!session.roomCode || !session.playerId) {
      go(PATHS.home);
      return;
    }

    const replay = document.getElementById("btn-replay");
    const standings = document.getElementById("podium-standings");
    const topEl = document.getElementById("podium-top");
    const sub = document.getElementById("podium-subtitle");

    if (replay) {
      replay.addEventListener("click", () => {
        if (!isHostOf(latestRoom)) {
          toast("მასპინძელი აბრუნებს ლობიში");
          return;
        }
        client.returnLobby();
      });
    }

    document.querySelectorAll('a[data-path="lobbies"]').forEach((a) => {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        client.leaveRoom();
        client.clearSession();
        go(PATHS.home);
      });
    });

    function renderPodium(room) {
      updateChrome(room);
      const ranked = [...(room.players || [])].sort((a, b) => b.total_score - a.total_score);
      if (sub) sub.textContent = room.max_rounds + " რაუნდი · ოთახი #" + room.code;

      if (topEl) {
        const medals = ["🥇", "🥈", "🥉"];
        topEl.innerHTML = ranked
          .slice(0, 3)
          .map((p, i) => {
            const you = p.id === room.you;
            const size = i === 0 ? "text-2xl" : "text-lg";
            return `<div class="flex-1 bg-surface-container-low rounded-2xl p-5 text-center border border-surface-variant/30 shadow-lg ${i === 0 ? "sm:mb-6 sm:scale-105 border-primary/30 shadow-[0_0_32px_rgba(245,166,35,0.2)]" : ""}">
              <div class="text-3xl mb-2">${medals[i]}</div>
              <div class="${size} font-extrabold ${you ? "text-secondary" : "text-on-surface"} truncate">${escapeHtml(p.name)}</div>
              <div class="text-primary font-mono font-extrabold text-xl mt-2">${p.total_score} ქ</div>
            </div>`;
          })
          .join("");
      }

      if (standings) {
        standings.innerHTML = ranked
          .map((p, i) => {
            const you = p.id === room.you;
            return `<div class="flex items-center justify-between p-3 rounded-lg ${you ? "bg-secondary/10" : "bg-surface-container"}">
              <div class="flex items-center gap-2.5 min-w-0">
                <span class="w-6 text-center font-bold text-on-surface-variant">${i + 1}</span>
                <span class="w-8 h-8 rounded-full bg-surface-variant flex items-center justify-center font-bold text-sm">${initial(p.name)}</span>
                <span class="font-bold truncate ${you ? "text-secondary" : ""}">${you ? "შენ (" + escapeHtml(p.name) + ")" : escapeHtml(p.name)}</span>
              </div>
              <span class="font-mono font-bold">${p.total_score} ქ</span>
            </div>`;
          })
          .join("");
      }

      if (replay) replay.style.display = isHostOf(room) ? "" : "none";
    }

    client.on("room_state", (room) => {
      latestRoom = room;
      renderPodium(room);
      if (room.state === "lobby") go(PATHS.lobby);
    });
    client.on("error", (err) => toast((err && err.message) || "შეცდომა"));
    client.socket.on("connect", () => client.sync());
    if (client.socket.connected) client.sync();
  }

  client.on("error", (err) => toast((err && err.message) || "შეცდომა"));

  if (page === "home") initHome();
  if (page === "lobby") initLobby();
  if (page === "arena") initArena();
  if (page === "results") initResults();
  if (page === "podium") initPodium();
})();
