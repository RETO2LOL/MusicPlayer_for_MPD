// views/now-playing.js — large now-playing card with up-next.

import { el, fmtTime, trackRow, emptyState, mpd, mountArtwork } from "./_shared.js";

let unsub = null;
let container = null;
let card = null;          // Persistent .now-playing-card so the artwork image
                          // element is not destroyed on every state push
                          // (which caused a visible flicker on hover / play).
let artEl = null;         // Persistent .artwork container inside `card`.
let metaEl = null;        // Persistent .now-playing-details for in-place updates.
let upNextEl = null;      // Persistent .up-next section.
let lastArtUri = null;    // Track which URI is currently mounted so we only
                          // call mountArtwork when the track actually changes.

function currentIndex(state) {
  const pos = state.track?.Pos;
  return pos != null ? Number(pos) : -1;
}

function nextTracks(state, n = 3) {
  const i = currentIndex(state);
  if (i < 0) return [];
  return state.queue.slice(i + 1, i + 1 + n);
}

function buildMeta(t) {
  return el("div", { class: "now-playing-details" },
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
}

function buildUpNext(s) {
  const upNext = nextTracks(s, 3);
  if (upNext.length === 0) return null;
  return el("section", { class: "up-next" },
    el("h3", null, "Up next"),
    el("ol", { class: "up-next-list" },
      ...upNext.map((t2, i) => trackRow(t2, currentIndex(s) + 1 + i, { playing: false, showArt: true })),
    ),
  );
}

function render() {
  if (!container) return;
  const s = mpd._state;

  if (!s.track) {
    card = null;
    artEl = null;
    metaEl = null;
    upNextEl = null;
    lastArtUri = null;
    container.replaceChildren(emptyState({
      icon: "♪",
      title: "Nothing playing",
      sub: "Pick something from Queue, Library, Artists, or Albums.",
    }));
    return;
  }

  const t = s.track;

  // Build the card shell on first render or when the track changes;
  // then keep it in place and only update the bits that need to change.
  if (t.file !== lastArtUri) {
    artEl = el("div", { class: "artwork artwork-lg" });
    mountArtwork(artEl, { uri: t.file, size: 240 });
    metaEl = buildMeta(t);
    card = el("div", { class: "now-playing-card" }, artEl, metaEl);
    upNextEl = buildUpNext(s);
    container.replaceChildren(card, upNextEl);
    lastArtUri = t.file;
    return;
  }

  // Same track — update meta + up-next in place, leave the artwork alone so
  // the loaded bitmap is not torn down (which would flicker on hover).
  if (metaEl && card) {
    const fresh = buildMeta(t);
    metaEl.replaceWith(fresh);
    metaEl = fresh;
  }
  // Replace up-next (its content depends on the queue, which can change).
  const next = buildUpNext(s);
  if (upNextEl) {
    if (next) {
      upNextEl.replaceWith((upNextEl = next));
    } else {
      upNextEl.remove();
      upNextEl = null;
    }
  } else if (next && card) {
    upNextEl = next;
    card.parentNode.insertBefore(upNextEl, card.nextSibling);
  }
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
  card = null;
  artEl = null;
  metaEl = null;
  upNextEl = null;
  lastArtUri = null;
}
