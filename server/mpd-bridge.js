// mpd-bridge.js — talks to MPD via mpc-js, exposes commands and a state snapshot.
//
// Browser sends:  { id, cmd, ...args }
// Bridge replies: { type: "reply", id, ok, result, state }
//                 { type: "state", state }                       (broadcast on any change)
//                 { type: "error", id?, error }                 (failure)

import { MPDConnection } from "./mpd-connection.js";

const HOST = process.env.MPD_HOST || "localhost";
const PORT = Number(process.env.MPD_PORT || 6600);
const PASSWORD = process.env.MPD_PASSWORD || null;

export const mpc = new MPDConnection();
let connected = false;
let reconnecting = null; // single in-flight reconnect; everyone awaits this

export async function startMpd() {
  return reconnect();
}

function connectOnce() {
  // mpc-js does not reject connectTCP when the handshake socket fails.
  // Convert its events into a bounded connection attempt so retries continue.
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      mpc.off("socket-error", fail);
      mpc.off("socket-end", fail);
    };
    const fail = (error) => {
      cleanup();
      reject(new Error(error?.message || error?.errorMessage || "MPD connection closed"));
    };
    const timer = setTimeout(() => fail(new Error("MPD connection timed out")), 10000);
    mpc.on("socket-error", fail);
    mpc.on("socket-end", fail);
    mpc.connectTCP(HOST, PORT).then(() => { cleanup(); resolve(); }, fail);
  });
}

async function connectLoop() {
  while (!connected) {
    try {
      await connectOnce();
      if (PASSWORD) await mpc.connection.password(escapeArgument(PASSWORD));
      // Mark connected as soon as the TCP+socket handshake completes.
      // The "ready" event also fires here, but relying on it alone
      // can leave us stuck in disconnected state if the event is
      // missed during a reconnect race.
      connected = true;
      mpc.emit("bridge-connection", true);
      console.log(`[mpd] connected to ${HOST}:${PORT}`);
      return;
    } catch (err) {
      try { mpc.disconnect(); } catch { /* already closed */ }
      console.error(`[mpd] connect failed: ${err?.message ?? err}`);
      console.error(`[mpd] retrying in 3s — is MPD running on ${HOST}:${PORT}?`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

/** Force a reconnect (used when an idle call fails). Idempotent — concurrent
 *  callers all share the same in-flight reconnect promise, so we don't
 *  open multiple parallel sockets. */
export function reconnect() {
  if (reconnecting) return reconnecting;
  connected = false;
  mpc.emit("bridge-connection", false);
  try { mpc.disconnect(); } catch { /* ignore */ }
  reconnecting = Promise.resolve().then(async () => {
    try {
      await connectLoop();
    } finally {
      reconnecting = null;
    }
  });
  return reconnecting;
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

// mpc-js interpolates these values inside quotes without escaping them.
function escapeArgument(value) {
  if (typeof value !== "string" || /[\r\n\0]/.test(value)) throw new Error("Invalid text argument");
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function numberArgument(value, min = 0, max = Infinity, integer = false) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new Error("Invalid numeric argument");
  }
  return value;
}

function tagArgument(tag) {
  if (typeof tag !== "string" || !/^[a-zA-Z][a-zA-Z0-9-]*$/.test(tag)) throw new Error("Invalid tag");
  return tag;
}

function filterArgument(filter) {
  if (!Array.isArray(filter)) throw new Error("Filter must be tag/value pairs");
  return filter.map(([tag, value]) => [tagArgument(tag), escapeArgument(value)]);
}

const directoryArgument = (path) => escapeArgument(path === "/" ? "" : path);

export function getArtwork(uri) {
  return mpc.database.getPicture(escapeArgument(uri));
}

function normalizeTrack(t) {
  if (!t) return t;
  return {
    id:          t.id,
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
    ...normalizeTrack(e),
    file: path,           // alias for paths
    path,
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
  async play({ index } = {})          { return mpc.playback.play(index === undefined ? undefined : numberArgument(index, 0, Infinity, true)); },
  async pause()                       { return mpc.playback.pause(); },
  async next()                        { return mpc.playback.next(); },
  async previous()                    { return mpc.playback.previous(); },
  async seek({ pos })                 { return mpc.playback.seekCur(numberArgument(pos)); },
  async setvol({ value })             { return mpc.playbackOptions.setVolume(numberArgument(value, 0, 100, true)); },
  async random({ value })             { return mpc.playbackOptions.setRandom(!!value); },
  async repeat({ value }) {
    // mpd has two flags that together express off / all / one:
    //   off  → repeat 0, single 0
    //   all  → repeat 1, single 0
    //   one  → repeat 1, single 1
    const v = numberArgument(value, 0, 2, true);
    await mpc.playbackOptions.setRepeat(v > 0);
    await mpc.playbackOptions.setSingle(v === 2);
    return { mode: v };
  },
  async single({ value })             { return mpc.playbackOptions.setSingle(!!value); },

  // Queue
  async playlist()                    { return mpc.currentPlaylist.playlistInfo(); },
  async clear()                       { return mpc.currentPlaylist.clear(); },
  async delete({ position })          { return mpc.currentPlaylist.delete(numberArgument(position, 0, Infinity, true)); },
  async move({ from, to })            { return mpc.currentPlaylist.move(numberArgument(from, 0, Infinity, true), numberArgument(to, 0, Infinity, true)); },
  async add({ uri })                  { return mpc.currentPlaylist.add(escapeArgument(uri)); },
  async playuris({ uris, index = 0 }) {
    if (!Array.isArray(uris) || !uris.length) throw new Error("No tracks selected");
    const paths = uris.map(escapeArgument);
    numberArgument(index, 0, paths.length - 1, true);
    await mpc.currentPlaylist.clear();
    // One browser command and one final snapshot; preserve the displayed order.
    for (const uri of paths) await mpc.currentPlaylist.add(uri);
    await mpc.playback.play(index);
  },
  async addsearch({ query, type = "any" } = {}) {
    return mpc.database.searchAdd(filterArgument([[type, query]]));
  },

  // Library / browse
  async lsinfo({ path = "" } = {})   { return mpc.database.listInfo(directoryArgument(path)); },
  async search({ query, type = "any" } = {}) {
    return mpc.database.search(filterArgument([[type, query]]));
  },
  async find({ filter = [] } = {}) {
    return mpc.database.find(filterArgument(filter));
  },
  async list({ tag, filter = [] } = {}) {
    return mpc.database.list(tagArgument(tag), filterArgument(filter));
  },
  async update({ path = "" } = {})   { return mpc.database.update(directoryArgument(path)); },
  async stats()                       { return mpc.status.statistics(); },

  // Stored (named) playlists
  async listplaylists()               { return mpc.storedPlaylists.listPlaylists(); },
  async listplaylist({ name })        { return mpc.storedPlaylists.listPlaylistInfo(escapeArgument(name)); },
  async load({ name })                { return mpc.storedPlaylists.load(escapeArgument(name)); },
  async playplaylist({ name, index = 0 }) {
    const tracks = await mpc.storedPlaylists.listPlaylistInfo(escapeArgument(name));
    return commands.playuris({ uris: tracks.map((t) => t.path), index });
  },
  async save({ name })                { return mpc.storedPlaylists.save(escapeArgument(name)); },
  async createplaylist({ name }) {
    const escaped = escapeArgument(name);
    // save fails if the name exists, so an existing playlist is never cleared.
    await mpc.storedPlaylists.save(escaped);
    await mpc.storedPlaylists.playlistClear(escaped);
  },
  async renameplaylist({ from, to })  { return mpc.storedPlaylists.rename(escapeArgument(from), escapeArgument(to)); },
  async deleteplaylist({ name })      { return mpc.storedPlaylists.remove(escapeArgument(name)); },
  async addtoplaylist({ name, uri })  { return mpc.storedPlaylists.playlistAdd(escapeArgument(name), escapeArgument(uri)); },
  async removefromplaylist({ name, position }) {
    return mpc.storedPlaylists.playlistDelete(escapeArgument(name), numberArgument(position, 0, Infinity, true));
  },
};

let commandTail = Promise.resolve();

export function handleCommand(msg) {
  const task = commandTail.then(() => executeCommand(msg));
  commandTail = task.catch(() => {});
  return task;
}

async function executeCommand(msg) {
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) throw new Error("Invalid command message");
  const { id, cmd, ...args } = msg;
  if (!Object.hasOwn(commands, cmd)) throw new Error(`unknown command: ${cmd}`);
  if (!connected) {
    throw new Error("MPD is reconnecting. Please try again shortly.");
  }
  const fn = commands[cmd];
  if (!fn) throw new Error(`unknown command: ${cmd}`);
  let result;
  try {
    result = await fn(args);
  } catch (err) {
    // mpc-js sometimes throws on a dead connection without firing its
    // own socket-error event. Kick a reconnect so the next call works.
    const msg = err?.message ?? err?.errorMessage ?? String(err);
    if (/not connected|disconnected|invalid state/i.test(msg)) {
      reconnect().catch((e) => console.error("[mpd] reconnect failed:", e?.message ?? e));
    }
    throw new Error(msg);
  }
  // Normalize track-shaped and lsinfo-shaped results so the frontend
  // sees consistent field names.
  if (["playlist", "search", "find", "listplaylist", "lsinfo"].includes(cmd)) {
    result = normalizeList(result);
  }
  const readOnly = ["playlist", "search", "find", "list", "listplaylist", "listplaylists", "lsinfo", "stats"];
  return { id, ok: true, result, ...(!readOnly.includes(cmd) ? { state: await snapshotState() } : {}) };
}

// ---------- State snapshot ----------
//
// A flat object the UI can subscribe to. Whenever MPD changes, the server
// re-snapshots and broadcasts the whole thing; the client just assigns.

function disconnectedState() {
  return {
    connected: false, playing: false, track: null, queue: [],
    volume: 0, elapsed: 0, duration: 0,
    random: false, repeat: 0, single: false,
    stats: { artists: 0, albums: 0, songs: 0 },
  };
}

export async function snapshotState() {
  if (!connected) {
    // Respond promptly during an outage; reconnection publishes fresh state.
    return disconnectedState();
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
      repeat: status?.repeat ? (status.single === true ? 2 : 1) : 0,
      single: !!status?.single,
      stats: {
        artists: Number(stats?.artists ?? 0),
        albums:  Number(stats?.albums ?? 0),
        songs:   Number(stats?.songs ?? 0),
      },
    };
  } catch (err) {
    // A snapshot can fail transiently (e.g. MPD is busy with another
    // command, or two snapshots race). For most errors we just return
    // a disconnected shape and let the next snapshot try again.
    // For real connection failures ("Not connected", "Disconnected")
    // we trigger a reconnect — mpc-js's automatic recovery doesn't
    // always fire `socket-error` reliably, so we kick it ourselves.
    const msg = err?.message ?? err?.errorMessage ?? String(err);
    console.error("[mpd] snapshot failed:", msg);
    if (/not connected|disconnected|invalid state/i.test(msg)) {
      reconnect().catch((e) => console.error("[mpd] reconnect failed:", e?.message ?? e));
    }
    return disconnectedState();
  }
}

// ---------- Idle loop ----------
//
// mpc-js auto-enters idle mode after every command and emits "changed"
// (and "changed-<subsystem>") events on the mpc instance when MPD signals
// a change. It also emits "changed" with an empty list when noidle cancels
// a wait. Only actual subsystem changes should trigger a fresh snapshot.

export function startIdleLoop(onChange) {
  let timer = null;
  let pushing = false;
  let pending = false;
  let stopped = false;
  let connectionVersion = 0;
  let checkingHealth = false;

  const publish = (state) => {
    try { onChange(state); }
    catch (err) { console.error("[idle] state publication failed:", err?.message ?? err); }
  };

  const flush = async () => {
    timer = null;
    if (stopped || pushing || !pending || !connected) return;
    pending = false;
    pushing = true;
    const version = connectionVersion;
    try {
      const state = await snapshotState();
      // A disconnect publishes immediately. An older in-flight snapshot
      // must not overwrite it or the state from a new connection.
      if (!stopped && version === connectionVersion) publish(state);
    } catch (err) {
      console.error("[idle] snapshot failed:", err?.message ?? err);
    } finally {
      pushing = false;
      // Changes stay pending even when a snapshot takes longer than 60 ms.
      // Start one follow-up timer after it finishes; never recurse or leave
      // an old timer running alongside the next snapshot.
      if (pending) schedule();
    }
  };

  const schedule = () => {
    if (stopped) return;
    pending = true;
    if (timer || pushing || !connected) return;
    timer = setTimeout(flush, 60);
  };

  const changed = (subsystems) => {
    if (subsystems.length > 0) schedule();
  };

  const connectionChanged = (isConnected) => {
    connectionVersion++;
    clearTimeout(timer);
    timer = null;
    pending = false;
    if (isConnected) schedule();
    else publish(disconnectedState());
  };

  mpc.on("changed", changed);

  // Reconnect if MPD disappears.
  const recover = () => {
    if (!stopped) reconnect().catch((err) => console.error("[mpd] reconnect failed:", err));
  };
  mpc.on("socket-error", recover);
  mpc.on("socket-end", recover);
  mpc.on("bridge-connection", connectionChanged);

  // Periodic health check. mpc-js sometimes fails to fire its
  // `socket-error` event on a dead connection, leaving us stuck in
  // `connected = true` even though the socket is gone. A lightweight
  // `ping` every 30s catches that and triggers a clean reconnect.
  const healthTimer = setInterval(async () => {
    if (stopped || checkingHealth || !connected || reconnecting) return;
    checkingHealth = true;
    try {
      await mpc.connection.ping();
    } catch (err) {
      const msg = err?.message ?? String(err);
      console.warn("[mpd] health-check ping failed:", msg);
      recover();
    } finally {
      checkingHealth = false;
    }
  }, 30_000);
  healthTimer.unref?.();

  if (connected) schedule();

  return () => {
    stopped = true;
    pending = false;
    clearTimeout(timer);
    clearInterval(healthTimer);
    mpc.off("changed", changed);
    mpc.off("socket-error", recover);
    mpc.off("socket-end", recover);
    mpc.off("bridge-connection", connectionChanged);
  };
}
