// views/queue.js — the current MPD playlist.

import { el, trackRow, emptyState, mpd, toast, showCtxMenu } from "./_shared.js";

let unsub = null;
let container = null;
let listEl = null;          // Persistent <ol> so the row DOM (and its <img>
                            // elements) is not torn down on every state
                            // push, which would flicker on hover.
let rowsByPos = new Map();  // Map<position, <li>> so we can flip .is-playing
                            // in place when the current track changes.

function render() {
  if (!container) return;
  const s = mpd._state;

  if (!s.queue.length) {
    listEl = null;
    rowsByPos = new Map();
    container.replaceChildren(emptyState({
      icon: "≡",
      title: "Queue is empty",
      sub: "Add tracks from Library, Artists, or Albums.",
    }));
    return;
  }

  const current = s.track?.Pos != null ? Number(s.track.Pos) : -1;

  // Detect whether the queue contents or the current position actually
  // changed. If not, just flip the .is-playing class on the relevant rows.
  const prevQueue = listEl ? Array.from(listEl.children) : [];
  if (prevQueue.length === s.queue.length && listEl) {
    let sameContents = true;
    for (let i = 0; i < s.queue.length; i++) {
      if (prevQueue[i].dataset.uri !== s.queue[i].file) { sameContents = false; break; }
    }
    if (sameContents) {
      // Update the playing class in place.
      for (const [pos, row] of rowsByPos) {
        row.classList.toggle("is-playing", pos === current);
      }
      return;
    }
  }

  // Build (or rebuild) the list — but reuse <li> elements whose data-uri
  // matches the new queue, so the loaded artwork stays in place.
  const newRowsByPos = new Map();
  const frag = document.createDocumentFragment();
  for (let i = 0; i < s.queue.length; i++) {
    const t = s.queue[i];
    const existing = prevQueue[i] && prevQueue[i].dataset.uri === t.file ? prevQueue[i] : null;
    if (existing) {
      // Track may have moved positions; update data-pos so click handlers
      // always use the current position.
      existing.dataset.pos = String(i);
      existing.classList.toggle("is-playing", i === current);
      newRowsByPos.set(i, existing);
      frag.appendChild(existing);
      continue;
    }
    const row = trackRow(t, i, { playing: i === current, showArt: true });
    row.dataset.pos = String(i);
    row.addEventListener("click", () => mpd.playAt(Number(row.dataset.pos)).catch((e) => toast(e.message, "error")));
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      const pos = Number(row.dataset.pos);
      showCtxMenu(e.clientX, e.clientY, [
        { label: "Play now",  onClick: () => mpd.playAt(pos).catch((err) => toast(err.message, "error")) },
        { label: "Remove from queue", onClick: () => mpd.removeAt(pos).catch((err) => toast(err.message, "error")) },
        { label: "Move to top", onClick: () => mpd.move(pos, 0).catch((err) => toast(err.message, "error")) },
      ]);
    });
    newRowsByPos.set(i, row);
    frag.appendChild(row);
  }

  listEl = el("ol", { class: "track-list" });
  listEl.appendChild(frag);
  rowsByPos = newRowsByPos;
  container.replaceChildren(listEl);
}

export function mount(root, { setActions }) {
  container = root;
  setActions(
    el("button", {
      class: "btn btn-ghost",
      type: "button",
      onClick: () => mpd.clear().then(() => toast("Queue cleared", "ok")).catch((e) => toast(e.message, "error")),
    }, "Clear"),
  );
  unsub = mpd.subscribe(render);
}

export function unmount() {
  unsub?.();
  unsub = null;
  container = null;
  listEl = null;
  rowsByPos = new Map();
}
