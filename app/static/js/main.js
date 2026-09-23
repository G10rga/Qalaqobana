/**
 * Client shell — Socket.IO connection only for now.
 * Build your animated UI on top of this and wire game events as the backend grows.
 */

(function () {
  const statusEl = document.getElementById("status");
  const socket = io();

  socket.on("connect", () => {
    statusEl.textContent = "Connected";
  });

  socket.on("connected", () => {
    statusEl.textContent = "Ready";
  });

  socket.on("disconnect", () => {
    statusEl.textContent = "Disconnected";
  });
})();
