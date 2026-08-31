// mpd-bridge.js — talks to MPD via mpc-js, exposes commands and a state snapshot.
//
// Browser sends:  { id, cmd, ...args }
// Bridge replies: { type: "reply", id, ok, result, state }
//                 { type: "state", state }                       (broadcast on any change)
//                 { type: "error", id?, error }                 (failure)

import { MPC } from "mpc-js";

const HOST = process.env.MPD_HOST || "localhost";
const PORT = Number(process.env.MPD_PORT || 6600);
const PASSWORD = process.env.MPD_PASSWORD || null;

export const mpc = new MPC();
let connected = false;
let connecting = null;

export async function startMpd() {
  return connectLoop();
}

async function connectLoop() {
  while (!connected) {
    try {
      await mpc.connectTCP(HOST, PORT);
      if (PASSWORD) await mpc.connection.sendCommands([`password ${PASSWORD}`]);
      connected = true;
      console.log(`[mpd] connected to ${HOST}:${PORT}`);
      return;
    } catch (err) {
      console.error(`[mpd] connect failed: ${err.message}`);
      console.error(`[mpd] retrying in 3s — is MPD running on ${HOST}:${PORT}?`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

/** Force a reconnect (used when an idle call fails). */
export async function reconnect() {
  connected = false;
  try { mpc.disconnect(); } catch { /* ignore */ }
  await connectLoop();
}

// ---------- Result normalization ----------
//
// mpc-js's field names differ from what the frontend expects:
//   - tracks have `path`; we alias to `file` so `t.file` works everywhere
//   - lsinfo entries have `entryType`; we alias to `type` and add a `name`
//
// Anything returned across the wire is run through `normalize` so the
// frontend sees a consistent shape.

const basename = (p) => (p || "").split("/").pop() || "";

function normalizeTrack(t) {
  if (!t) return t;
  return {
    Pos:         t.position != null ? Number(t.position) : (t.Pos != null ? Number(t.Pos) : undefined),
    file:        t.path || t.file,
    title:       t.title || t.Title,
    name:        t.name || t.Name || basename(t.path || t.file),
    artist:      t.artist,
    album:       t.album,
    albumArtist: t.albumArtist,
    track:       t.track,
    disc:        t.disc,
    date:        t.date,
    genre:       t.genre,
    duration:    t.duration,
  };
}

function normalizeLsEntry(e) {
  if (!e) return e;
  const path = e.path || e.file;
  return {
    file: path,           // alias for paths
    name: basename(path), // convenient for display
    type: e.entryType,    // "directory" | "file" | "playlist" | "song"
    title: e.title,
    artist: e.artist,
    album: e.album,
    duration: e.duration,
  };
}

function normalizeList(x) {
  if (!Array.isArray(x)) return x;
  // Heuristic: if items have an `entryType`, they're lsinfo entries.
  if (x[0] && typeof x[0] === "object" && "entryType" in x[0]) {
    return x.map(normalizeLsEntry);
  }
  return x.map(normalizeTrack);
}

const commands = {
  // Playback
  async play({ index } = {})          { return mpc.playback.play(index); },
  async pause()                       { return mpc.playback.pause(); },
  async next()                        { return mpc.playback.next(); },
  async previous()                    { return mpc.playback.previous(); },
  async seek({ pos })                 { return mpc.playback.seek(pos); },
  async setvol({ value })             { return mpc.playback.setVolume(value); },
  async random({ value })             { return mpc.playback.setRandom(!!value); },
  async repeat({ value }) {
    // mpd has two flags that together express off / all / one:
    //   off  → repeat 0, single 0
    //   all  → repeat 1, single 0
    //   one  → repeat 0, single 1
    const v = Number(value) | 0;
    await mpc.playback.setRepeat(v === 1 ? 1 : 0);
    await mpc.playback.setSingle(v === 2);
    return { mode: v };
  },
  async single({ value })             { return mpc.playback.setSingle(!!value); },

  // Queue
  async playlist()                    { return mpc.currentPlaylist.playlistInfo(); },
  async clear()                       { return mpc.currentPlaylist.clear(); },
  async delete({ position })          { return mpc.currentPlaylist.delete(position); },
  async move({ from, to })            { return mpc.currentPlaylist.move(from, to); },
  async add({ uri })                  { return mpc.currentPlaylist.add(uri); },
  async addsearch({ query, type = "any" } = {}) {
    return mpc.database.searchAdd({ [type]: query });
  },

  // Library / browse
  async lsinfo({ path = "/" } = {})   { return mpc.database.listInfo(path); },
  async search({ query, type = "any" } = {}) {
    return mpc.database.search([[type, query]]);
  },
  async list({ tag, filter = [] } = {}) {
    return mpc.database.list(tag, filter);
  },
  async update({ path = "/" } = {})   { return mpc.database.update(path); },
  async stats()                       { return mpc.status.statistics(); },

  // Stored (named) playlists
  async listplaylists()               { return mpc.storedPlaylists.listPlaylists(); },
  async listplaylist({ name })        { return mpc.storedPlaylists.listPlaylistInfo(name); },
  async load({ name })                { return mpc.storedPlaylists.load(name); },
  async save({ name })                { return mpc.storedPlaylists.save(name); },
  // mpd has no explicit "create empty playlist" command — saving the current
  // (possibly empty) queue under a new name is the canonical way.
  async createplaylist({ name })      { return mpc.storedPlaylists.save(name); },
  async renameplaylist({ from, to })  { return mpc.storedPlaylists.rename(from, to); },
  async deleteplaylist({ name })      { return mpc.storedPlaylists.remove(name); },
  async addtoplaylist({ name, uri })  { return mpc.storedPlaylists.playlistAdd(name, uri); },
  async removefromplaylist({ name, position }) {
    return mpc.storedPlaylists.playlistDelete(name, position);
  },
};

export async function handleCommand(msg) {
  const { id, cmd, ...args } = msg;
  if (!connected) throw new Error("mpd not connected");
  const fn = commands[cmd];
  if (!fn) throw new Error(`unknown command: ${cmd}`);
  let result = await fn(args);
  // Normalize track-shaped and lsinfo-shaped results so the frontend
  // sees consistent field names.
  if (["playlist", "search", "listplaylist", "lsinfo"].includes(cmd)) {
    result = normalizeList(result);
  }
  return { id, ok: true, result, state: await snapshotState() };
}

// ---------- State snapshot ----------
//
// A flat object the UI can subscribe to. Whenever MPD changes, the server
// re-snapshots and broadcasts the whole thing; the client just assigns.

export async function snapshotState() {
  if (!connected) {
    return {
      connected: false, playing: false, track: null, queue: [],
      volume: 0, elapsed: 0, duration: 0,
      random: false, repeat: 0, single: false,
      stats: { artists: 0, albums: 0, songs: 0 },
    };
  }
  try {
    const [status, currentSong, playlist, stats] = await Promise.all([
      mpc.status.status(),
      mpc.status.currentSong(),
      mpc.currentPlaylist.playlistInfo().catch(() => []),
      mpc.status.statistics().catch(() => ({})),
    ]);
    return {
      connected: true,
      playing: status?.state === "play",
      track: currentSong && currentSong.path ? normalizeTrack(currentSong) : null,
      queue: normalizeList(playlist),
      volume: status?.volume ?? 0,
      elapsed: status?.elapsed ?? 0,
      duration: status?.duration ?? 0,
      random: !!status?.random,
      repeat: Number(status?.repeat ?? 0),
      single: !!status?.single,
      stats: {
        artists: Number(stats?.artists ?? 0),
        albums:  Number(stats?.albums ?? 0),
        songs:   Number(stats?.songs ?? 0),
      },
    };
  } catch (err) {
    console.error("[mpd] snapshot failed:", err.message);
    connected = false;
    return snapshotState(); // returns disconnected shape
  }
}

// ---------- Idle loop ----------
//
// mpc-js auto-enters idle mode after every command and emits "changed"
// (and "changed-<subsystem>") events on the mpc instance when MPD signals
// a change. We listen for those and push fresh state to every client,
// debounced so a flurry of subsystem changes results in one push.

export function startIdleLoop(onChange) {
  let timer = null;
  let pushing = false;

  const flush = async () => {
    timer = null;
    if (pushing || !connected) return;
    pushing = true;
    try {
      const state = await snapshotState();
      onChange(state);
    } catch (err) {
      console.error("[idle] snapshot failed:", err.message);
    } finally {
      pushing = false;
      // If a change arrived while we were busy, flush again.
      if (timer) flush();
    }
  };

  const schedule = () => {
    if (timer) return;
    timer = setTimeout(flush, 60);
  };

  mpc.on("changed", schedule);

  // Reconnect if MPD disappears.
  mpc.on("socket-error", async () => {
    connected = false;
    try { mpc.disconnect(); } catch { /* ignore */ }
    await reconnect();
  });
  mpc.on("ready", () => { connected = true; });
}
