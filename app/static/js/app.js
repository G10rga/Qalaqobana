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
  
  // Georgian Mkhedruli alphabet (same as server GEORGIAN_LETTERS)
  const GEO_LETTERS = "აბგდევზთიკლმნოპჟრსტუფქღყშჩცძწჭხჯჰ".split("");
  const PATHS = {
    home: "/",
    lobby: "/lobby",
    spin: "/spin",
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
    if (p.includes("spin")) return "spin";
    if (p.includes("arena")) return "arena";
    if (p.includes("results")) return "results";
    if (p.includes("podium")) return "podium";
    return "home";
  }

  function go(path) {
    if (location.pathname !== path) location.href = path;
  }

  function spinKey(room) {
    return (room && room.code) + ":" + (room && room.round_number);
  }

  function needsLetterSpin(room) {
    if (!room || room.state !== "playing" || !room.letter) return false;
    return sessionStorage.getItem("qalaqobana_need_spin") === spinKey(room);
  }

  function beginLetterSpin(payload) {
    const code =
      (latestRoom && latestRoom.code) ||
      (client.roomCode) ||
      (client.loadSession() && client.loadSession().roomCode);
    const round =
      (payload && payload.round_number) ||
      (latestRoom && latestRoom.round_number) ||
      1;
    if (!code) {
      go(PATHS.spin);
      return;
    }
    sessionStorage.setItem("qalaqobana_need_spin", code + ":" + round);
    go(PATHS.spin);
  }

  function finishLetterSpin(room) {
    sessionStorage.removeItem("qalaqobana_need_spin");
    if (room) sessionStorage.setItem("qalaqobana_spin_done", spinKey(room));
    go(PATHS.arena);
  }

  // When leaving, clear spin flags
  const _leaveBtn = document.getElementById("leave-btn");
  if (_leaveBtn && !_leaveBtn._spinHooked) {
    _leaveBtn._spinHooked = true;
    _leaveBtn.addEventListener("click", () => {
      sessionStorage.removeItem("qalaqobana_need_spin");
      sessionStorage.removeItem("qalaqobana_spin_done");
    });
  }

  function routeForState(room) {
    if (!room) return PATHS.home;
    if (room.match_over) return PATHS.podium;
    switch (room.state) {
      case "lobby":
        return PATHS.lobby;
      case "playing":
        if (needsLetterSpin(room)) return PATHS.spin;
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
      // keep md:flex visible on desktop after unhiding
      if (!codeEl.classList.contains("md:flex")) codeEl.classList.add("md:flex");
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
    let soloPending = false;

    const IDLE = "p-2 rounded-md bg-surface-container shadow-sm font-headline-md text-headline-md text-primary transition-all";
    const ACTIVE_R = "p-2 rounded-md bg-primary-container text-on-primary-container shadow-sm font-headline-md text-headline-md transition-all";

    function paint(root, attr, value, active) {
      if (!root) return;
      root.querySelectorAll("button[" + attr + "]").forEach((btn) => {
        const on = String(btn.getAttribute(attr)) === String(value);
        btn.className = on ? active : IDLE;
      });
    }

    const roundsPicker = document.getElementById("home-rounds-picker");
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
        if (badge) badge.textContent = cats.length + " / " + Object.keys(CAT).length + " აქტიური";
        if (latestRoom) latestRoom.categories = cats.slice();
        client.setSettings({ categories: cats });
      });
    }

    function renderLobby(room) {
      updateChrome(room);
      if (codeEl) codeEl.textContent = room.code;
      if (settingsEl) {
        settingsEl.textContent = room.max_rounds + " რაუნდი · STOP = ვინც პირველი დაასრულებს";
      }
      const players = room.players || [];
      if (countBadge) countBadge.textContent = players.length + " / 8";
      if (listEl) {
        listEl.innerHTML = players
          .map((p, idx) => {
            const host = p.id === room.host_id;
            const you = p.id === room.you;
            const label = you ? "შენ (" + escapeHtml(p.name) + ")" : escapeHtml(p.name);
            return `<div class="flex items-center justify-between p-2.5 rounded-lg ${you ? "bg-surface-container shadow-sm" : "bg-surface shadow-sm"} hover:translate-x-1 transition-transform">
              <div class="flex items-center gap-3 min-w-0">
                <span class="w-6 font-label-md text-label-md text-outline">${idx + 1}.</span>
                <div class="w-8 h-8 rounded-full ${host ? "bg-primary text-on-primary" : "bg-secondary-fixed text-on-secondary-fixed"} flex items-center justify-center font-bold shrink-0">${escapeHtml(initial(p.name))}</div>
                <div class="flex flex-col min-w-0">
                  <div class="flex items-center gap-1.5 flex-wrap">
                    <span class="font-body-xl text-body-xl text-primary font-bold leading-none truncate">${label}</span>
                    ${host ? '<span class="font-label-sm text-label-sm bg-primary-fixed text-on-primary-fixed px-1.5 rounded font-bold uppercase">HOST</span>' : ""}
                  </div>
                  <span class="font-label-sm text-label-sm text-outline">${p.total_score} ქულა · ${p.connected ? "ონლაინ" : "გათიშულია"}</span>
                </div>
              </div>
              <div class="flex items-center gap-1 ${p.connected ? "bg-tertiary-fixed text-on-tertiary-fixed" : "bg-surface-container-highest text-on-surface-variant"} px-2.5 py-1 rounded-full shadow-sm shrink-0">
                <span class="material-symbols-outlined text-[16px]">${p.connected ? "check_circle" : "hourglass_top"}</span>
                <span class="font-body-md text-body-md font-bold leading-none">${p.connected ? "მზადაა!" : "…"}</span>
              </div>
            </div>`;
          })
          .join("");
      }

      if (gridRoot) {
        const host = isHostOf(room);
        const icons = { country: "public", city: "location_city", animal: "pets", plant: "forest", name: "badge", river: "water", film: "movie", food: "restaurant" };
        gridRoot.innerHTML = Object.keys(CAT)
          .map((key) => {
            const on = (room.categories || []).indexOf(key) >= 0;
            const checked = on ? "checked" : "";
            const req = REQUIRED_CATS.indexOf(key) >= 0;
            return `<label class="group flex items-center justify-between p-2.5 rounded-lg bg-surface shadow-sm cursor-pointer hover:bg-surface-container transition-all ${on ? "" : "opacity-70"} ${host ? "" : "pointer-events-none"}">
              <span class="font-body-xl text-body-xl ${on ? "text-primary" : "text-on-surface-variant"} font-medium flex items-center gap-2">
                <span class="material-symbols-outlined text-[20px]">${icons[key] || "category"}</span>
                ${CAT[key].ka}${req ? " *" : ""}
              </span>
              <input data-cat="${key}" type="checkbox" ${checked} class="sr-only"/>
              <div class="w-6 h-6 rounded ${on ? "bg-surface-container-high text-primary" : "bg-surface-container text-transparent"} flex items-center justify-center">
                <span class="material-symbols-outlined text-[18px] font-black">check</span>
              </div>
            </label>`;
          })
          .join("");
        const badge = document.getElementById("categoryCountBadge");
        if (badge) badge.textContent = (room.categories || []).length + " / " + Object.keys(CAT).length + " აქტიური";
      }

      if (startBtn) {
        startBtn.style.display = isHostOf(room) ? "" : "none";
        startBtn.disabled = false;
        const label = document.getElementById("startGameBtnLabel");
        const txt = "თამაშის დაწყება (" + players.length + "/8)";
        if (label) label.textContent = txt;
        else startBtn.textContent = txt;
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
    client.on("round_started", (payload) => beginLetterSpin(payload || latestRoom));
    client.on("error", (err) => {
      if (startBtn) startBtn.disabled = false;
      toast((err && err.message) || "შეცდომა");
    });
    client.socket.on("connect", () => client.sync());
    if (client.socket.connected) client.sync();
  }

  // ---------- LETTER SPIN (CS:GO-style) ----------
  function initSpin() {
    const session = client.loadSession();
    if (!session.roomCode || !session.playerId) {
      go(PATHS.home);
      return;
    }

    const track = document.getElementById("rouletteTrack");
    const glow = document.getElementById("centralGlow");
    const statusEl = document.getElementById("spin-status");
    const teaserEl = document.getElementById("spin-teaser");
    const iconEl = document.getElementById("spin-icon");
    const roundBadge = document.getElementById("spin-round-badge");
    const revealBadge = document.getElementById("revealBadge");
    const revealLetter = document.getElementById("revealLetter");
    const revealTitle = document.getElementById("revealTitle");
    const revealSub = document.getElementById("revealSub");
    const countdownSeconds = document.getElementById("countdownSeconds");
    const countdownBar = document.getElementById("countdownProgressBar");
    const catsEl = document.getElementById("spin-categories");

    const TIERS = [
      { tag: "#MIL-SPEC", border: "border-blue-500/35", bar: "bg-blue-500", text: "text-blue-400", dot: "bg-blue-500" },
      { tag: "#RESTRICTED", border: "border-purple-500/35", bar: "bg-purple-500", text: "text-purple-400", dot: "bg-purple-500" },
      { tag: "#CLASSIFIED", border: "border-pink-500/35", bar: "bg-pink-500", text: "text-pink-400", dot: "bg-pink-500" },
      { tag: "#COVERT", border: "border-red-500/35", bar: "bg-red-500", text: "text-red-400", dot: "bg-red-500" },
      { tag: "#MIL-SPEC", border: "border-secondary/35", bar: "bg-secondary", text: "text-secondary", dot: "bg-secondary" },
    ];

    const CARD_W = 140;
    const WIN_W = 154;
    const GAP = 12;
    const SPIN_MS = 4200;
    const COUNTDOWN_MS = 3000;
    let spun = false;

    function randomLetter(exclude) {
      let L;
      do {
        L = GEO_LETTERS[Math.floor(Math.random() * GEO_LETTERS.length)];
      } while (exclude && L === exclude && GEO_LETTERS.length > 1);
      return L;
    }

    function normalCard(letter, tier) {
      return `<div class="w-[140px] h-[190px] bg-gradient-to-b from-[#162238] to-[#0f1c2c] border ${tier.border} rounded-xl flex flex-col justify-between p-3 shrink-0 shadow-lg relative overflow-hidden" data-letter="${escapeAttr(letter)}">
        <div class="flex items-center justify-between">
          <span class="font-mono text-[11px] ${tier.text} font-bold">${tier.tag}</span>
          <span class="w-2 h-2 rounded-full ${tier.dot}"></span>
        </div>
        <div class="flex items-center justify-center my-auto">
          <span class="text-[58px] font-black text-on-surface leading-none select-none">${escapeHtml(letter)}</span>
        </div>
        <div class="w-full h-2 rounded-full ${tier.bar}"></div>
      </div>`;
    }

    function winnerCard(letter) {
      return `<div id="winningCard" class="w-[154px] h-[208px] bg-gradient-to-b from-[#24354f] via-[#1a293d] to-[#0b1726] border-2 border-primary-container rounded-2xl flex flex-col justify-between p-3.5 shrink-0 relative z-20 scale-105 shadow-[0_0_35px_rgba(245,166,35,0.55)]" data-letter="${escapeAttr(letter)}" data-winner="1">
        <div class="absolute -top-1.5 -right-1.5 w-6 h-6 bg-gradient-to-tr from-primary-container to-primary rounded-full flex items-center justify-center text-on-primary-container shadow-md">
          <span class="material-symbols-outlined text-[15px]" style="font-variation-settings:'FILL' 1">star</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="font-mono text-[11px] text-primary font-extrabold tracking-wider">★ RARE</span>
          <span class="px-1.5 py-0.5 rounded bg-primary-container text-on-primary-container font-bold text-[9px] tracking-widest">არჩეულია</span>
        </div>
        <div class="flex flex-col items-center justify-center my-auto">
          <span class="text-[74px] leading-none text-primary font-black drop-shadow-[0_4px_18px_rgba(245,166,35,0.85)]">${escapeHtml(letter)}</span>
        </div>
        <div class="w-full flex flex-col gap-1">
          <div class="w-full h-2.5 rounded-full bg-gradient-to-r from-primary via-secondary to-primary-container"></div>
          <span class="text-[10px] text-center font-bold text-secondary tracking-widest uppercase">MATCH SELECTED</span>
        </div>
      </div>`;
    }

    function buildTrack(winner) {
      const LEFT = 18;
      const RIGHT = 18;
      const parts = [];
      for (let i = 0; i < LEFT; i++) {
        parts.push(normalCard(randomLetter(winner), TIERS[i % TIERS.length]));
      }
      parts.push(winnerCard(winner));
      for (let i = 0; i < RIGHT; i++) {
        parts.push(normalCard(randomLetter(winner), TIERS[(i + 2) % TIERS.length]));
      }
      track.innerHTML = parts.join("");
      return LEFT; // winner index
    }

    function winnerOffsetPx(winnerIndex) {
      // distance from track left edge to center of winner card
      let x = 16; // px-4 padding
      for (let i = 0; i < winnerIndex; i++) x += CARD_W + GAP;
      x += WIN_W / 2;
      return x;
    }

    function runSpin(room) {
      if (spun || !track || !room.letter) return;
      spun = true;
      const winner = room.letter;
      const winnerIndex = buildTrack(winner);

      if (roundBadge) {
        roundBadge.textContent = "რაუნდი " + room.round_number + " / " + room.max_rounds;
      }
      if (catsEl) {
        catsEl.innerHTML = (room.categories || [])
          .map((key) => {
            const meta = CAT[key] || { ka: key, emoji: "✨" };
            return `<div class="flex flex-col items-center justify-center p-3 rounded-lg bg-surface-container border border-surface-variant/40">
              <span class="text-xl mb-1">${meta.emoji}</span>
              <span class="text-xs font-bold">${meta.ka}</span>
            </div>`;
          })
          .join("");
      }

      if (statusEl) statusEl.textContent = "SPINNING…";
      if (teaserEl) teaserEl.textContent = "რულეტკა ტრიალებს";
      if (revealBadge) revealBadge.style.opacity = "0.35";
      if (revealLetter) revealLetter.textContent = "?";
      if (revealTitle) revealTitle.textContent = "ასო ირჩევა…";
      if (revealSub) revealSub.textContent = "დაელოდე რულეტკას";
      if (countdownSeconds) countdownSeconds.textContent = "იტვირთება…";
      if (countdownBar) {
        countdownBar.style.transition = "none";
        countdownBar.style.width = "100%";
      }
      if (glow) {
        glow.classList.remove("opacity-70");
        glow.classList.add("opacity-40");
      }

      // Layout: position track so animation ends with winner under center needle
      requestAnimationFrame(() => {
        const viewport = track.parentElement;
        const viewW = viewport.clientWidth;
        const endX = viewW / 2 - winnerOffsetPx(winnerIndex);
        const startX = endX + viewW * 1.35 + Math.random() * 120;

        track.style.transition = "none";
        track.style.transform = "translateX(" + startX + "px) translateY(-50%)";
        void track.offsetWidth;
        track.style.transition = "transform " + SPIN_MS + "ms cubic-bezier(0.1, 0.9, 0.18, 1)";
        track.style.transform = "translateX(" + endX + "px) translateY(-50%)";

        setTimeout(() => {
          const winEl = document.getElementById("winningCard");
          if (winEl) winEl.classList.add("winner-card-pulse");
          if (glow) {
            glow.classList.remove("opacity-40");
            glow.classList.add("opacity-70");
          }
          if (iconEl) iconEl.classList.remove("animate-spin");
          if (statusEl) statusEl.textContent = "LETTER LOCKED";
          if (teaserEl) teaserEl.textContent = "ასო არჩეულია";
          if (revealBadge) revealBadge.style.opacity = "1";
          if (revealLetter) revealLetter.textContent = winner;
          if (revealTitle) revealTitle.textContent = "არჩეული ასოა: " + winner;
          if (revealSub) revealSub.textContent = "ყველა სიტყვა იწყება „" + winner + "“-ზე";

          let left = Math.ceil(COUNTDOWN_MS / 1000);
          if (countdownBar) {
            countdownBar.style.transition = "width " + COUNTDOWN_MS + "ms linear";
            countdownBar.style.width = "0%";
          }
          if (countdownSeconds) countdownSeconds.textContent = left + "…";
          const tick = setInterval(() => {
            left -= 1;
            if (left > 0) {
              if (countdownSeconds) countdownSeconds.textContent = left + "…";
            } else {
              clearInterval(tick);
              if (countdownSeconds) countdownSeconds.textContent = "რაუნდი იწყება!";
              finishLetterSpin(room);
            }
          }, 1000);
        }, SPIN_MS + 40);
      });
    }

    client.on("room_state", (room) => {
      latestRoom = room;
      updateChrome(room);
      if (room.state !== "playing") {
        ensureOnCorrectPage(room);
        return;
      }
      if (!room.letter) return;
      // Mark that we're handling the spin for this round
      if (sessionStorage.getItem("qalaqobana_need_spin") !== spinKey(room)) {
        sessionStorage.setItem("qalaqobana_need_spin", spinKey(room));
      }
      runSpin(room);
    });
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

    const forms = document.getElementById("answerForms");
    const stopBtn = document.getElementById("btn-stop-buzzer");
    const banner = document.getElementById("stop-announcement-banner");
    const graceEl = document.getElementById("grace-countdown");
    const letterEl = document.getElementById("arena-letter");
    const roundEl = document.getElementById("arena-round");
    const scoresEl = document.getElementById("arena-scores");
    let formsBuiltFor = null;
    let graceTimer = null;

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

    function showGraceBanner(name, seconds, isYou) {
      if (banner) {
        banner.classList.remove("hidden");
        const h4 = banner.querySelector("h4");
        if (h4) {
          h4.textContent = isYou
            ? "შენ დააჭირე STOP-ს!"
            : (name || "მოთამაშე") + " დაასრულა! ყველას აქვს ცოტა დრო…";
        }
      }
      clearInterval(graceTimer);
      let left = Math.max(1, Math.ceil(seconds));
      const tick = () => {
        if (graceEl) graceEl.textContent = "დარჩენილი დრო: " + left + " წმ";
        if (left <= 0) {
          clearInterval(graceTimer);
          if (graceEl) graceEl.textContent = "რაუნდი იკეტება…";
          return;
        }
        left -= 1;
      };
      tick();
      graceTimer = setInterval(tick, 1000);
      if (stopBtn) {
        stopBtn.disabled = true;
        stopBtn.classList.add("opacity-50", "pointer-events-none");
      }
    }

    function doStop() {
      if (stoppedLocally) return;
      if (latestRoom && latestRoom.stopped_by) return;
      stoppedLocally = true;
      client.updateAnswers(gatherAnswers());
      setTimeout(() => client.stopRound(), 50);
    }

    function renderArena(room) {
      updateChrome(room);
      if (letterEl) letterEl.textContent = room.letter || "—";
      if (roundEl) roundEl.textContent = "რაუნდი " + room.round_number + " / " + room.max_rounds;

      if (room.stopped_by && room.state === "playing") {
        stoppedLocally = true;
        const stopper = (room.players || []).find((p) => p.id === room.stopped_by);
        const name = stopper ? stopper.name : "მოთამაშე";
        let secs = 8;
        if (room.grace_ends_at) {
          secs = Math.max(1, Math.ceil(room.grace_ends_at - Date.now() / 1000));
        }
        if (banner && banner.classList.contains("hidden")) {
          showGraceBanner(name, secs, room.stopped_by === room.you);
        }
      }

      const key = room.code + ":" + room.round_number + ":" + (room.categories || []).join(",");
      if (forms && room.state === "playing" && formsBuiltFor !== key) {
        formsBuiltFor = key;
        forms.innerHTML = room.categories
          .map((cat, i) => {
            const meta = CAT[cat] || { ka: cat, emoji: "✨" };
            let existing = ((room.answers[room.you] || {})[cat] || "");
            if (room.letter && existing.startsWith(room.letter)) existing = existing.slice(room.letter.length);
            const filled = existing.trim().length > 0;
            return `<div class="relative p-2 flex flex-col justify-end min-h-[88px] bg-surface/50 rounded">
              <div class="w-full flex items-center justify-between text-outline-variant mb-1">
                <span class="font-label-sm text-label-sm">#${i + 1} ${meta.ka}</span>
                <span class="material-symbols-outlined text-[16px] ${filled ? "text-tertiary" : "text-outline-variant"}">${filled ? "check_circle" : "edit"}</span>
              </div>
              <div class="flex items-baseline gap-1">
                <span class="font-body-xl text-body-xl text-secondary font-bold select-none">${escapeHtml(room.letter || "")}</span>
                <input data-answer-cat="${cat}" value="${escapeAttr(existing)}" autocomplete="off" spellcheck="false"
                  class="word-cell w-full bg-transparent font-body-xl text-body-xl text-primary font-bold focus:outline-none placeholder-outline/50 py-1"
                  placeholder="…"/>
              </div>
              <div class="w-full h-[2px] bg-primary-container"></div>
            </div>`;
          })
          .join("");
        forms.querySelectorAll("[data-answer-cat]").forEach((input) => {
          input.addEventListener("input", scheduleSave);
        });
      }

      if (scoresEl) {
        const ranked = [...(room.players || [])].sort((a, b) => b.total_score - a.total_score);
        const catCount = (room.categories || []).length || 1;
        scoresEl.innerHTML = ranked
          .map((p) => {
            const you = p.id === room.you;
            const ans = room.answers[p.id] || {};
            const filled = Object.keys(ans).filter((c) => (ans[c] || "").trim()).length;
            return `<span class="inline-flex items-center gap-1 ${you ? "text-secondary font-bold" : ""}">
              <strong class="text-primary font-bold">${you ? "შენ" : escapeHtml(p.name)}</strong>
              <span class="font-label-sm text-label-sm bg-surface-container-highest px-1 py-0.5 rounded text-primary font-bold">[${filled}/${catCount}]</span>
            </span>`;
          })
          .join('<span class="opacity-40">•</span>');
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
      latestRoom = room;
      if (room.state === "playing") {
        renderArena(room);
      }
      ensureOnCorrectPage(room);
    });
    client.on("stop_called", (payload) => {
      stoppedLocally = true;
      const name = (payload && payload.stopped_by_name) || "მოთამაშე";
      const secs = (payload && payload.grace_seconds) || 8;
      const isYou = payload && latestRoom && payload.stopped_by === latestRoom.you;
      showGraceBanner(name, secs, isYou);
      client.updateAnswers(gatherAnswers());
      if (payload && payload.room) {
        latestRoom = Object.assign({}, latestRoom || {}, payload.room, {
          stopped_by: payload.stopped_by,
          grace_ends_at: payload.grace_ends_at,
        });
      }
    });
    client.on("round_stopped", (payload) => {
      clearInterval(graceTimer);
      const who = payload && payload.stopped_by;
      const player = (latestRoom && latestRoom.players || []).find((p) => p.id === who);
      const name = player ? player.name : ((payload && payload.stopped_by_name) || "მოთამაშე");
      if (banner) {
        banner.classList.remove("hidden");
        const h4 = banner.querySelector("h4");
        if (h4) h4.textContent = (who === (latestRoom && latestRoom.you) ? "შენ" : name) + " დაასრულა — რაუნდი დაიხურა!";
      }
      if (graceEl) graceEl.textContent = "";
      document.querySelectorAll("[data-answer-cat]").forEach((i) => {
        i.disabled = true;
      });
      client.updateAnswers(gatherAnswers());
      setTimeout(() => go(PATHS.results), 800);
    });
    client.on("error", (err) => {
      if (err && err.code === "already_stopped") {
        stoppedLocally = true;
        return;
      }
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
      if (pts >= 15)
        return '<span class="inline-flex items-center gap-1 font-label-md text-label-md text-on-secondary bg-secondary px-space-xs py-0.5 rounded-full font-bold"><span class="material-symbols-outlined text-[14px]">star</span>+15</span>';
      if (pts >= 10)
        return '<span class="inline-flex items-center gap-1 font-label-md text-label-md text-on-tertiary-container bg-tertiary-fixed/30 px-space-xs py-0.5 rounded-full font-bold"><span class="material-symbols-outlined text-[14px]">check_circle</span>+10</span>';
      if (pts >= 5)
        return '<span class="inline-flex items-center gap-1 font-label-md text-label-md text-on-secondary-fixed-variant bg-secondary-fixed/50 px-space-xs py-0.5 rounded-full font-bold"><span class="material-symbols-outlined text-[14px]">content_copy</span>+5</span>';
      return '<span class="inline-flex items-center gap-1 font-label-md text-label-md text-on-error bg-error px-space-xs py-0.5 rounded-full font-bold">0</span>';
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
          : "რაუნდი " + room.round_number + " — შემოწმება & გასწორება";
      }

      if (room.state !== "results" || verifying) return;

      const players = room.players || [];
      if (table) {
        const thead = table.querySelector("thead");
        const tbody = table.querySelector("tbody");
        if (thead) {
          thead.innerHTML =
            '<tr class="bg-primary text-on-primary">' +
            '<th class="py-space-sm px-space-md font-label-md text-label-md uppercase tracking-wider rounded-tl-xl">კატეგორია</th>' +
            players
              .map((p) => {
                const you = p.id === room.you;
                return `<th class="py-space-sm px-space-xs font-label-md text-label-md uppercase text-center">${you ? "შენ" : escapeHtml(p.name)}</th>`;
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
                  return `<td class="py-space-sm px-space-xs align-top text-center">
                    <div class="flex flex-col items-center gap-1">
                      <span class="font-body-lg text-body-lg ${invalid ? "line-through text-error decoration-secondary decoration-2" : "text-primary font-bold"}">${escapeHtml(ans || "—")}</span>
                      ${pointsBadge(pts)}
                    </div></td>`;
                })
                .join("");
              return `<tr class="border-t border-surface-container-high bg-surface">
                <td class="py-space-sm px-space-md font-headline-md text-headline-md text-primary whitespace-nowrap">${meta.ka}</td>${cells}</tr>`;
            })
            .join("");
        }
      }

      if (sidebar) {
        const ranked = [...players].sort(
          (a, b) => (room.round_totals[b.id] || 0) - (room.round_totals[a.id] || 0)
        );
        sidebar.innerHTML = ranked
          .map((p) => {
            const you = p.id === room.you;
            return `<div class="flex items-center justify-between bg-surface p-space-xs rounded shadow-xs">
              <div class="flex items-center gap-space-xs min-w-0">
                <span class="w-2.5 h-2.5 rounded-full ${you ? "bg-secondary" : "bg-outline"} shrink-0"></span>
                <span class="font-body-lg text-body-lg ${you ? "text-primary font-bold" : "text-on-surface"} truncate">${you ? "შენ" : escapeHtml(p.name)}</span>
              </div>
              <span class="font-headline-md text-headline-md ${you ? "text-secondary" : "text-primary"} shrink-0">${room.round_totals[p.id] || 0} ქ</span>
            </div>`;
          })
          .join("");
      }

      if (nextBtn) {
        nextBtn.style.display = isHostOf(room) ? "" : "none";
        const txt = room.match_over
          ? "ფინალური შედეგები"
          : "შემდეგი რაუნდი (" + (room.round_number + 1) + "/" + room.max_rounds + ")";
        const label = document.getElementById("nextRoundBtnLabel");
        if (label) label.textContent = txt;
        else nextBtn.textContent = txt;
      }
    }

    client.on("room_state", (room) => {
      latestRoom = room;
      renderResults(room);
      if (!(room.match_over && room.state === "results")) ensureOnCorrectPage(room);
    });
    client.on("round_started", (payload) => beginLetterSpin(payload));
    client.on("verification_complete", (payload) => {
      if (payload && payload.room) {
        latestRoom = payload.room;
        // personalize "you" from session if broadcast lacked it
        const sess = client.loadSession();
        if (sess.playerId && !latestRoom.you) latestRoom.you = sess.playerId;
        renderResults(latestRoom);
      }
      client.sync();
    });
    client.on("error", (err) => toast((err && err.message) || "შეცდომა"));
    // Safety poll while stuck verifying (e.g. missed socket event)
    const verifyPoll = setInterval(() => {
      if (!latestRoom || latestRoom.state !== "verifying") return;
      client.sync();
    }, 2000);
    client.socket.on("disconnect", () => clearInterval(verifyPoll));
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
            const name = you ? "შენ (" + escapeHtml(p.name) + ")" : escapeHtml(p.name);
            return `<div class="flex-1 text-center">
              ${i === 0 ? '<span class="font-label-lg text-label-lg tracking-widest text-secondary uppercase font-bold block mb-1">★ ოქროს მედალოსანი ★</span>' : ""}
              <div class="relative inline-block px-4 py-2">
                <div class="text-3xl mb-1">${medals[i]}</div>
                <div class="${i === 0 ? "font-headline-xl text-headline-xl" : "font-headline-md text-headline-md"} text-primary font-bold truncate max-w-[220px] mx-auto">${name}</div>
                <div class="font-body-xl text-body-xl text-secondary font-bold">${p.total_score} ქულა</div>
              </div>
            </div>`;
          })
          .join("");
      }

      if (standings) {
        const medals = ["🥇", "🥈", "🥉"];
        standings.innerHTML = ranked
          .map((p, i) => {
            const you = p.id === room.you;
            const name = you ? "შენ (" + escapeHtml(p.name) + ")" : escapeHtml(p.name);
            return `<div class="flex items-center justify-between py-space-sm px-space-md ${you ? "bg-surface" : "bg-surface-container-lowest/40"} hover:bg-surface-container-lowest transition-colors">
              <div class="flex items-center gap-space-xs min-w-0">
                <span class="font-headline-md text-headline-md ${i < 3 ? "text-secondary" : "text-outline"}">${i < 3 ? medals[i] : i + 1 + "."}</span>
                <div class="min-w-0">
                  <span class="font-headline-md text-headline-md text-primary block leading-none truncate">${name}</span>
                  <span class="font-label-sm text-label-sm text-outline block mt-0.5">${i === 0 ? "ჩემპიონი" : i + 1 + "-ე ადგილი"}</span>
                </div>
              </div>
              <span class="font-headline-lg text-headline-lg ${i === 0 ? "text-secondary" : "text-primary"} font-bold shrink-0">${p.total_score}</span>
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
  if (page === "spin") initSpin();
  if (page === "arena") initArena();
  if (page === "results") initResults();
  if (page === "podium") initPodium();
})();
