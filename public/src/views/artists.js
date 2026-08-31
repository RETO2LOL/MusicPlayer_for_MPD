// views/artists.js — distinct artists, drill-down to albums, then tracks.

import { el, trackRow, emptyState, spinner, mpd, toast } from "./_shared.js";

let unsub = null;
let container = null;
let level = "artists";   // "artists" | "albums" | "tracks"
let artist = null;
let album  = null;
let data = [];
let loading = true;

async function loadArtists() {
  level = "artists"; artist = null; album = null;
  loading = true; render();
  try { data = await mpd.list("Artist"); }
  catch (err) { toast(err.message, "error"); data = []; }
  loading = false; render();
}

async function loadAlbums(a) {
  artist = a; album = null;
  level = "albums";
  loading = true; render();
  // Albums by artist — mpd's `list("Album", a)` is exact-match on the
  // AlbumArtist field, but a track's "Artist" can differ from its
  // "AlbumArtist". Search is more forgiving and matches the typical case.
  try {
    const hits = await mpd.search(a, "Artist");
    const seen = new Set();
    data = [];
    for (const t of hits) {
      const name = t.album || t.Album;
      if (name && !seen.has(name)) { seen.add(name); data.push({ Album: name, AlbumArtist: a }); }
    }
  } catch (err) { toast(err.message, "error"); data = []; }
  loading = false; render();
}

async function loadTracks(al) {
  album = al;
  level = "tracks";
  loading = true; render();
  try { data = await mpd.search(al, "Album"); }
  catch (err) { toast(err.message, "error"); data = []; }
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
          el("span", { class: "browse-icon" }, "👤"),
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
          el("span", { class: "browse-icon" }, "💿"),
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
        mpd.clear()
          .then(() => Promise.all(data.map((tr) => mpd.add(tr.file))))
          .then(() => mpd.playAt(i))
          .catch((e) => toast(e.message, "error"));
      });
      return row;
    }),
  );
  container.replaceChildren(breadcrumb(), list);
}

function onSearchFocus(e) {
  if (e.detail?.kind !== "artists") return;
  loadAlbums(e.detail.value);
}

export function mount(root) {
  container = root;
  window.addEventListener("search:focus", onSearchFocus);
  loadArtists();
  unsub = mpd.subscribe(render);
}

export function unmount() {
  unsub?.();
  unsub = null;
  container = null;
  window.removeEventListener("search:focus", onSearchFocus);
}
