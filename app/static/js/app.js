/**
 * Qalaqobana UI wiring - connects designed screens to the Flask Socket.IO backend.
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

  const PATHS = {
    home: "/",
    lobby: "/lobby",
    arena: "/arena",
    results: "/results",
    podium: "/podium",
  };

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
    if (!room || page === "home") return;
    const target = routeForState(room);
    const here =
      page === "home"
        ? PATHS.home
        : page === "lobby"
          ? PATHS.lobby
          : page === "arena"
            ? PATHS.arena
            : page === "results"
              ? PATHS.results
              : PATHS.podium;
    if (target !== here) go(target);
  }

  function toast(msg) {
    let el = document.getElementById("q-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "q-toast";
      el.style.cssText =
        "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:9999;background:#1e2b3b;color:#d6e4f9;padding:12px 18px;border-radius:12px;font:600 14px Plus Jakarta Sans,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.45);max-width:90vw;";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = "1";
    clearTimeout(el._t);
    el._t = setTimeout(() => {
      el.style.opacity = "0";
    }, 3200);
  }

  function initial(name) {
    return (name || "?").trim().charAt(0).toUpperCase();
  }

  function pointsBadge(pts) {
    if (pts === 15)
      return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary-container text-on-primary-container text-xs font-bold w-fit">⭐ +15</span>`;
    if (pts === 10)
      return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#2ECC71]/20 text-[#2ECC71] text-xs font-bold w-fit">+10</span>`;
    if (pts === 5)
      return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary-container/20 text-primary text-xs font-bold w-fit">+5</span>`;
    return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-error-container/30 text-error text-xs font-bold w-fit">0</span>`;
  }

  function updateChrome(room) {
    if (!room) return;
    document.querySelectorAll("header .font-mono.tracking-widest").forEach((el) => {
      if (el.closest("header")) el.textContent = "#" + room.code;
    });
    document.querySelectorAll("[data-live-room-code]").forEach((el) => {
      el.textContent = room.code;
    });
    const players = (room.players || []).filter((p) => p.connected);
    document.querySelectorAll("header").forEach(() => {});
    // session score for you
    const me = (room.players || []).find((p) => p.id === room.you);
    const scoreEls = Array.from(document.querySelectorAll("header span")).filter((s) =>
      s.textContent.includes("სესიის ქულა")
    );
    scoreEls.forEach((span) => {
      const val = span.querySelector("span");
      if (val) val.textContent = String((me && me.total_score) || 0);
    });
    const countEls = Array.from(document.querySelectorAll("header span")).filter((s) =>
      s.textContent.includes("მოთამაშეები")
    );
    countEls.forEach((span) => {
      const val = span.querySelector("span");
      if (val) val.textContent = players.length + "/8";
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

    const nicks = [
      "ქართველი_არწივი",
      "მთის_შევარდენი",
      "სიტყვების_ოსტატი",
      "ლეგენდარი_99",
      "მტკვრის_ტალღა",
      "თბილისელი_გურუ",
      "სხარტი_გონება",
    ];

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
          toast("Clipboard unavailable");
        }
      };
    }
    if (codeInput) {
      codeInput.addEventListener("input", () => {
        codeInput.value = codeInput.value.toUpperCase();
      });
    }

    // duration / rounds pickers on home create card
    let maxRounds = 5;
    let roundSeconds = 60;
    document.querySelectorAll("#create-room-btn")[0];
    const createCard = createBtn && createBtn.closest(".lg\\:col-span-6");
    if (createCard) {
      createCard.querySelectorAll("button").forEach((btn) => {
        const t = (btn.textContent || "").trim();
        if (t === "60წმ" || t === "90წმ" || t === "120წმ") {
          btn.addEventListener("click", () => {
            roundSeconds = parseInt(t, 10);
            createCard.querySelectorAll("button").forEach((b) => {
              const x = (b.textContent || "").trim();
              if (x.endsWith("წმ")) {
                b.className = b.className.replace(/bg-primary[^ ]*|text-on-primary/g, "");
                if (x === t) b.classList.add("bg-primary", "text-on-primary");
              }
            });
          });
        }
        if (t === "3" || t === "5 რაუნდი" || t === "7") {
          btn.addEventListener("click", () => {
            maxRounds = t.startsWith("5") ? 5 : parseInt(t, 10);
          });
        }
      });
    }

    if (createBtn) {
      const createClone = createBtn.cloneNode(true);
      createBtn.parentNode.replaceChild(createClone, createBtn);
      createClone.addEventListener("click", () => {
        const name = (nick && nick.value.trim()) || "";
        if (!name) {
          toast("შეიყვანე მეტსახელი");
          return;
        }
        createClone.disabled = true;
        client.createRoom(name, {
          categories: ["country", "city", "animal", "plant", "name", "river"],
          maxRounds: maxRounds,
          roundSeconds: roundSeconds,
        });
      });
    }

    if (joinBtn) {
      const joinClone = joinBtn.cloneNode(true);
      joinBtn.parentNode.replaceChild(joinClone, joinBtn);
      joinClone.addEventListener("click", () => {
        const name = (nick && nick.value.trim()) || "";
        const code = (codeInput && codeInput.value.trim()) || "";
        if (!name) {
          toast("შეიყვანე მეტსახელი");
          return;
        }
        if (!code) {
          toast("შეიყვანე ოთახის კოდი");
          return;
        }
        joinClone.disabled = true;
        client.joinRoom(code, name);
      });
    }

    client.on("room_created", () => go(PATHS.lobby));
    client.on("room_joined", () => go(PATHS.lobby));
    client.on("error", (err) => {
      const c = document.getElementById("create-room-btn");
      const j = document.getElementById("join-room-btn");
      if (c) c.disabled = false;
      if (j) j.disabled = false;
      toast((err && err.message) || "შეცდომა");
    });
  }

  // ---------- LOBBY ----------
  function initLobby() {
    const session = client.loadSession();
    if (!session.roomCode || !session.playerId) {
      go(PATHS.home);
      return;
    }

    const codeEl = document.getElementById("roomCodeDisplay");
    const startBtn = document.getElementById("startGameBtn");
    const copyBtn = document.getElementById("copyBtn");
    const grid = document.getElementById("categoryGrid");

    // neutralize old inline handlers by replacing start button listener
    if (startBtn) {
      const clone = startBtn.cloneNode(true);
      startBtn.parentNode.replaceChild(clone, startBtn);
      clone.addEventListener("click", () => {
        if (!latestRoom || latestRoom.host_id !== latestRoom.you) {
          toast("მხოლოდ მასპინძელი იწყებს");
          return;
        }
        clone.disabled = true;
        client.startRound();
      });
    }

    if (copyBtn) {
      copyBtn.onclick = () => {
        const code = (latestRoom && latestRoom.code) || session.roomCode;
        navigator.clipboard.writeText(code).then(() => toast("კოდი დაკოპირდა")).catch(() => toast(code));
      };
    }

    window.copyRoomCode = function () {
      const code = (latestRoom && latestRoom.code) || session.roomCode;
      navigator.clipboard.writeText(code).then(() => toast("კოდი დაკოპირდა"));
    };
    window.shareInviteLink = function () {
      const code = (latestRoom && latestRoom.code) || session.roomCode;
      const url = location.origin + "/?join=" + code;
      if (navigator.share) navigator.share({ title: "ქალაქობანა", text: "შემომიერთდი: " + code, url: url });
      else navigator.clipboard.writeText(url);
    };
    window.toggleQrModal = function (show) {
      const modal = document.getElementById("qrModal");
      if (!modal) return;
      modal.classList.toggle("hidden", !show);
    };

    function renderLobby(room) {
      if (codeEl) codeEl.textContent = room.code;
      updateChrome(room);

      // players list: find left column list container
      const listHost = document.querySelector(".lg\\:col-span-7 .flex.flex-col.gap-space-xs, .lg\\:col-span-7 .flex.flex-col.gap-space-sm");
      const playersWrap =
        document.querySelector("section.lg\\:col-span-7 > .flex.flex-col.gap-space-xs") ||
        document.querySelector("section.lg\\:col-span-7 .flex.flex-col.gap-space-sm");

      // Prefer rebuilding under the "მოთამაშეთა სია" heading's next sibling
      const heading = Array.from(document.querySelectorAll("h2")).find((h) =>
        h.textContent.includes("მოთამაშეთა სია")
      );
      let hostList = heading && heading.parentElement && heading.parentElement.nextElementSibling;
      if (!hostList && heading) {
        hostList = heading.closest("div").parentElement.querySelector(".flex.flex-col.gap-space-xs, .flex.flex-col.gap-space-sm");
      }

      const players = room.players || [];
      const connected = players.filter((p) => p.connected);
      if (heading) {
        const badge = heading.parentElement.querySelector("span.rounded-full");
        if (badge) badge.textContent = connected.length + " / 8";
      }

      if (hostList) {
        hostList.innerHTML = connected
          .map((p) => {
            const isHost = p.id === room.host_id;
            const isYou = p.id === room.you;
            return `<div class="group relative rounded-xl ${isYou ? "bg-surface-container-high" : "bg-surface-container"} p-space-sm sm:p-space-md flex items-center justify-between shadow-md">
              <div class="flex items-center gap-space-sm min-w-0">
                <div class="w-12 h-12 rounded-xl ${isHost ? "bg-gradient-to-tr from-amber-600 to-primary text-on-primary" : "bg-surface-container-highest text-secondary"} flex items-center justify-center font-bold shrink-0 shadow-md">${initial(p.name)}</div>
                <div class="flex flex-col min-w-0">
                  <div class="flex items-center gap-1.5 flex-wrap">
                    <span class="font-body-lg text-body-lg text-on-surface truncate font-bold">${escapeHtml(p.name)}</span>
                    ${isHost ? '<span class="px-1.5 py-0.5 rounded bg-primary/20 text-primary font-label-sm text-label-sm">მასპინძელი</span>' : ""}
                    ${isYou ? '<span class="px-1.5 py-0.5 rounded bg-secondary/20 text-secondary font-label-sm text-label-sm">შენ</span>' : ""}
                  </div>
                  <span class="font-body-sm text-body-sm text-on-surface-variant">ქულა: ${p.total_score}</span>
                </div>
              </div>
              <div class="px-space-sm py-1 rounded-lg bg-surface-container-lowest flex items-center gap-1.5">
                <span class="relative inline-flex rounded-full h-2 w-2 bg-secondary"></span>
                <span class="font-label-sm text-label-sm text-secondary font-bold uppercase">ონლაინ</span>
              </div>
            </div>`;
          })
          .join("");
      }

      // categories
      if (grid) {
        const isHost = room.host_id === room.you;
        grid.innerHTML = Object.keys(CAT)
          .map((key) => {
            const checked = room.categories.includes(key) ? "checked" : "";
            const disabled = isHost ? "" : "disabled";
            return `<label class="category-toggle cursor-pointer bg-surface-container-low hover:bg-surface-container-high p-2.5 rounded-lg flex items-center justify-between select-none transition-all shadow-sm">
              <div class="flex items-center gap-2"><span class="text-[18px]">${CAT[key].emoji}</span>
              <span class="font-body-md text-body-md text-on-surface font-medium">${CAT[key].ka}</span></div>
              <input data-cat="${key}" type="checkbox" ${checked} ${disabled} class="w-4 h-4 accent-secondary rounded cursor-pointer"/>
            </label>`;
          })
          .join("");
        grid.querySelectorAll("input[data-cat]").forEach((input) => {
          input.addEventListener("change", () => {
            if (room.host_id !== room.you) return;
            const cats = Array.from(grid.querySelectorAll("input[data-cat]:checked")).map(
              (i) => i.getAttribute("data-cat")
            );
            if (!cats.length) {
              toast("აირჩიე მინიმუმ 1 კატეგორია");
              input.checked = true;
              return;
            }
            client.setSettings({ categories: cats });
          });
        });
        const badge = document.getElementById("categoryCountBadge");
        if (badge) badge.textContent = room.categories.length + " არჩეულია";
      }

      const start = document.getElementById("startGameBtn");
      if (start) {
        const isHost = room.host_id === room.you;
        start.style.display = isHost ? "" : "none";
        start.innerHTML = `<span class="material-symbols-outlined text-[28px]">sports_esports</span><span>თამაშის დაწყება</span><span class="font-mono text-body-md bg-surface-container-lowest/30 px-2 py-0.5 rounded-lg ml-1">${connected.length}/8</span>`;
      }
    }

    client.on("room_state", (room) => {
      latestRoom = room;
      renderLobby(room);
      ensureOnCorrectPage(room);
    });
    client.on("round_started", () => go(PATHS.arena));
    client.on("error", (err) => toast((err && err.message) || "შეცდომა"));

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

    const leftCol = document.querySelector(".lg\\:col-span-8.flex.flex-col");
    const stopBtn = document.getElementById("btn-stop-buzzer");
    const timerEl = document.getElementById("game-timer");
    const banner = document.getElementById("stop-announcement-banner");
    const simBtn = document.getElementById("btn-simulate-stop");
    if (simBtn) simBtn.style.display = "none";

    function gatherAnswers() {
      const out = {};
      document.querySelectorAll("[data-answer-cat]").forEach((input) => {
        const letter = (latestRoom && latestRoom.letter) || "";
        const rest = input.value || "";
        out[input.getAttribute("data-answer-cat")] = (letter + rest).trim();
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
          const m = String(Math.floor(left / 60)).padStart(2, "0");
          const s = String(left % 60).padStart(2, "0");
          timerEl.textContent = m + ":" + s;
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

    function renderArena(room) {
      updateChrome(room);
      // letter displays
      document.querySelectorAll(".font-display-letter").forEach((el) => {
        if (el.closest("main")) el.textContent = room.letter || "-";
      });
      // round
      const roundBits = Array.from(document.querySelectorAll(".font-headline-md")).filter((el) =>
        /\/\s*\d/.test(el.textContent) || el.textContent.includes("/")
      );
      roundBits.forEach((el) => {
        el.innerHTML = `${room.round_number} <span class="text-surface-variant font-normal">/</span> ${room.max_rounds}`;
      });

      if (leftCol && room.state === "playing") {
        const header = leftCol.querySelector(".flex.items-center.justify-between");
        const cards = Array.from(leftCol.children).filter((c) => c !== header);
        // keep header, replace rest
        cards.forEach((c) => c.remove());
        room.categories.forEach((key) => {
          const meta = CAT[key] || { ka: key, emoji: "✨" };
          const existing = ((room.answers[room.you] || {})[key] || "");
          let rest = existing;
          if (room.letter && existing.startsWith(room.letter)) rest = existing.slice(room.letter.length);
          const card = document.createElement("div");
          card.className =
            "bg-surface-container p-space-sm md:p-space-md rounded-xl shadow-md hover:bg-surface-container-high transition-colors flex flex-col gap-1.5";
          card.innerHTML = `<div class="flex items-center justify-between">
              <label class="font-label-md text-label-md text-on-surface flex items-center gap-2">
                <span class="text-[18px]">${meta.emoji}</span><span>${meta.ka}</span>
              </label>
            </div>
            <div class="relative flex items-center bg-surface-container-lowest rounded-lg p-1 shadow-inner focus-within:ring-2 focus-within:ring-secondary/50">
              <div class="pl-3 pr-1 text-primary font-headline-sm text-headline-sm font-extrabold select-none">${escapeHtml(room.letter || "")}</div>
              <input data-answer-cat="${key}" class="w-full bg-transparent text-on-surface font-body-lg text-body-lg font-bold outline-none py-1.5 px-1 placeholder:text-outline-variant" type="text" placeholder="ჩაწერე..." value="${escapeAttr(rest)}"/>
            </div>`;
          leftCol.appendChild(card);
        });
        leftCol.querySelectorAll("[data-answer-cat]").forEach((input) => {
          input.addEventListener("input", scheduleSave);
        });
      }

      // progress strip
      const progressHost = document.querySelector(".grid.grid-cols-2.sm\\:grid-cols-5");
      if (progressHost) {
        const cats = room.categories.length || 1;
        progressHost.innerHTML = (room.players || [])
          .filter((p) => p.connected)
          .map((p) => {
            const ans = room.answers[p.id] || (p.id === room.you ? room.answers[room.you] : {}) || {};
            // during play only own answers known - show ? for others
            let filled = 0;
            if (p.id === room.you) {
              filled = room.categories.filter((c) => (ans[c] || "").trim()).length;
            }
            const pct = p.id === room.you ? Math.round((filled / cats) * 100) : 0;
            const label = p.id === room.you ? "შენ" : escapeHtml(p.name);
            return `<div class="bg-surface-container-low p-2 rounded-lg flex flex-col gap-1">
              <div class="flex items-center justify-between">
                <span class="font-label-sm text-label-sm ${p.id === room.you ? "text-secondary font-bold" : "text-on-surface-variant"} truncate">${label}</span>
                <span class="font-label-sm text-label-sm font-mono">${p.id === room.you ? filled + "/" + cats : "…"}</span>
              </div>
              <div class="w-full bg-surface-container-lowest h-1.5 rounded-full overflow-hidden">
                <div class="bg-secondary h-full rounded-full" style="width:${pct}%"></div>
              </div>
            </div>`;
          })
          .join("");
      }

      // live scores from totals
      const scoreCard = Array.from(document.querySelectorAll(".lg\\:col-span-4 .flex.flex-col.gap-1\\.5")).pop();
      const scoreLists = document.querySelectorAll(".lg\\:col-span-4 .flex.flex-col.gap-1\\.5");
      scoreLists.forEach((list) => {
        if (!list.closest(".sticky")) return;
        const ranked = [...(room.players || [])].sort((a, b) => b.total_score - a.total_score);
        list.innerHTML = ranked
          .map((p, i) => {
            const you = p.id === room.you;
            return `<div class="flex items-center justify-between p-2 rounded-lg ${you ? "bg-surface-container text-on-surface" : "bg-surface-container-lowest/60 text-on-surface-variant"} font-body-sm text-body-sm">
              <div class="flex items-center gap-2">
                <span class="w-5 h-5 rounded-full ${you ? "bg-primary text-on-primary" : "bg-surface-container-high"} font-bold flex items-center justify-center font-mono text-[11px]">${i + 1}</span>
                <span class="${you ? "font-bold text-primary" : ""}">${you ? "შენ (" + escapeHtml(p.name) + ")" : escapeHtml(p.name)}</span>
              </div>
              <span class="font-mono font-extrabold ${you ? "text-primary" : ""}">${p.total_score} ქ</span>
            </div>`;
          })
          .join("");
      });
    }

    if (stopBtn) {
      const clone = stopBtn.cloneNode(true);
      stopBtn.parentNode.replaceChild(clone, stopBtn);
      clone.addEventListener("click", () => {
        if (stoppedLocally) return;
        stoppedLocally = true;
        client.updateAnswers(gatherAnswers());
        setTimeout(() => client.stopRound(), 50);
      });
    }

    window.addEventListener("keydown", (e) => {
      if (e.code === "Space" && e.target.tagName !== "INPUT" && !stoppedLocally) {
        e.preventDefault();
        stoppedLocally = true;
        client.updateAnswers(gatherAnswers());
        setTimeout(() => client.stopRound(), 50);
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
      const name =
        (latestRoom &&
          latestRoom.players &&
          latestRoom.players.find((p) => p.id === who) &&
          latestRoom.players.find((p) => p.id === who).name) ||
        "მოთამაშე";
      if (banner) {
        banner.classList.remove("hidden");
        const h4 = banner.querySelector("h4");
        if (h4) h4.textContent = (who === (latestRoom && latestRoom.you) ? "შენ" : name) + " დააჭირა STOP-ს!";
      }
      document.querySelectorAll("[data-answer-cat]").forEach((i) => {
        i.disabled = true;
      });
      setTimeout(() => go(PATHS.results), 900);
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
    if (nextBtn) {
      const clone = nextBtn.cloneNode(true);
      nextBtn.parentNode.replaceChild(clone, nextBtn);
      clone.addEventListener("click", () => {
        if (!latestRoom || latestRoom.host_id !== latestRoom.you) {
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

    function renderResults(room) {
      updateChrome(room);
      const letterEls = document.querySelectorAll(".font-display-letter");
      letterEls.forEach((el) => {
        if (el.closest("main")) el.textContent = room.letter || "-";
      });

      const title = Array.from(document.querySelectorAll("h1")).find((h) =>
        h.textContent.includes("შედეგები") || h.textContent.includes("რაუნდი")
      );
      if (title) {
        title.textContent =
          room.state === "verifying"
            ? `რაუნდი ${room.round_number} - შემოწმება...`
            : `რაუნდი ${room.round_number}-ის შედეგები`;
      }

      const next = document.getElementById("nextRoundBtn");
      if (next) {
        const isHost = room.host_id === room.you;
        next.style.visibility = isHost && room.state === "results" ? "visible" : "hidden";
        if (room.match_over) {
          next.innerHTML = `<span class="material-symbols-outlined text-[20px]">emoji_events</span><span>ფინალური პოდიუმი</span>`;
        } else {
          next.innerHTML = `<span class="material-symbols-outlined text-[20px]">fast_forward</span><span>შემდეგი რაუნდი (${room.round_number + 1}/${room.max_rounds})</span>`;
        }
      }

      const players = (room.players || []).filter((p) => p.connected || room.answers[p.id]);
      const table = document.querySelector("table");
      if (table && room.state === "results") {
        const thead = table.querySelector("thead tr");
        const tbody = table.querySelector("tbody");
        if (thead && tbody) {
          thead.innerHTML =
            `<th class="py-3.5 px-4 w-[22%]">კატეგორია</th>` +
            players
              .map((p) => {
                const you = p.id === room.you;
                return `<th class="py-3.5 px-3 ${you ? "bg-surface-container-high/60" : ""}">
                  <div class="flex items-center gap-1.5">
                    <div class="w-5 h-5 rounded-full bg-surface-container flex items-center justify-center text-[10px]">${initial(p.name)}</div>
                    <span class="${you ? "text-secondary font-bold" : ""}">${you ? "შენ" : escapeHtml(p.name)}</span>
                  </div></th>`;
              })
              .join("");

          tbody.innerHTML = room.categories
            .map((cat) => {
              const meta = CAT[cat] || { ka: cat, emoji: "✨" };
              const cells = players
                .map((p) => {
                  const v = ((room.verdicts[p.id] || {})[cat]) || {};
                  const pts = ((room.round_points[p.id] || {})[cat]) || 0;
                  const ans = v.answer || ((room.answers[p.id] || {})[cat]) || "-";
                  const invalid = v.valid === false;
                  return `<td class="py-3 px-3 ${p.id === room.you ? "bg-surface-container-high/40" : ""}">
                    <div class="flex flex-col gap-1">
                      <span class="${invalid ? "line-through text-error" : "text-on-surface"} font-semibold">${escapeHtml(ans || "-")}</span>
                      ${pointsBadge(pts)}
                    </div></td>`;
                })
                .join("");
              return `<tr class="bg-surface-container-low hover:bg-surface-container transition-colors">
                <td class="py-3 px-4"><div class="flex items-center gap-2"><span class="text-lg">${meta.emoji}</span><span class="font-bold">${meta.ka}</span></div></td>
                ${cells}
              </tr>`;
            })
            .join("");
        }
      }

      // sidebar round scores
      const side = document.querySelector(".xl\\:col-span-3 .flex.flex-col.gap-2\\.5");
      if (side && room.state === "results") {
        const ranked = [...players].sort(
          (a, b) => (room.round_totals[b.id] || 0) - (room.round_totals[a.id] || 0)
        );
        side.innerHTML = ranked
          .map((p, i) => {
            const you = p.id === room.you;
            return `<div class="flex items-center justify-between p-2.5 rounded-lg ${you ? "bg-surface-container-highest" : "bg-surface-container"}">
              <div class="flex items-center gap-2.5 min-w-0">
                <span class="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold text-xs">${i + 1}</span>
                <span class="font-bold ${you ? "text-secondary" : "text-on-surface"} truncate">${you ? "შენ (" + escapeHtml(p.name) + ")" : escapeHtml(p.name)}</span>
              </div>
              <div class="flex flex-col items-end">
                <span class="font-headline-sm text-headline-sm text-primary leading-none">+${room.round_totals[p.id] || 0}</span>
                <span class="text-[10px] text-on-surface-variant">ჯამი: ${p.total_score} ქ</span>
              </div>
            </div>`;
          })
          .join("");
      }
    }

    client.on("room_state", (room) => {
      latestRoom = room;
      renderResults(room);
      if (room.match_over && room.state === "results") {
        // allow viewing results briefly; auto podium optional
      } else {
        ensureOnCorrectPage(room);
      }
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
    if (replay) {
      const clone = replay.cloneNode(true);
      replay.parentNode.replaceChild(clone, replay);
      clone.addEventListener("click", () => {
        if (!latestRoom || latestRoom.host_id !== latestRoom.you) {
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
      const standings = document.querySelector(".lg\\:col-span-7 .flex.flex-col.gap-space-xs");
      if (standings) {
        standings.innerHTML = ranked
          .map((p, i) => {
            const you = p.id === room.you;
            return `<div class="flex items-center justify-between p-space-sm rounded-lg ${you ? "bg-secondary-container/10" : "bg-surface-container"}">
              <div class="flex items-center gap-space-sm min-w-0">
                <span class="font-label-md text-label-md ${i === 0 ? "text-primary" : "text-on-surface-variant"} font-bold w-5 text-center">${i + 1}</span>
                <div class="w-8 h-8 rounded-full bg-surface-variant flex items-center justify-center font-bold text-label-sm">${initial(p.name)}</div>
                <span class="font-body-md text-body-md ${you ? "text-secondary" : "text-on-surface"} font-bold truncate">${you ? "შენ (" + escapeHtml(p.name) + ")" : escapeHtml(p.name)}</span>
              </div>
              <span class="bg-surface-container-highest px-2.5 py-1 rounded-md font-label-md text-label-md font-bold">${p.total_score} ქ</span>
            </div>`;
          })
          .join("");
      }

      // update top-3 name/score texts if present
      const podiumNames = [
        document.querySelector(".order-1.md\\:order-2 .font-headline-md"),
        document.querySelector(".order-2.md\\:order-1 .font-headline-sm"),
        document.querySelector(".order-3 .font-headline-sm"),
      ];
      const podiumScores = document.querySelectorAll(
        ".order-1.md\\:order-2 .font-display-letter, .order-2.md\\:order-1 .font-display-letter, .order-3 .font-display-letter"
      );
      // gold center = ranked[0], silver left = ranked[1], bronze = ranked[2]
      if (ranked[0] && podiumNames[0]) podiumNames[0].textContent = ranked[0].name;
      if (ranked[1] && podiumNames[1]) {
        podiumNames[1].textContent =
          ranked[1].id === room.you ? "შენ (" + ranked[1].name + ")" : ranked[1].name;
      }
      if (ranked[2] && podiumNames[2]) podiumNames[2].textContent = ranked[2].name;
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

  // nav links
  document.querySelectorAll("a[data-path]").forEach((a) => {
    a.addEventListener("click", (e) => {
      const path = a.getAttribute("data-path");
      if (path === "lobbies" || path === "arena" || path === "leaderboard") {
        e.preventDefault();
        if (path === "lobbies") go(latestRoom ? PATHS.lobby : PATHS.home);
        if (path === "arena" && latestRoom) go(routeForState(latestRoom));
        if (path === "leaderboard" && latestRoom) go(PATHS.podium);
      }
    });
  });

  client.on("error", (err) => toast((err && err.message) || "შეცდომა"));

  if (page === "home") initHome();
  if (page === "lobby") initLobby();
  if (page === "arena") initArena();
  if (page === "results") initResults();
  if (page === "podium") initPodium();

  // deep link ?join=CODE
  if (page === "home") {
    const params = new URLSearchParams(location.search);
    const join = params.get("join");
    if (join) {
      const codeInput = document.getElementById("room-code-input");
      if (codeInput) codeInput.value = join.toUpperCase();
    }
  }
})();
