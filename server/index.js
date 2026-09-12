// server/index.js — Express + WebSocket entry point.
//
// Serves the static frontend from ../public and exposes:
//   GET  /artwork?uri=…    — binary album art (proxies MPD readpicture, cached)
//   WS   /mpd              — command/state stream for the frontend
//
// Same-origin, so no CORS configuration needed.

import express from "express";
import { WebSocketServer } from "ws";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  startMpd,
  startIdleLoop,
  handleCommand,
  snapshotState,
  mpc,
  getArtwork,
} from "./mpd-bridge.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(__dirname, "..", "public");
const PORT = Number(process.env.PORT || 3000);

// ---------- HTTP / static ----------
const app = express();
app.use(express.static(PUBLIC_DIR));

// ---------- Artwork cache ----------
//
// 10-minute in-memory cache keyed by URI. We hold at most a few hundred
// covers; older entries fall out naturally as the Map grows.
const artworkCache = new Map();
const ARTWORK_TTL_MS = 10 * 60 * 1000;
const ARTWORK_MAX = 500;

function cacheGet(uri) {
  const hit = artworkCache.get(uri);
  if (!hit) return null;
  if (Date.now() - hit.at > ARTWORK_TTL_MS) {
    artworkCache.delete(uri);
    return null;
  }
  // Refresh recency.
  artworkCache.delete(uri);
  artworkCache.set(uri, hit);
  return hit;
}

function cacheSet(uri, value) {
  if (artworkCache.size >= ARTWORK_MAX) {
    const firstKey = artworkCache.keys().next().value;
    artworkCache.delete(firstKey);
  }
  artworkCache.set(uri, { at: Date.now(), ...value });
}

app.get("/artwork", async (req, res) => {
  const uri = req.query.uri;
  if (!uri || typeof uri !== "string") {
    return res.status(400).send("uri required");
  }

  const cached = cacheGet(uri);
  if (cached) {
    res.set("Content-Type", cached.type);
    res.set("Cache-Control", "public, max-age=600");
    return res.send(cached.data);
  }

  try {
    const picture = await getArtwork(uri);
    if (!picture || !picture.data) {
      // 204 is friendlier than 404 in the browser console — the artwork
      // element's `onerror` handler will still fire and use the gradient.
      res.status(204).end();
      return;
    }
    // mpc-js returns `data` as an ArrayBuffer.
    const buf = Buffer.from(picture.data);
    const type = picture.type || "image/jpeg";
    cacheSet(uri, { type, data: buf });
    res.set("Content-Type", type);
    res.set("Cache-Control", "public, max-age=600");
    res.send(buf);
  } catch (err) {
    res.status(204).end();
  }
});

// ---------- WebSocket ----------
const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/mpd", maxPayload: 4 * 1024 * 1024 });

function send(ws, message) {
  if (ws.readyState === 1) ws.send(JSON.stringify(message));
}

function broadcast(type, payload) {
  const msg = JSON.stringify({ type, ...payload });
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(msg);
  }
}

wss.on("connection", (ws) => {
  console.log("[ws] client connected");
  // Register listeners before awaiting MPD so early browser commands aren't lost.
  ws.on("message", async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); }
    catch { return send(ws, { type: "error", error: "invalid json" }); }

    try {
      const reply = await handleCommand(msg);
      send(ws, { type: "reply", ...reply });
      // Also broadcast — every client wants to know.
      if (reply.state) broadcast("state", { state: reply.state });
    } catch (err) {
      send(ws, { type: "reply", id: msg?.id, ok: false, error: err.message });
    }
  });

  ws.on("close", () => console.log("[ws] client disconnected"));
  ws.on("error", (err) => console.warn("[ws] client error:", err.message));
  snapshotState().then((state) => send(ws, { type: "state", state }))
    .catch((err) => send(ws, { type: "error", error: err.message }));
});

let stopIdleLoop;

server.listen(PORT, async () => {
  console.log(`[http] serving ${PUBLIC_DIR}`);
  console.log(`[http] listening on http://localhost:${PORT}`);
  // Install recovery and state listeners before the first connection attempt.
  stopIdleLoop = startIdleLoop((state) => broadcast("state", { state }));
  await startMpd();
});

// Graceful shutdown
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    console.log(`[${sig}] shutting down`);
    stopIdleLoop?.();
    for (const client of wss.clients) client.terminate();
    mpc.disconnect();
    wss.close();
    server.close(() => process.exit(0));
  });
}
