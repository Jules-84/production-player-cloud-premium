const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { WebSocketServer, WebSocket } = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

const PORT = Number(process.env.PORT || 8787);
const DESKTOP_SECRET = String(process.env.DESKTOP_SECRET || "CHANGE_ME");
const sessions = new Map();

app.disable("x-powered-by");

function remotePagePath() {
  const publicFile = path.join(__dirname, "public", "remote.html");
  const rootFile = path.join(__dirname, "remote.html");
  if (fs.existsSync(publicFile)) return publicFile;
  if (fs.existsSync(rootFile)) return rootFile;
  return "";
}

app.get("/", (_req, res) => {
  res.type("text").send("Production Player Cloud v3 is running.");
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "Production Player Cloud",
    version: "3.0.0",
    sessions: sessions.size
  });
});

app.get("/remote/:sessionId", (_req, res) => {
  const file = remotePagePath();
  if (!file) {
    res.status(500).type("text").send("remote.html is missing.");
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  res.sendFile(file);
});

function cleanSessionId(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 12);
}

function getSession(id) {
  if (!sessions.has(id)) {
    sessions.set(id, {
      desktop: null,
      remotes: new Set(),
      state: {
        productionName: "Production",
        currentCue: "Ready",
        nextCue: "No next cue",
        isPlaying: false,
        elapsedSeconds: 0,
        durationSeconds: 0,
        progress: 0
      },
      updatedAt: Date.now()
    });
  }
  return sessions.get(id);
}

function send(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcastRemotes(session, data) {
  for (const remote of session.remotes) {
    send(remote, data);
  }
}

server.on("upgrade", (request, socket, head) => {
  try {
    const url = new URL(request.url, "http://localhost");
    const role = url.searchParams.get("role");
    const sessionId = cleanSessionId(url.searchParams.get("session"));
    const secret = url.searchParams.get("secret") || "";

    if (!sessionId || !["desktop", "remote"].includes(role)) {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      return;
    }

    if (role === "desktop" && secret !== DESKTOP_SECRET) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, ws => {
      wss.emit("connection", ws, { role, sessionId });
    });
  } catch {
    socket.destroy();
  }
});

wss.on("connection", (ws, context) => {
  const { role, sessionId } = context;
  const session = getSession(sessionId);

  if (role === "desktop") {
    if (session.desktop && session.desktop !== ws) {
      try { session.desktop.close(1012, "Replaced"); } catch {}
    }

    session.desktop = ws;
    session.updatedAt = Date.now();

    send(ws, { type: "ready", sessionId });
    broadcastRemotes(session, { type: "desktopOnline" });
    broadcastRemotes(session, { type: "state", state: session.state });

    ws.on("message", raw => {
      try {
        const message = JSON.parse(String(raw));
        if (message.type === "state" && message.state) {
          session.state = {
            productionName: String(message.state.productionName || "Production"),
            currentCue: String(message.state.currentCue || "Ready"),
            nextCue: String(message.state.nextCue || "No next cue"),
            isPlaying: Boolean(message.state.isPlaying),
            elapsedSeconds: Number(message.state.elapsedSeconds || 0),
            durationSeconds: Number(message.state.durationSeconds || 0),
            progress: Math.max(0, Math.min(1, Number(message.state.progress || 0)))
          };
          session.updatedAt = Date.now();
          broadcastRemotes(session, { type: "state", state: session.state });
        }
      } catch {}
    });

    ws.on("close", () => {
      if (session.desktop === ws) {
        session.desktop = null;
        broadcastRemotes(session, { type: "desktopOffline" });
      }
    });
    return;
  }

  session.remotes.add(ws);
  session.updatedAt = Date.now();

  send(ws, { type: session.desktop ? "desktopOnline" : "desktopOffline" });
  send(ws, { type: "state", state: session.state });

  ws.on("message", raw => {
    try {
      const message = JSON.parse(String(raw));
      if (
        message.type === "action" &&
        ["play", "pause", "next", "stop"].includes(message.action)
      ) {
        send(session.desktop, {
          type: "action",
          action: message.action
        });
      }
    } catch {}
  });

  ws.on("close", () => {
    session.remotes.delete(ws);
  });
});

setInterval(() => {
  const cutoff = Date.now() - 12 * 60 * 60 * 1000;
  for (const [id, session] of sessions.entries()) {
    if (!session.desktop && session.remotes.size === 0 && session.updatedAt < cutoff) {
      sessions.delete(id);
    }
  }
}, 60 * 60 * 1000);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Production Player Cloud v3 running on port ${PORT}`);
});
