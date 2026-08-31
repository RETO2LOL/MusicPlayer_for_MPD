// views/library.js — every track in the MPD database.
//
// MPD doesn't expose "list all tracks" directly, so we use `search("")` which
// returns the whole library, then render it. A rescan button triggers an
// `update` and shows a toast.

import { el, trackRow, emptyState, spinner, mpd, toast } from "./_shared.js";

let unsub = null;
let container = null;
let tracks = [];
let loading = true;

async function load() {
  loading = true;
  render();
  try {
    tracks = await mpd.search("", "any");
  } catch (err) {
    toast(err.message, "error");
    tracks = [];
  }
  loading = false;
  render();
}

function render() {
  if (!container) return;
  if (loading) {
    container.replaceChildren(el("div", { class: "loading" }, spinner(), el("div", { class: "muted" }, "Loading library…")));
    return;
  }
  if (!tracks.length) {
    container.replaceChildren(emptyState({
      icon: "∅",
      title: "No tracks in library",
      sub: "Try rescanning the database.",
    }));
    return;
  }
  const list = el("ol", { class: "track-list" },
    ...tracks.map((t, i) => {
      const row = trackRow(t, i, { playing: false });
      row.addEventListener("click", () => {
        mpd.clear()
          .then(() => Promise.all(tracks.map((tr) => mpd.add(tr.file))))
          .then(() => mpd.playAt(i))
          .catch((e) => toast(e.message, "error"));
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
      class: "btn btn-primary",
      type: "button",
      onClick: () => mpd.update("/").then(() => toast("Database update started", "ok")).catch((e) => toast(e.message, "error")),
    }, "Rescan"),
  );
  load();
  unsub = mpd.subscribe(render);
}

export function unmount() {
  unsub?.();
  unsub = null;
  container = null;
  tracks = [];
  loading = true;
}
