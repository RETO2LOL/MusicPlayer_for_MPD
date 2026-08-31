// mpd.js — WebSocket client for the MPD bridge.
//
// The server (server/index.js) connects to MPD and exposes /mpd as a WebSocket.
// We send commands and receive state patches. All UI state flows from one
// subscribe() callback, so the UI is just a function of bridge state.

const ENDPOINT = (location.protocol === "https:" ? "wss:" : "ws:") + "//" + location.host + "/mpd";

class MPDClient {
  constructor() {
    this.ws = null;
    this._listeners = new Set();
    this._rawListeners = new Set(); // see _handleRaw
    this._pending = new Map();      // id → { resolve, reject }
    this._id = 0;
    this._reconnectDelay = 1000;

    this._state = {
      connected: false,
      playing: false,
      track: null,
      queue: [],
      volume: 0,
      elapsed: 0,
      duration: 0,
      random: false,
      repeat: 0,        // 0 = off, 1 = all, 2 = one
      single: false,
      stats: { artists: 0, albums: 0, songs: 0 },
    };
  }

  // ---------- Pub/sub ----------

  /** Subscribe to state changes. Callback receives the latest state. */
  subscribe(fn) {
    this._listeners.add(fn);
    fn(this._state);
    return () => this._listeners.delete(fn);
  }

  /** Subscribe to every raw WS message (used by views for library-updated events). */
  subscribeRaw(fn) {
    this._rawListeners.add(fn);
    return () => this._rawListeners.delete(fn);
  }

  _emit() {
    for (const fn of this._listeners) fn(this._state);
  }

  // ---------- Connection ----------

  connect() {
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;
    this.ws = new WebSocket(ENDPOINT);

    this.ws.addEventListener("open", () => {
      this._reconnectDelay = 1000;
      this._state.connected = true;
      this._emit();
    });

    this.ws.addEventListener("close", () => {
      this._state.connected = false;
      this._state.playing = false;
      this._state.track = null;
      this._state.queue = [];
      this.ws = null;
      this._emit();
      setTimeout(() => this.connect(), this._reconnectDelay);
      this._reconnectDelay = Math.min(this._reconnectDelay * 2, 15000);
    });

    this.ws.addEventListener("message", (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      this._handle(msg);
      for (const fn of this._rawListeners) fn(msg);
    });
  }

  _handle(msg) {
    if (msg.type === "state" && msg.state) {
      Object.assign(this._state, msg.state);
      this._emit();
      return;
    }
    if (msg.type === "reply" && msg.id != null) {
      const p = this._pending.get(msg.id);
      if (p) {
        this._pending.delete(msg.id);
        msg.ok ? p.resolve(msg.result) : p.reject(new Error(msg.error));
      }
    }
  }

  _send(cmd, args = {}) {
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState !== WebSocket.OPEN) {
        return reject(new Error("not connected"));
      }
      const id = ++this._id;
      this._pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, cmd, ...args }));
    });
  }

  // ---------- Playback ----------

  play()             { return this._send("play"); }
  pause()            { return this._send("pause"); }
  toggle()           { return this._state.playing ? this.pause() : this.play(); }
  next()             { return this._send("next"); }
  previous()         { return this._send("previous"); }
  seek(pos)          { return this._send("seek", { pos: Number(pos) }); }
  setVolume(value)   { return this._send("setvol", { value: Math.round(value) }); }
  setShuffle(value)  { return this._send("random", { value: !!value }); }
  setRepeat(value)   { return this._send("repeat", { value: Number(value) }); }
  setSingle(value)   { return this._send("single", { value: !!value }); }

  // ---------- Queue ----------

  playlist()         { return this._send("playlist"); }
  clear()            { return this._send("clear"); }
  removeAt(position) { return this._send("delete", { position: Number(position) }); }
  move(from, to)     { return this._send("move", { from: Number(from), to: Number(to) }); }
  add(uri)           { return this._send("add", { uri }); }
  addSearch(query, type = "any") {
    return this._send("addsearch", { query, type });
  }
  playAt(index)      { return this._send("play", { index: Number(index) }); }

  // ---------- Library / browse ----------

  lsinfo(path = "/")            { return this._send("lsinfo", { path }); }
  search(query, type = "any")   { return this._send("search", { query, type }); }
  list(tag, filter = "")        { return this._send("list", { tag, filter }); }
  update(path = "/")            { return this._send("update", { path }); }
  stats()                       { return this._send("stats"); }

  // ---------- Playlists ----------

  listPlaylists()              { return this._send("listplaylists"); }
  listPlaylist(name)           { return this._send("listplaylist", { name }); }
  loadPlaylist(name)           { return this._send("load", { name }); }
  savePlaylist(name)           { return this._send("save", { name }); }
  createPlaylist(name)         { return this._send("createplaylist", { name }); }
  renamePlaylist(from, to)     { return this._send("renameplaylist", { from, to }); }
  deletePlaylist(name)         { return this._send("deleteplaylist", { name }); }
  addToPlaylist(name, uri)     { return this._send("addtoplaylist", { name, uri }); }
  removeFromPlaylist(name, pos){ return this._send("removefromplaylist", { name, position: Number(pos) }); }

  // ---------- Artwork ----------

  /** URL for an <img> that proxies MPD's readpicture. */
  artworkUrl(uri) {
    return "/artwork?uri=" + encodeURIComponent(uri);
  }
}

export const mpd = new MPDClient();
