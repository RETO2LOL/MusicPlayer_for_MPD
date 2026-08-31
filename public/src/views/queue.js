// views/queue.js — the current MPD playlist.

import { el, trackRow, emptyState, mpd, toast, showCtxMenu } from "./_shared.js";

let unsub = null;
let container = null;

function render() {
  if (!container) return;
  const s = mpd._state;

  if (!s.queue.length) {
    container.replaceChildren(emptyState({
      icon: "≡",
      title: "Queue is empty",
      sub: "Add tracks from Library, Artists, or Albums.",
    }));
    return;
  }

  const current = s.track?.Pos != null ? Number(s.track.Pos) : -1;
  const list = el("ol", { class: "track-list" },
    ...s.queue.map((t, i) => {
      const row = trackRow(t, i, { playing: i === current, showArt: true });
      row.addEventListener("click", () => mpd.playAt(i).catch((e) => toast(e.message, "error")));
      // Right-click: extra queue operations.
      row.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        showCtxMenu(e.clientX, e.clientY, [
          { label: "Play now",  onClick: () => mpd.playAt(i).catch((err) => toast(err.message, "error")) },
          { label: "Remove from queue", onClick: () => mpd.removeAt(i).catch((err) => toast(err.message, "error")) },
          { label: "Move to top", onClick: () => mpd.move(i, 0).catch((err) => toast(err.message, "error")) },
        ]);
      });
      return row;
    }),
  );

  container.replaceChildren(list);
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
}
