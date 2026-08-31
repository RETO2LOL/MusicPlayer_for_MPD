// views/now-playing.js — large now-playing card with up-next.

import { el, fmtTime, trackRow, emptyState, mpd, mountArtwork } from "./_shared.js";

let unsub = null;
let container = null;

function currentIndex(state) {
  const pos = state.track?.Pos;
  return pos != null ? Number(pos) : -1;
}

function nextTracks(state, n = 3) {
  const i = currentIndex(state);
  if (i < 0) return [];
  return state.queue.slice(i + 1, i + 1 + n);
}

function render() {
  if (!container) return;
  const s = mpd._state;

  if (!s.track) {
    container.replaceChildren(emptyState({
      icon: "♪",
      title: "Nothing playing",
      sub: "Pick something from Queue, Library, Artists, or Albums.",
    }));
    return;
  }

  const t = s.track;
  const art = el("div", { class: "artwork artwork-lg" });
  mountArtwork(art, { uri: t.file, size: 240 });

  const meta = el("div", { class: "now-playing-details" },
    el("div", { class: "np-eyebrow muted" }, t.albumArtist || t.artist || ""),
    el("h1",  { class: "np-title" }, t.title || t.file?.split("/").pop() || "(untitled)"),
    el("div", { class: "np-artist" }, t.artist || "—"),
    el("div", { class: "np-album muted" }, t.album ? `from ${t.album}` : ""),
    el("div", { class: "np-tags" },
      t.date   ? el("span", { class: "tag" }, String(t.date)) : null,
      t.genre  ? el("span", { class: "tag" }, t.genre) : null,
      t.Time   ? el("span", { class: "tag" }, fmtTime(t.Time)) : null,
    ),
  );

  const upNext = nextTracks(s, 3);
  const upNextSection = upNext.length === 0 ? null : el("section", { class: "up-next" },
    el("h3", null, "Up next"),
    el("ol", { class: "up-next-list" },
      ...upNext.map((t2, i) => trackRow(t2, currentIndex(s) + 1 + i, { playing: false, showArt: true })),
    ),
  );

  container.replaceChildren(
    el("div", { class: "now-playing-card" }, art, meta),
    upNextSection,
  );
}

export function mount(root, { setActions }) {
  container = root;
  setActions(
    el("button", { class: "btn btn-ghost", type: "button", onClick: () => mpd.toggle() },
      mpd._state.playing ? "Pause" : "Play"),
  );
  unsub = mpd.subscribe(render);
}

export function unmount() {
  unsub?.();
  unsub = null;
  container = null;
}
