/**
 * Socket.IO protocol helper for Qalaqobana.
 */
(function (global) {
  const STORE_KEY = "qalaqobana_session";

  function loadSession() {
    try {
      return JSON.parse(sessionStorage.getItem(STORE_KEY) || "{}");
    } catch (e) {
      return {};
    }
  }

  function saveSession(partial) {
    const next = Object.assign(loadSession(), partial || {});
    sessionStorage.setItem(STORE_KEY, JSON.stringify(next));
    return next;
  }

  function clearSession() {
    sessionStorage.removeItem(STORE_KEY);
  }

  function createClient(options) {
    const opts = options || {};
    const socket = global.io(opts.url || undefined, { transports: ["polling"], upgrade: false, reconnection: true });
    const session = loadSession();
    let playerId = session.playerId || null;
    let roomCode = session.roomCode || null;
    let playerName = session.playerName || null;

    const api = {
      socket,
      get playerId() {
        return playerId;
      },
      get roomCode() {
        return roomCode;
      },
      get playerName() {
        return playerName;
      },
      saveSession,
      loadSession,
      clearSession,

      on(event, fn) {
        socket.on(event, fn);
        return api;
      },

      meta() {
        socket.emit("meta");
      },

      createRoom(playerNameArg, optionsArg) {
        const o = optionsArg || {};
        playerName = playerNameArg;
        socket.emit("create_room", {
          player_name: playerNameArg,
          categories: o.categories || null,
          max_rounds: o.maxRounds || null,
          round_seconds: o.roundSeconds || null,
        });
      },

      joinRoom(code, playerNameArg) {
        playerName = playerNameArg;
        socket.emit("join_room", {
          code: String(code || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase(),
          player_name: playerNameArg,
        });
      },

      leaveRoom() {
        if (!roomCode || !playerId) return;
        socket.emit("leave_room", { code: roomCode, player_id: playerId });
      },

      setCategories(categories) {
        socket.emit("set_categories", {
          code: roomCode,
          player_id: playerId,
          categories: categories,
        });
      },

      setSettings(payload) {
        socket.emit("set_settings", Object.assign({
          code: roomCode,
          player_id: playerId,
        }, payload || {}));
      },

      startRound() {
        socket.emit("start_round", { code: roomCode, player_id: playerId });
      },

      updateAnswers(answers) {
        socket.emit("update_answers", {
          code: roomCode,
          player_id: playerId,
          answers: answers,
        });
      },

      stopRound() {
        socket.emit("stop_round", { code: roomCode, player_id: playerId });
      },

      nextRound() {
        socket.emit("next_round", { code: roomCode, player_id: playerId });
      },

      returnLobby() {
        socket.emit("return_lobby", { code: roomCode, player_id: playerId });
      },

      sync() {
        if (!roomCode || !playerId) return;
        socket.emit("sync", { code: roomCode, player_id: playerId });
      },
    };

    function persist(pid, code, name) {
      if (pid) playerId = pid;
      if (code) roomCode = code;
      if (name) playerName = name;
      saveSession({ playerId: playerId, roomCode: roomCode, playerName: playerName });
    }

    socket.on("room_created", (payload) => {
      persist(payload.player_id, payload.room && payload.room.code, playerName);
    });

    socket.on("room_joined", (payload) => {
      persist(payload.player_id, payload.room && payload.room.code, playerName);
    });

    socket.on("room_state", (room) => {
      if (room && room.code) roomCode = room.code;
      if (room && room.you) playerId = room.you;
      saveSession({ playerId: playerId, roomCode: roomCode, playerName: playerName });
    });

    socket.on("left_room", () => {
      playerId = null;
      roomCode = null;
      clearSession();
    });

    return api;
  }

  global.QalaqobanaClient = {
    create: createClient,
    loadSession: loadSession,
    saveSession: saveSession,
    clearSession: clearSession,
  };
})(window);
