// server.js
const express = require("express");
const { WebSocketServer } = require("ws");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Servir archivos estáticos (tu sitio)
app.use(express.static(path.join(__dirname, "/")));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});


const server = app.listen(PORT, () => {
  console.log("Servidor corriendo en http://localhost:" + PORT);
});

// WebSocket Server
const wss = new WebSocketServer({ server });

// Map de playerKey -> ws
const players = new Map();
let adminSocket = null;
let lastNumbers = []; // historial

function safeSend(ws, obj) {
  try {
    if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
  } catch (e) { /* ignore */ }
}

function broadcastToAll(obj) {
  const msg = JSON.stringify(obj);
  wss.clients.forEach(c => {
    if (c.readyState === c.OPEN) c.send(msg);
  });
}

function broadcastPlayerListToAdmin() {
  // Enviar lista de jugadores conectados (keys)
  const lista = Array.from(players.keys());
  if (adminSocket) {
    safeSend(adminSocket, { type: "player-list", players: lista });
  }
}

wss.on("connection", (ws) => {
  ws.isAlive = true;

  ws.on("pong", () => {
    ws.isAlive = true;
  });

  ws.on("message", (msg) => {
    let data;
    try { data = JSON.parse(msg); } catch (e) { return; }

    // Player se conecta y envía su key (player-<nombre>)
    if (data.type === "player-join" && data.playerKey) {
      const key = data.playerKey;
      players.set(key, ws);
      ws.playerKey = key;

      // enviar estado inicial (números ya sorteados)
      safeSend(ws, { type: "state", lastNumbers });

      // notificar admin lista
      broadcastPlayerListToAdmin();
      return;
    }

    // Admin se conecta
    if (data.type === "admin-join") {
      adminSocket = ws;
      // enviar estado actual con jugadores y números
      safeSend(ws, {
        type: "state",
        players: Array.from(players.keys()),
        lastNumbers
      });
      return;
    }

    // Admin asigna cartones a un playerKey
    if (data.type === "assign-cartones" && data.playerKey && data.cartones) {
      const target = players.get(data.playerKey);
      // enviar al jugador si está conectado
      if (target) {
        safeSend(target, {
          type: "assign-cartones",
          cartones: data.cartones
        });
      }
      // también informar al admin (confirmación)
      if (adminSocket && adminSocket.readyState === adminSocket.OPEN) {
        safeSend(adminSocket, {
          type: "assign-confirm",
          playerKey: data.playerKey,
          cartonesCount: (data.cartones || []).length
        });
      }
      return;
    }

    // Admin saca número -> broadcast
    if (data.type === "new-number" && typeof data.number === "number") {
      if (!lastNumbers.includes(data.number)) {
        lastNumbers.push(data.number);
      }
      broadcastToAll({ type: "number", number: data.number });
      return;
    }

    // Reiniciar sorteo (admin)
    if (data.type === "reset-numbers") {
      lastNumbers = [];
      broadcastToAll({ type: "reset" });
      return;
    }

    // Jugador reporta terna/cuaterna/quintina/bingo al admin
    if (data.type === "report" && data.report) {
      if (adminSocket) {
        safeSend(adminSocket, {
          type: "report",
          report: data.report
        });
      }
      return;
    }

    // Solicitud explícita de lista de jugadores (admin)
    if (data.type === "request-player-list") {
      broadcastPlayerListToAdmin();
      return;
    }
  });

  ws.on("close", () => {
    // limpiar registros
    if (ws === adminSocket) adminSocket = null;
    if (ws.playerKey) players.delete(ws.playerKey);
    broadcastPlayerListToAdmin();
  });

  ws.on("error", ()=>{ /* noop */ });
});

// ping-pong para detectar conexiones muertas
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);
