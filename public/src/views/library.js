// views/library.js — every track in the MPD database.
//
// MPD doesn't expose "list all tracks" directly, so we use `search("")` which
// returns the whole library, then render it. A rescan button triggers an
// `update` and shows a toast.

import { watchConnection, el, trackRow, emptyState, spinner, mpd, toast } from "./_shared.js";

let unsub = null;
let request = 0;
let container = null;
let tracks = [];
let loading = true;
let visibleCount = 200;

async function load() {
  const token = ++request;
  loading = true;
  render();
  try {
    const result = await mpd.search("", "any");
    if (token !== request) return;
    tracks = result;
    visibleCount = 200;
  } catch (err) {
    if (token !== request) return;
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
    ...tracks.slice(0, visibleCount).map((t, i) => {
      const row = trackRow(t, i, { playing: false });
      row.addEventListener("click", () => {
        mpd.playTracks(tracks, i)
          .catch((e) => toast(e.message, "error"));
      });
      return row;
    }),
  );
  container.replaceChildren(list);
  if (visibleCount < tracks.length) {
    container.appendChild(el("button", {
      class: "btn btn-ghost load-more", type: "button",
      onClick: () => { visibleCount += 200; render(); },
    }, `Show more · ${visibleCount.toLocaleString()} of ${tracks.length.toLocaleString()} tracks`));
  }
}

export function mount(root, { setActions, value }) {
  container = root;
  setActions(el("button", { class: "btn btn-ghost", type: "button",
    onClick: () => mpd.update().then(() => toast("Database update started", "ok")).catch((e) => toast(e.message, "error")),
  }, "Rescan library"));
  unsub = watchConnection(() => load(), () => {
    request++;
    container?.replaceChildren(el("div", { class: "loading" }, spinner(), el("span", { class: "muted" }, "Waiting for MPD…")));
  });
}

export function unmount() {
  request++;
  unsub?.();
  unsub = null;
  container = null;
  tracks = [];
  loading = true;
}
