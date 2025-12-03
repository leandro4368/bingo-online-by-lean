const path = require("path");
const express = require("express");
const app = express();
const PORT = process.env.PORT || 10000;

// Servir archivos estáticos
app.use(express.static(path.join(__dirname)));

// Servidor HTTP
const server = app.listen(PORT, () => {
    console.log("Servidor web iniciado en http://localhost:" + PORT);
});

// WebSocket
const WebSocket = require("ws");
const wss = new WebSocket.Server({ server });

/* =====================================================================
   ESTADO DEL SERVIDOR
===================================================================== */
let players = new Map();      // playerKey -> ws
let adminSocket = null;

/* =====================================================================
   ENVÍO SEGURO
===================================================================== */
function safeSend(ws, obj) {
    try {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(obj));
        }
    } catch (e) {
        console.log("safeSend error:", e);
    }
}

/* =====================================================================
   NOTIFICAR LISTA DE JUGADORES AL ADMIN
===================================================================== */
function broadcastPlayerListToAdmin() {
    const lista = Array.from(players.keys());
    console.log("📤 ENVIANDO LISTA AL ADMIN:", lista);

    if (adminSocket) {
        safeSend(adminSocket, { type: "player-list", players: lista });
    } else {
        console.log("⚠️ No hay admin conectado.");
    }
}

/* =====================================================================
   CONEXIONES WS
===================================================================== */
wss.on("connection", (ws) => {
    ws.isAlive = true;

    console.log("🔵 Nueva conexión WebSocket");

    ws.on("pong", () => (ws.isAlive = true));

    /* ---------------------------------------
       MENSAJE RECIBIDO
    ----------------------------------------*/
    ws.on("message", (msg) => {
        let data;
        try { 
            data = JSON.parse(msg); 
        } catch (e) { 
            console.log("❌ JSON inválido:", msg);
            return;
        }

        console.log("📥 Mensaje recibido:", data);

        /* =============================================================
           PLAYER ENTRA
        ============================================================= */
        if (data.type === "player-join" && data.playerKey) {
            const key = data.playerKey;

            players.set(key, ws);
            ws.playerKey = key;

            console.log(`🟢 PLAYER JOIN -> ${key} (total: ${players.size})`);

            broadcastPlayerListToAdmin();
            return;
        }

        /* =============================================================
           ADMIN ENTRA
        ============================================================= */
        if (data.type === "admin-join") {
            adminSocket = ws;
            ws.isAdmin = true;

            console.log("🟡 ADMIN conectado.");

            // Enviar estado inicial
            safeSend(ws, {
                type: "state",
                players: Array.from(players.keys()),
            });

            return;
        }

        /* =============================================================
           ADMIN PIDE FORZADO LISTA
        ============================================================= */
        if (data.type === "request-player-list") {
            console.log("🟠 Admin pidió la lista manualmente.");
            broadcastPlayerListToAdmin();
            return;
        }

        /* =============================================================
           NUEVO NÚMERO
        ============================================================= */
        if (data.type === "new-number") {
            wss.clients.forEach(c =>
                safeSend(c, { type: "number", number: data.number })
            );
        }

        /* =============================================================
           RESET
        ============================================================= */
        if (data.type === "reset-numbers") {
            wss.clients.forEach(c => safeSend(c, { type: "reset" }));
        }

        /* =============================================================
           ASIGNAR CARTONES
        ============================================================= */
        if (data.type === "assign-cartones") {
            const { playerKey, cartones } = data;
            const targetWS = players.get(playerKey);

            if (targetWS) {
                safeSend(targetWS, { type: "cartones", cartones });
                console.log("🟦 Cartones enviados al jugador", playerKey);
            } else {
                console.log("⚠️ Jugador no encontrado para cartones:", playerKey);
            }
        }

        /* =============================================================
           REPORTES (Terna, Quintina, Bingo)
        ============================================================= */
        if (data.type === "report" && adminSocket) {
            safeSend(adminSocket, { type: "report", report: data.report });
            console.log("📣 Reporte recibido y reenviado al admin:", data.report);
        }
    });

    /* ---------------------------------------
       CLIENTE DESCONECTADO
    ----------------------------------------*/
    ws.on("close", () => {
        console.log("🔴 Socket cerrado:", ws.playerKey || "desconocido");

        if (ws.playerKey) {
            players.delete(ws.playerKey);
            broadcastPlayerListToAdmin();
        }

        if (ws === adminSocket) {
            adminSocket = null;
            console.log("⚠️ Admin desconectado.");
        }
    });
});

/* =====================================================================
   PING PARA DETECTAR CAÍDA DE WS
===================================================================== */
setInterval(() => {
    wss.clients.forEach(ws => {
        if (!ws.isAlive) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 10000);

