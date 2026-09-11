// Keep artwork and queue rows stable between MPD state updates.
import { el, fmtTime, trackRow, emptyState, mpd, mountArtwork, toast } from "./_shared.js";

let unsub, container, card, meta, upNext, playButton;
let lastUri, lastMeta, lastQueue;

function render(s) {
  playButton.textContent = s.playing ? "Pause" : "Play";
  playButton.disabled = !s.connected || !s.track;
  if (!s.track) {
    card = null; lastUri = lastMeta = lastQueue = null;
    container.replaceChildren(emptyState({
      icon: "♪", title: s.connected ? "Your next listen awaits" : "Waiting for MPD",
      sub: s.connected ? "Explore your library and choose a track to get started." : "Your music will appear when the connection is ready.",
    }));
    return;
  }
  const t = s.track;
  if (!card || lastUri !== t.file) {
    const art = el("div", { class: "artwork artwork-lg" });
    mountArtwork(art, { uri: t.file, size: 320 });
    meta = el("div", { class: "now-playing-details" });
    card = el("div", { class: "now-playing-card" }, art, meta);
    upNext = el("section", { class: "up-next" });
    container.replaceChildren(card, upNext);
    lastUri = t.file; lastMeta = lastQueue = null;
  }
  const metaKey = JSON.stringify([t.title, t.artist, t.album, t.date, t.genre, t.duration, s.playing]);
  if (metaKey !== lastMeta) {
    meta.replaceChildren(
      el("div", { class: "np-eyebrow" }, s.playing ? "Currently playing" : "Ready when you are"),
      el("h1", { class: "np-title" }, t.title || t.name || "Untitled"),
      el("div", { class: "np-artist" }, t.artist || "Unknown artist"),
      el("div", { class: "np-album muted" }, t.album || ""),
      el("div", { class: "np-tags" },
        ...[t.date, t.genre, t.duration ? fmtTime(t.duration) : null].filter(Boolean).map((text) => el("span", { class: "tag" }, String(text)))),
    );
    lastMeta = metaKey;
  }
  const position = t.Pos ?? -1;
  const upcoming = position >= 0 ? s.queue.slice(position + 1, position + 4) : [];
  const queueKey = JSON.stringify([position, upcoming]);
  if (queueKey !== lastQueue) {
    upNext.replaceChildren(
      el("div", { class: "section-heading" }, el("h3", {}, "Up next"), el("a", { class: "text-link", href: "#queue" }, "View queue →")),
      upcoming.length ? el("ol", { class: "up-next-list" }, ...upcoming.map((track, i) => {
        const row = trackRow(track, position + i + 1, { showArt: true, contextMenu: false });
        row.addEventListener("click", () => mpd.playAt(position + i + 1).catch((err) => toast(err.message, "error")));
        return row;
      })) : el("p", { class: "queue-end muted" }, "You're all caught up. Add another track from your library."),
    );
    lastQueue = queueKey;
  }
}

export function mount(root, { setActions }) {
  container = root;
  playButton = el("button", { class: "btn btn-primary", type: "button", onClick: () => mpd.toggle().catch((err) => toast(err.message, "error")) }, "Play");
  setActions(playButton);
  unsub = mpd.subscribe(render);
}

export function unmount() {
  unsub?.();
  container = card = meta = upNext = playButton = null;
  lastUri = lastMeta = lastQueue = null;
}
