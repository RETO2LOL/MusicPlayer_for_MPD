// views/artists.js — distinct artists, drill-down to albums, then tracks.

import { watchConnection, el, trackRow, emptyState, spinner, mpd, toast } from "./_shared.js";

import { icon } from "../icons.js";

let unsub = null;
let request = 0;
let container = null;
let level = "artists";   // "artists" | "albums" | "tracks"
let artist = null;
let album  = null;
let data = [];
let loading = true;

async function loadArtists() {
  const token = ++request;
  level = "artists"; artist = null; album = null;
  loading = true; render();
  try { const result = await mpd.list("Artist"); if (token !== request) return; data = result.filter(Boolean); }
  catch (err) { if (token !== request) return; toast(err.message, "error"); data = []; }
  loading = false; render();
}

async function loadAlbums(a) {
  const token = ++request;
  artist = a; album = null; level = "albums";
  loading = true; render();
  try {
    const result = await mpd.list("Album", [["Artist", a]]);
    if (token !== request) return;
    data = result.filter(Boolean);
  } catch (err) { if (token !== request) return; toast(err.message, "error"); data = []; }
  loading = false; render();
}

async function loadTracks(al) {
  const token = ++request;
  album = al; level = "tracks";
  loading = true; render();
  try {
    const result = await mpd.find([["Artist", artist], ["Album", al]]);
    if (token !== request) return;
    data = result;
  } catch (err) { if (token !== request) return; toast(err.message, "error"); data = []; }
  loading = false; render();
}

function breadcrumb() {
  return el("nav", { class: "crumbs" },
    el("a", { href: "#", onClick: (e) => { e.preventDefault(); loadArtists(); } }, "Artists"),
    artist ? el("span", { class: "crumb-sep" }, "›") : null,
    artist ? el("a", { href: "#", onClick: (e) => { e.preventDefault(); loadAlbums(artist); } }, artist) : null,
    album ? el("span", { class: "crumb-sep" }, "›") : null,
    album ? el("span", { class: "crumb-current" }, album) : null,
  );
}

function render() {
  if (!container) return;
  if (loading) {
    container.replaceChildren(breadcrumb(),
      el("div", { class: "loading" }, spinner(), el("div", { class: "muted" }, "Loading…")));
    return;
  }
  if (!data.length) {
    container.replaceChildren(breadcrumb(), emptyState({ title: "Nothing here" }));
    return;
  }

  if (level === "artists") {
    const list = el("ul", { class: "browse-list" },
      ...data.map((name) => {
        return el("li", { class: "browse-row", onClick: () => loadAlbums(name) },
          el("span", { class: "browse-icon" }, icon("artists")),
          el("div", { class: "browse-meta" }, el("div", { class: "browse-title" }, name)),
          el("span", { class: "browse-chevron muted" }, "›"),
        );
      }),
    );
    container.replaceChildren(breadcrumb(), list);
    return;
  }

  if (level === "albums") {
    const list = el("ul", { class: "browse-list" },
      ...data.map((name) => {
        return el("li", { class: "browse-row", onClick: () => loadTracks(name) },
          el("span", { class: "browse-icon" }, icon("albums")),
          el("div", { class: "browse-meta" },
            el("div", { class: "browse-title" }, name),
            el("div", { class: "browse-sub muted" }, artist),
          ),
          el("span", { class: "browse-chevron muted" }, "›"),
        );
      }),
    );
    container.replaceChildren(breadcrumb(), list);
    return;
  }

  // Tracks
  const list = el("ol", { class: "track-list" },
    ...data.map((t, i) => {
      const row = trackRow(t, i, { playing: false });
      row.addEventListener("click", () => {
        mpd.playTracks(data, i)
          .catch((e) => toast(e.message, "error"));
      });
      return row;
    }),
  );
  container.replaceChildren(breadcrumb(), list);
}

export function mount(root, { setActions, value }) {
  container = root;
  unsub = watchConnection(() => value ? loadAlbums(value) : loadArtists(), () => {
    request++;
    container?.replaceChildren(el("div", { class: "loading" }, spinner(), el("span", { class: "muted" }, "Waiting for MPD…")));
  });
}

export function unmount() {
  request++;
  unsub?.();
  unsub = null;
  container = null;
}
