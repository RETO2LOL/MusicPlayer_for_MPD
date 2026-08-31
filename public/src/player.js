// player.js — transport, progress, volume, status, now-playing footer.
//
// Wires DOM controls to mpd commands and renders player state. The progress
// bar is advanced locally between MPD state pushes so it moves smoothly.

import { $ } from "./dom.js";
import { mpd } from "./mpd.js";
import { mountArtwork } from "./artwork.js";
import { toast } from "./toast.js";

const fmt = (s) => {
  if (!s || isNaN(s)) return "0:00";
  s = Math.max(0, Math.floor(s));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
};

// ---------- Local rendering helpers ----------

function setStatus(state, label) {
  const dot = $(".status-dot");
  const text = $(".status-label");
  if (dot) dot.setAttribute("data-state", state);
  if (text) text.textContent = label;
}

function setPlayButton(playing) {
  const btn = $("#playBtn");
  if (!btn) return;
  btn.textContent = playing ? "⏸" : "▶";
  btn.setAttribute("title", playing ? "Pause (Space)" : "Play (Space)");
}

function setNowPlaying(track) {
  const t = $("#nowTitle");
  const a = $("#nowArtist");
  if (t) t.textContent = track?.title || "Nothing playing";
  if (a) a.textContent = track?.artist || "—";
}

function setProgress(position, duration) {
  const pct = duration > 0 ? Math.max(0, Math.min(100, (position / duration) * 100)) : 0;
  const bar = $("#progressBar");
  const thumb = $("#progressThumb");
  const cur = $("#timeCurrent");
  const tot = $("#timeTotal");
  if (bar)   bar.style.width = pct + "%";
  if (thumb) thumb.style.left = pct + "%";
  if (cur)   cur.textContent = fmt(position);
  if (tot)   tot.textContent = fmt(duration);
}

function setVolume(v) {
  const input = $("#volume");
  const mute  = $("#muteBtn");
  if (input) input.value = String(v);
  if (mute)  mute.textContent = v === 0 ? "🔇" : v < 40 ? "🔉" : "🔊";
}

function setArtwork(uri) {
  const slot = $("#artworkSm");
  if (!slot) return;
  mountArtwork(slot, { uri, size: 56 });
  slot.classList.toggle("is-pulsing", !!uri);
}

function setShuffleButton(on)  { $("#shuffleBtn")?.classList.toggle("is-on", !!on); }
function setRepeatButton(mode) {
  const btn = $("#repeatBtn");
  if (!btn) return;
  btn.classList.toggle("is-on", mode > 0);
  btn.textContent = mode === 2 ? "↻₁" : "↻";   // one vs all
  btn.title = `Repeat: ${mode === 0 ? "off" : mode === 1 ? "all" : "one"} (R)`;
}

function setStats(stats) {
  const el = $("#libStats");
  if (!el || !stats) return;
  const parts = [];
  if (stats.songs)   parts.push(`${stats.songs.toLocaleString()} tracks`);
  if (stats.albums)  parts.push(`${stats.albums.toLocaleString()} albums`);
  if (stats.artists) parts.push(`${stats.artists.toLocaleString()} artists`);
  el.textContent = parts.join(" · ") || "—";
}

// ---------- Elapsed smoothing ----------
//
// MPD only emits elapsed in the state push (e.g. on track change, pause).
// To make the bar move smoothly while playing, we tick elapsed forward
// between pushes, using performance.now() as the clock.

let lastElapsed = 0;
let lastElapsedAt = 0;
let lastDuration = 0;
let lastPlaying = false;
let lastTrackKey = null;
let rafId = null;

function startTicker() {
  if (rafId) return;
  const tick = () => {
    if (lastPlaying && lastDuration > 0) {
      const now = performance.now();
      const advanced = lastElapsed + (now - lastElapsedAt) / 1000;
      setProgress(advanced, lastDuration);
    }
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
}

function stopTicker() {
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
}

// ---------- Seek dragging ----------

function wireProgress() {
  const trackEl = $("#progressTrack");
  if (!trackEl) return;

  let dragging = false;

  const seekFromX = (clientX) => {
    const r = trackEl.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    if (lastDuration > 0) mpd.seek(pct * lastDuration).catch((e) => toast(e.message, "error"));
  };

  trackEl.addEventListener("mousedown", (e) => {
    dragging = true;
    seekFromX(e.clientX);
    e.preventDefault();
  });
  document.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    seekFromX(e.clientX);
  });
  document.addEventListener("mouseup", () => { dragging = false; });

  // Touch
  trackEl.addEventListener("touchstart", (e) => {
    dragging = true;
    seekFromX(e.touches[0].clientX);
  }, { passive: true });
  trackEl.addEventListener("touchmove", (e) => {
    if (dragging) seekFromX(e.touches[0].clientX);
  }, { passive: true });
  trackEl.addEventListener("touchend", () => { dragging = false; });
}

// ---------- Public init ----------

export function initPlayer() {
  // Controls
  $("#playBtn")?.addEventListener("click", () => mpd.toggle().catch((e) => toast(e.message, "error")));
  $("#prevBtn")?.addEventListener("click", () => mpd.previous().catch((e) => toast(e.message, "error")));
  $("#nextBtn")?.addEventListener("click", () => mpd.next().catch((e) => toast(e.message, "error")));
  $("#shuffleBtn")?.addEventListener("click", () => {
    mpd.setShuffle(!mpd._state.random).catch((e) => toast(e.message, "error"));
  });
  $("#repeatBtn")?.addEventListener("click", () => {
    const next = (Number(mpd._state.repeat ?? 0) + 1) % 3;
    mpd.setRepeat(next).then(() => {
      toast(next === 0 ? "Repeat off" : next === 1 ? "Repeat all" : "Repeat one");
    }).catch((e) => toast(e.message, "error"));
  });

  // Volume: debounce so we don't flood the server on every pixel.
  const volume = $("#volume");
  let volTimer = null;
  volume?.addEventListener("input", () => {
    if (volTimer) clearTimeout(volTimer);
    volTimer = setTimeout(() => mpd.setVolume(Number(volume.value)).catch(() => {}), 80);
  });

  $("#muteBtn")?.addEventListener("click", () => {
    const cur = Number(mpd._state.volume || 0);
    mpd.setVolume(cur === 0 ? 70 : 0).catch((e) => toast(e.message, "error"));
  });

  // Progress seek
  wireProgress();

  // Status pill: click for debug aid (cycles display, doesn't change real state).
  const cycle = [["disconnected", "Disconnected"], ["connecting", "Connecting…"], ["connected", "Connected"]];
  let idx = 0;
  $("#status")?.addEventListener("click", () => {
    idx = (idx + 1) % cycle.length;
    setStatus(cycle[idx][0], cycle[idx][1]);
  });

  // Initial render from current state
  const s0 = mpd._state;
  setStatus(s0.connected ? "connected" : "disconnected", s0.connected ? "Connected" : "Disconnected");
  setPlayButton(!!s0.playing);
  setNowPlaying(s0.track);
  setProgress(s0.elapsed, s0.duration);
  setVolume(s0.volume);
  setArtwork(s0.track?.file);
  setShuffleButton(s0.random);
  setRepeatButton(s0.repeat);
  setStats(s0.stats);
  lastElapsed = s0.elapsed || 0;
  lastElapsedAt = performance.now();
  lastDuration = s0.duration || 0;
  lastPlaying = !!s0.playing;
  startTicker();

  // Subscribe to state
  mpd.subscribe((s) => {
    setStatus(s.connected ? "connected" : "disconnected", s.connected ? "Connected" : "Disconnected");
    setPlayButton(!!s.playing);
    setNowPlaying(s.track);
    setProgress(s.elapsed, s.duration);
    setVolume(s.volume);
    setShuffleButton(s.random);
    setRepeatButton(s.repeat);
    setStats(s.stats);

    // Update ticker clock
    const key = s.track?.file || null;
    const isNewTrack = key !== lastTrackKey;
    lastTrackKey = key;
    lastElapsed = s.elapsed || 0;
    lastElapsedAt = performance.now();
    lastDuration = s.duration || 0;
    lastPlaying = !!s.playing;

    // Swap artwork
    setArtwork(s.track?.file);
    if (isNewTrack) {
      const slot = $("#artworkSm");
      slot?.classList.remove("is-pulsing");
      void slot?.offsetWidth;
      slot?.classList.add("is-pulsing");
    }
  });
}
